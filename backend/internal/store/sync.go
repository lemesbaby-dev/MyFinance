package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
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
	// MaxOpsPerDay: operações por usuário por dia (UTC), contando as recusadas e as dup.
	MaxOpsPerDay int64 = 20_000
	// KeepSyncOps: op_ids lembrados por usuário (um reenvio mais velho que isso não existe).
	KeepSyncOps = 2000
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
//	conflict  ocorrência de recorrência duplicada num INSERT (outro aparelho já gerou); o app descarta a cópia local
//	rejected  inválida (ver Error); o app avisa o usuário
//
// Só operações "ok" entram em sync_ops: reenviar uma recusada devolve o mesmo status e o app descobre.
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

	// sync_ops com mais de 90 dias saem (um reenvio tão antigo não existe).
	if _, err := tx.Exec(`DELETE FROM sync_ops WHERE user_id=? AND applied_at < datetime('now','-90 days')`, uid); err != nil {
		return nil, err
	}
	// Contadores mantidos em users (recountSQL os recalcula): nada de varrer `entities` a cada push.
	var u usage
	var day string
	var opsN int64
	if err := tx.QueryRow(`SELECT rows_n, bytes_n, total_n, ops_day, ops_n FROM users WHERE id=?`, uid).
		Scan(&u.rows, &u.bytes, &u.total, &day, &opsN); err != nil {
		return nil, err
	}
	if today := time.Now().UTC().Format("2006-01-02"); day != today {
		day, opsN = today, 0
	}
	ex := func(kind, id string) bool {
		var n int
		return tx.QueryRow(`SELECT 1 FROM entities WHERE user_id=? AND kind=? AND id=? AND deleted_at IS NULL`,
			uid, kind, id).Scan(&n) == nil
	}
	parentOf := func(id string) *string {
		var p sql.NullString
		if tx.QueryRow(`SELECT json_extract(data,'$.parent_id') FROM entities
			WHERE user_id=? AND kind='category' AND id=? AND deleted_at IS NULL`, uid, id).Scan(&p) != nil || !p.Valid {
			return nil
		}
		return &p.String
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
		opsN++
		switch {
		case opsN > MaxOpsPerDay:
			reject("limite diário de operações excedido")
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
			res, err = s.apply(tx, uid, op, res, ex, parentOf, nextRev, &u)
			if err != nil {
				return nil, err
			}
		}
		if res.Status == "ok" {
			if _, err := tx.Exec(`INSERT OR IGNORE INTO sync_ops(user_id,op_id) VALUES(?,?)`, uid, op.OpID); err != nil {
				return nil, err
			}
		}
		out = append(out, res)
	}
	if _, err := tx.Exec(`UPDATE users SET rows_n=?, bytes_n=?, total_n=?, ops_day=?, ops_n=? WHERE id=?`,
		u.rows, u.bytes, u.total, day, opsN, uid); err != nil {
		return nil, err
	}
	// Mantém só os últimos KeepSyncOps op_ids (poda por contagem; ≤ KeepSyncOps+lote linhas a ordenar).
	if _, err := tx.Exec(`DELETE FROM sync_ops WHERE user_id=? AND rowid <=
		(SELECT rowid FROM sync_ops WHERE user_id=? ORDER BY rowid DESC LIMIT 1 OFFSET ?)`, uid, uid, KeepSyncOps); err != nil {
		return nil, err
	}
	return out, tx.Commit()
}

// usage é o consumo do usuário dentro do lote: vivos, bytes dos vivos e total (com tombstones).
type usage struct{ rows, bytes, total int64 }

// refKinds: campos do documento que apontam para outras entidades.
var refKinds = map[string]string{"account_id": "account", "transfer_account_id": "account",
	"category_id": "category", "parent_id": "category", "recurrence_id": "recurrence"}

func (s *Store) apply(tx *sql.Tx, uid string, op Op, res OpResult, ex exists, parentOf func(string) *string,
	nextRev func() (int64, error), u *usage) (OpResult, error) {
	var deleted bool
	var old string
	err := tx.QueryRow(`SELECT deleted_at IS NOT NULL, data FROM entities WHERE user_id=? AND kind=? AND id=?`,
		uid, op.Kind, op.ID).Scan(&deleted, &old)
	found := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return res, err
	}
	oldLen := int64(len(old))

	if op.Action == "delete" {
		// Já excluído, ou desconhecido (a fila ordenada garante que o upsert chega antes): no-op.
		if !found || deleted {
			return res, nil
		}
		rev, err := nextRev()
		if err == nil {
			_, err = tx.Exec(`UPDATE entities SET deleted_at=datetime('now'), rev=?, data='{}' WHERE user_id=? AND kind=? AND id=?`,
				rev, uid, op.Kind, op.ID)
		}
		u.rows, u.bytes = u.rows-1, u.bytes-oldLen
		return res, err
	}

	if found && deleted {
		res.Status = "gone"
		return res, nil
	}
	if found {
		// Referências que o documento já tinha continuam valendo mesmo que o pai tenha sido excluído
		// depois (o app é quem cascateia exclusões); só referência NOVA exige existir.
		prev := map[string]bool{}
		var doc map[string]any
		_ = json.Unmarshal([]byte(old), &doc)
		for f, k := range refKinds {
			if id, ok := doc[f].(string); ok && k != "category" { // categoria excluída é "curada" (vira null)
				prev[k+"/"+id] = true
			}
		}
		ex0 := ex
		ex = func(kind, id string) bool { return prev[kind+"/"+id] || ex0(kind, id) }
	}
	norm, verr := validateData(op.Kind, op.ID, op.Data, ex, parentOf)
	if verr != nil {
		res.Status, res.Error = "rejected", verr.Error()
		return res, nil
	}
	newLen := int64(len(norm))
	if (!found && (u.rows >= MaxRows || u.total >= 4*MaxRows || u.bytes+newLen > MaxBytes)) ||
		(found && newLen > oldLen && u.bytes+newLen-oldLen > MaxBytes) {
		res.Status, res.Error = "rejected", "cota de dados excedida"
		return res, nil
	}
	rev, err := nextRev()
	if err != nil {
		return res, err
	}
	if found {
		_, err = tx.Exec(`UPDATE entities SET data=?, rev=? WHERE user_id=? AND kind=? AND id=?`, string(norm), rev, uid, op.Kind, op.ID)
		if err == nil {
			u.bytes += newLen - oldLen
		}
	} else {
		_, err = tx.Exec(`INSERT INTO entities(user_id,kind,id,rev,data) VALUES(?,?,?,?,?)`, uid, op.Kind, op.ID, rev, string(norm))
		if err == nil {
			u.rows, u.bytes, u.total = u.rows+1, u.bytes+newLen, u.total+1
		}
	}
	if err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed") {
		// O contador de rev avançou à toa (inofensivo: o cursor só precisa ser crescente).
		if found {
			res.Status, res.Error = "rejected", "já existe uma ocorrência desta recorrência nessa data"
		} else {
			res.Status = "conflict"
		}
		return res, nil
	}
	return res, err
}

// Rev é o contador atual do usuário: o app compara com o seu cursor para detectar banco restaurado.
func (s *Store) Rev(uid string) (rev int64, err error) {
	err = s.db.QueryRow(`SELECT rev FROM users WHERE id=?`, uid).Scan(&rev)
	return
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

// Export devolve todos os documentos vivos do usuário (sem tombstones), com rev, em ordem de rev.
func (s *Store) Export(uid string) ([]Change, error) {
	rows, err := s.db.Query(`SELECT kind,id,rev,data FROM entities
		WHERE user_id=? AND deleted_at IS NULL ORDER BY rev`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Change{}
	for rows.Next() {
		var c Change
		var data string
		if err := rows.Scan(&c.Kind, &c.ID, &c.Rev, &data); err != nil {
			return nil, err
		}
		c.Data = json.RawMessage(data)
		out = append(out, c)
	}
	return out, rows.Err()
}

// Reset exclui (tombstone) todos os documentos vivos do usuário, mantendo a conta: os outros aparelhos
// recebem as exclusões no próximo pull e voltam ao estado de recém-cadastrado.
func (s *Store) Reset(uid string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var rev int64
	if err := tx.QueryRow(`SELECT rev FROM users WHERE id=?`, uid).Scan(&rev); err != nil {
		return err
	}
	rows, err := tx.Query(`SELECT kind,id FROM entities WHERE user_id=? AND deleted_at IS NULL`, uid)
	if err != nil {
		return err
	}
	type key struct{ kind, id string }
	var live []key
	for rows.Next() {
		var k key
		if err := rows.Scan(&k.kind, &k.id); err != nil {
			rows.Close()
			return err
		}
		live = append(live, k)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, k := range live { // rev único por linha: o pull pagina por rev e empate pularia itens
		rev++
		if _, err := tx.Exec(`UPDATE entities SET deleted_at=datetime('now'), rev=?, data='{}' WHERE user_id=? AND kind=? AND id=?`,
			rev, uid, k.kind, k.id); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`UPDATE users SET rev=?, rows_n=0, bytes_n=0 WHERE id=?`, rev, uid); err != nil {
		return err
	}
	return tx.Commit()
}
