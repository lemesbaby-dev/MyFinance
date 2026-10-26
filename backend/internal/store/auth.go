package store

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"time"
)

type User struct {
	ID      string `json:"id"`
	Email   string `json:"email"`
	Name    string `json:"name"`
	Picture string `json:"picture"`
}

// ErrSignupsClosed: MAX_USERS atingido (trava contra abuso do cadastro aberto).
var ErrSignupsClosed = errors.New("cadastros encerrados")

// ErrNoSession: token inexistente, expirado ou revogado.
var ErrNoSession = errors.New("sessão inválida")

const tsFmt = time.RFC3339 // UTC: ordena como texto

func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err) // sem entropia não há como emitir token com segurança
	}
	return hex.EncodeToString(b)
}

func hashToken(t string) string {
	h := sha256.Sum256([]byte(t))
	return hex.EncodeToString(h[:])
}

// UpsertGoogleUser acha o usuário pelo `sub` do Google (o e-mail pode mudar) ou cria um novo.
// maxUsers <= 0 = sem limite.
func (s *Store) UpsertGoogleUser(sub, email, name, picture string, maxUsers int) (User, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback()
	u := User{Email: email, Name: name, Picture: picture}
	err = tx.QueryRow(`SELECT id FROM users WHERE google_sub=?`, sub).Scan(&u.ID)
	switch {
	case err == nil:
		_, err = tx.Exec(`UPDATE users SET email=?, name=?, picture=? WHERE id=?`, email, name, picture, u.ID)
	case errors.Is(err, sql.ErrNoRows):
		var n int
		if err = tx.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n); err == nil {
			if maxUsers > 0 && n >= maxUsers {
				return User{}, ErrSignupsClosed
			}
			u.ID = randHex(16)
			_, err = tx.Exec(`INSERT INTO users(id,google_sub,email,name,picture) VALUES(?,?,?,?,?)`,
				u.ID, sub, email, name, picture)
		}
	}
	if err != nil {
		return User{}, err
	}
	return u, tx.Commit()
}

// NewSession emite um token opaco (devolvido uma única vez; no banco fica só o hash).
func (s *Store) NewSession(uid, device string, ttl time.Duration) (string, error) {
	token := base64.RawURLEncoding.EncodeToString([]byte(randHex(32)))
	now := time.Now().UTC()
	_, _ = s.db.Exec(`DELETE FROM sessions WHERE expires_at < ?`, now.Format(tsFmt)) // faxina barata
	_, err := s.db.Exec(`INSERT INTO sessions(token_hash,user_id,device,expires_at) VALUES(?,?,?,?)`,
		hashToken(token), uid, device, now.Add(ttl).Format(tsFmt))
	return token, err
}

// SessionUser resolve o token no usuário e renova a validade (janela deslizante) no máximo
// uma vez por dia, para não gravar a cada requisição.
func (s *Store) SessionUser(token string, ttl time.Duration) (User, error) {
	now := time.Now().UTC()
	var u User
	var exp string
	err := s.db.QueryRow(`SELECT u.id,u.email,u.name,u.picture,s.expires_at
		FROM sessions s JOIN users u ON u.id=s.user_id
		WHERE s.token_hash=? AND s.expires_at > ?`, hashToken(token), now.Format(tsFmt)).
		Scan(&u.ID, &u.Email, &u.Name, &u.Picture, &exp)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNoSession
	}
	if err != nil {
		return User{}, err
	}
	if e, perr := time.Parse(tsFmt, exp); perr == nil && e.Sub(now) < ttl-24*time.Hour {
		_, _ = s.db.Exec(`UPDATE sessions SET expires_at=? WHERE token_hash=?`,
			now.Add(ttl).Format(tsFmt), hashToken(token))
	}
	return u, nil
}

func (s *Store) RevokeSession(token string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE token_hash=?`, hashToken(token))
	return err
}
