package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
)

// Limites por usuário e por requisição (cadastro aberto + VM pequena).
const (
	MaxOps       = 500
	MaxDataBytes = 16 << 10
)

// var (não const) só para os testes poderem baixar a cota.
var (
	MaxRows  int64 = 50_000
	MaxBytes int64 = 20 << 20
)

// Op é uma alteração vinda da fila do app. Action: "upsert" | "delete".
type Op struct {
	OpID   string          `json:"op_id"`
	Kind   string          `json:"kind"`
	ID     string          `json:"id"`
	Action string          `json:"action"`
	Data   json.RawMessage `json:"data"`
}

// Status de cada operação do lote:
//
//	ok        aplicada
//	dup       op_id já aplicado antes (reenvio) — nada a fazer
//	gone      o item foi excluído (exclusão vence edição); o próximo pull traz o tombstone
//	conflict  ocorrência de recorrência duplicada (outro aparelho já gerou); o app descarta a cópia local
//	rejected  inválida (ver Error); o app avisa o usuário
type OpResult struct {
	OpID   string `json:"op_id"`
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

// Change é uma mudança entregue ao app no pull.
type Change struct {
	Kind    string          `json:"kind"`
	ID      string          `json:"id"`
	Rev     int64           `json:"rev"`
	Deleted bool            `json:"deleted"`
	Data    json.RawMessage `json:"data"`
}

// Push aplica o lote numa única transação. Operação inválida vira "rejected" e não escreve nada;
// erro de banco aborta o lote inteiro (o app reenvia, e o op_id garante que não duplica).
func (s *Store) Push(uid string, ops []Op) ([]OpResult, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var rows, bytes int64
	if err := tx.QueryRow(`SELECT COUNT(*), COALESCE(SUM(length(data)),0) FROM entities
		WHERE user_id=? AND deleted_at IS NULL`, uid).Scan(&rows, &bytes); err != nil {
		return nil, err
	}
	ex := func(kind, id string) bool {
		var n int
		return tx.QueryRow(`SELECT 1 FROM entities WHERE user_id=? AND kind=? AND id=? AND deleted_at IS NULL`,
			uid, kind, id).Scan(&n) == nil
	}
	nextRev := func() (int64, error) {
		var r int64
		err := tx.QueryRow(`UPDATE users SET rev=rev+1 WHERE id=? RETURNING rev`, uid).Scan(&r)
		return r, err
	}

	out := make([]OpResult, 0, len(ops))
	for _, op := range ops {
		res := OpResult{OpID: op.OpID, Status: "ok"}
		reject := func(msg string) { res.Status, res.Error = "rejected", msg }
		var seen int
		switch {
		case !validID(op.OpID) || !validID(op.ID):
			reject("id inválido")
		case op.Action != "upsert" && op.Action != "delete":
			reject("action deve ser upsert ou delete")
		case !oneOf(op.Kind, "account", "category", "recurrence", "transaction"):
			reject("tipo de entidade inválido")
		case len(op.Data) > MaxDataBytes:
			reject("documento grande demais")
		case tx.QueryRow(`SELECT 1 FROM sync_ops WHERE user_id=? AND op_id=?`, uid, op.OpID).Scan(&seen) == nil:
			res.Status = "dup"
		default:
			res, rows, bytes, err = s.apply(tx, uid, op, res, ex, nextRev, rows, bytes)
			if err != nil {
				return nil, err
			}
		}
		if res.Status != "dup" {
			if _, err := tx.Exec(`INSERT OR IGNORE INTO sync_ops(user_id,op_id) VALUES(?,?)`, uid, op.OpID); err != nil {
				return nil, err
			}
		}
		out = append(out, res)
	}
	return out, tx.Commit()
}

func (s *Store) apply(tx *sql.Tx, uid string, op Op, res OpResult, ex exists, nextRev func() (int64, error),
	rows, bytes int64) (OpResult, int64, int64, error) {
	var deleted bool
	var oldLen int64
	err := tx.QueryRow(`SELECT deleted_at IS NOT NULL, length(data) FROM entities WHERE user_id=? AND kind=? AND id=?`,
		uid, op.Kind, op.ID).Scan(&deleted, &oldLen)
	found := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return res, rows, bytes, err
	}

	if op.Action == "delete" {
		switch {
		case found && deleted: // já excluído: nada a fazer
		case found:
			rev, err := nextRev()
			if err == nil {
				_, err = tx.Exec(`UPDATE entities SET deleted_at=datetime('now'), rev=? WHERE user_id=? AND kind=? AND id=?`,
					rev, uid, op.Kind, op.ID)
			}
			rows, bytes = rows-1, bytes-oldLen
			return res, rows, bytes, err
		default: // exclusão de algo que ainda não chegou aqui: grava o tombstone
			rev, err := nextRev()
			if err == nil {
				_, err = tx.Exec(`INSERT INTO entities(user_id,kind,id,rev,deleted_at,data) VALUES(?,?,?,?,datetime('now'),'{}')`,
					uid, op.Kind, op.ID, rev)
			}
			return res, rows, bytes, err
		}
		return res, rows, bytes, nil
	}

	if found && deleted {
		res.Status = "gone"
		return res, rows, bytes, nil
	}
	norm, verr := validateData(op.Kind, op.ID, op.Data, ex)
	if verr != nil {
		res.Status, res.Error = "rejected", verr.Error()
		return res, rows, bytes, nil
	}
	newLen := int64(len(norm))
	if !found && (rows >= MaxRows || bytes+newLen > MaxBytes) {
		res.Status, res.Error = "rejected", "cota de dados excedida"
		return res, rows, bytes, nil
	}
	rev, err := nextRev()
	if err != nil {
		return res, rows, bytes, err
	}
	if found {
		_, err = tx.Exec(`UPDATE entities SET data=?, rev=? WHERE user_id=? AND kind=? AND id=?`, string(norm), rev, uid, op.Kind, op.ID)
		if err == nil {
			bytes += newLen - oldLen
		}
	} else {
		_, err = tx.Exec(`INSERT INTO entities(user_id,kind,id,rev,data) VALUES(?,?,?,?,?)`, uid, op.Kind, op.ID, rev, string(norm))
		if err == nil {
			rows, bytes = rows+1, bytes+newLen
		}
	}
	if err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed") {
		// O contador de rev avançou à toa (inofensivo: o cursor só precisa ser crescente).
		res.Status = "conflict"
		return res, rows, bytes, nil
	}
	return res, rows, bytes, err
}

// Pull devolve as mudanças com rev > since, em ordem. more=true se há mais além do limite.
func (s *Store) Pull(uid string, since int64, limit int) (changes []Change, cursor int64, more bool, err error) {
	rows, err := s.db.Query(`SELECT kind,id,rev,deleted_at IS NOT NULL,data FROM entities
		WHERE user_id=? AND rev>? ORDER BY rev LIMIT ?`, uid, since, limit+1)
	if err != nil {
		return nil, since, false, err
	}
	defer rows.Close()
	changes = []Change{}
	for rows.Next() {
		var c Change
		var data string
		if err := rows.Scan(&c.Kind, &c.ID, &c.Rev, &c.Deleted, &data); err != nil {
			return nil, since, false, err
		}
		c.Data = json.RawMessage(data)
		changes = append(changes, c)
	}
	if err := rows.Err(); err != nil {
		return nil, since, false, err
	}
	if len(changes) > limit {
		changes, more = changes[:limit], true
	}
	cursor = since
	if n := len(changes); n > 0 {
		cursor = changes[n-1].Rev
	}
	return changes, cursor, more, nil
}
