// Package auth valida o ID token do Google (Sign-In) só com a stdlib.
package auth

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

type Claims struct {
	Sub, Email, Name, Picture string
}

// Verifier valida um ID token. Em testes, troque por um fake.
type Verifier interface {
	Verify(ctx context.Context, idToken string) (Claims, error)
}

const certsURL = "https://www.googleapis.com/oauth2/v3/certs"

type Google struct {
	ClientID string
	// Keys devolve as chaves públicas por kid. Padrão: JWKS do Google com cache.
	Keys func(ctx context.Context) (map[string]*rsa.PublicKey, error)
	Now  func() time.Time // injetável p/ teste

	mu      sync.Mutex
	cache   map[string]*rsa.PublicKey
	fetched time.Time
}

func (g *Google) now() time.Time {
	if g.Now != nil {
		return g.Now()
	}
	return time.Now()
}

func (g *Google) keys(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	if g.Keys != nil {
		m, err := g.Keys(ctx)
		if err != nil {
			return nil, err
		}
		if k := m[kid]; k != nil {
			return k, nil
		}
		return nil, errors.New("kid desconhecido")
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	// Cache de 1h; kid novo (rotação de chaves) força nova busca, no máximo 1x por minuto.
	age := g.now().Sub(g.fetched)
	if g.cache == nil || age > time.Hour || (g.cache[kid] == nil && age > time.Minute) {
		m, err := fetchCerts(ctx)
		if err != nil {
			return nil, err
		}
		g.cache, g.fetched = m, g.now()
	}
	if k := g.cache[kid]; k != nil {
		return k, nil
	}
	return nil, errors.New("kid desconhecido")
}

func fetchCerts(ctx context.Context) (map[string]*rsa.PublicKey, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, certsURL, nil)
	res, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("certs do Google: HTTP %d", res.StatusCode)
	}
	var body struct {
		Keys []struct{ Kid, N, E string } `json:"keys"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return nil, err
	}
	out := map[string]*rsa.PublicKey{}
	for _, k := range body.Keys {
		n, err1 := base64.RawURLEncoding.DecodeString(k.N)
		e, err2 := base64.RawURLEncoding.DecodeString(k.E)
		if err1 != nil || err2 != nil {
			continue
		}
		out[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}
	}
	return out, nil
}

var errInvalid = errors.New("token do Google inválido")

// Verify confere assinatura (RS256), emissor, audiência, validade e e-mail verificado.
func (g *Google) Verify(ctx context.Context, idToken string) (Claims, error) {
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return Claims{}, errInvalid
	}
	var hdr struct{ Alg, Kid string }
	if !decodePart(parts[0], &hdr) || hdr.Alg != "RS256" { // recusa "none"/HS256
		return Claims{}, errInvalid
	}
	key, err := g.keys(ctx, hdr.Kid)
	if err != nil {
		return Claims{}, fmt.Errorf("%w: %v", errInvalid, err)
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return Claims{}, errInvalid
	}
	sum := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if rsa.VerifyPKCS1v15(key, crypto.SHA256, sum[:], sig) != nil {
		return Claims{}, errInvalid
	}
	var p struct {
		Iss           string          `json:"iss"`
		Aud           string          `json:"aud"`
		Exp           int64           `json:"exp"`
		Sub           string          `json:"sub"`
		Email         string          `json:"email"`
		EmailVerified json.RawMessage `json:"email_verified"` // bool ou "true"
		Name          string          `json:"name"`
		Picture       string          `json:"picture"`
	}
	if !decodePart(parts[1], &p) {
		return Claims{}, errInvalid
	}
	ev := string(p.EmailVerified)
	switch {
	case p.Iss != "accounts.google.com" && p.Iss != "https://accounts.google.com":
		return Claims{}, errors.New("emissor inválido")
	case g.ClientID == "" || p.Aud != g.ClientID:
		return Claims{}, errors.New("audiência inválida")
	case g.now().Unix() > p.Exp+60: // 60s de tolerância de relógio
		return Claims{}, errors.New("token expirado")
	case p.Sub == "" || p.Email == "":
		return Claims{}, errInvalid
	case ev != "true" && ev != `"true"`:
		return Claims{}, errors.New("e-mail não verificado")
	}
	return Claims{Sub: p.Sub, Email: p.Email, Name: p.Name, Picture: p.Picture}, nil
}

func decodePart(s string, v any) bool {
	b, err := base64.RawURLEncoding.DecodeString(s)
	return err == nil && json.Unmarshal(b, v) == nil
}
