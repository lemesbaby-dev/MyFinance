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
//	conflict  ocorrência de recorrência duplicada num INSERT (outro aparelho já gerou), ou gerada por cópia antiga
//	          além do encerramento da regra (ver staleRule); o app descarta a cópia local
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

// ErrResync: o cursor do app é anterior ao marco do GC (gc_rev). A cópia local dele pode ter documento cuja
// exclusão já foi descartada, e um upsert o recriaria: o lote inteiro é recusado até o app refazer a cópia.
var ErrResync = errors.New("cursor anterior ao marco do GC")

// Push aplica o lote numa única transação. Operação inválida vira "rejected" e não escreve nada;
// erro de banco aborta o lote inteiro (o app reenvia, e o op_id garante que não duplica).
// `cursor` é o do app (o mesmo do pull); é comparado com o marco DENTRO da transação, então um GC
// concorrente ou já terminou (e o lote é recusado com ErrResync) ou só roda depois do commit.
func (s *Store) Push(uid string, cursor int64, ops []Op) ([]OpResult, error) {
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
	var opsN, gcRev int64
	if err := tx.QueryRow(`SELECT rows_n, bytes_n, total_n, ops_day, ops_n, gc_rev FROM users WHERE id=?`, uid).
		Scan(&u.rows, &u.bytes, &u.total, &day, &opsN, &gcRev); err != nil {
		return nil, err
	}
	if cursor < gcRev {
		return nil, ErrResync // o rollback desfaz a poda de sync_ops acima: nada é escrito
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
	// stale: a regra mudou depois do cursor deste app, então o que ele manda sobre ela parte de uma cópia antiga
	// (ver staleRule). Decidido no 1º contato do lote com a regra: as escritas do próprio lote sobem o rev dela
	// e não podem nem "atualizar" uma cópia antiga nem envelhecer quem estava em dia. Regra criada no lote tem rev 0.
	seen := map[string]bool{}
	stale := func(id string, rev int64) bool {
		v, ok := seen[id]
		if !ok {
			v = rev > cursor
			seen[id] = v
		}
		return v
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
			res, err = s.apply(tx, uid, op, res, ex, parentOf, nextRev, stale, &u)
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

// staleRule: escrita de regra de recorrência por um app que ainda não leu a versão gravada (issue #29: o aparelho
// abre depois de semanas e estende as recorrências com a cópia antiga, antes do pull). O documento continua sendo
// o último que chega, menos o que desfaria um encerramento feito em outro aparelho: `end_date` não é tirado nem
// adiado, `active` não volta a true e `generated_until` não recua. Devolve nil quando não há como conciliar
// (o início novo fica depois do fim gravado): fica o documento que já estava.
// Quem está em dia (cursor >= rev da regra) grava o que quiser, inclusive reabrir.
// ponytail: o cursor é por app, não por documento; duas edições da mesma regra em lotes diferentes do mesmo envio
// caem aqui e a segunda não reabre. Resolve com o base_rev por operação (issue #26).
func staleRule(old string, norm json.RawMessage) json.RawMessage {
	var cur, in recurrenceData
	if json.Unmarshal([]byte(old), &cur) != nil || json.Unmarshal(norm, &in) != nil {
		return norm
	}
	if cur.EndDate != nil && (in.EndDate == nil || *in.EndDate > *cur.EndDate) {
		in.EndDate = cur.EndDate
	}
	in.Active = in.Active && cur.Active
	if cur.GeneratedUntil != nil && (in.GeneratedUntil == nil || *in.GeneratedUntil < *cur.GeneratedUntil) {
		in.GeneratedUntil = cur.GeneratedUntil
	}
	if in.EndDate != nil && *in.EndDate < in.StartDate {
		return nil
	}
	out, _ := json.Marshal(in)
	return out
}

// pastEnd: lançamento novo e pendente que uma cópia antiga gerou além do encerramento da regra (depois de `end_date`,
// ou depois do `generated_until` de uma regra desativada, que não gera mais nada). Aceitá-lo duplicaria as datas
// que a regra nova (ou nenhuma) cobre. Efetivado nunca cai aqui: o usuário mexeu nele.
func pastEnd(tx *sql.Tx, uid string, norm json.RawMessage, stale func(string, int64) bool) bool {
	var t transactionData
	if json.Unmarshal(norm, &t) != nil || t.RecurrenceID == nil || t.Status != "pending" {
		return false
	}
	var rev int64
	var data string
	var r recurrenceData
	if tx.QueryRow(`SELECT rev, data FROM entities WHERE user_id=? AND kind='recurrence' AND id=? AND deleted_at IS NULL`,
		uid, *t.RecurrenceID).Scan(&rev, &data) != nil || !stale(*t.RecurrenceID, rev) || json.Unmarshal([]byte(data), &r) != nil {
		return false
	}
	return (r.EndDate != nil && t.Date > *r.EndDate) || (!r.Active && r.GeneratedUntil != nil && t.Date > *r.GeneratedUntil)
}

func (s *Store) apply(tx *sql.Tx, uid string, op Op, res OpResult, ex exists, parentOf func(string) *string,
	nextRev func() (int64, error), stale func(string, int64) bool, u *usage) (OpResult, error) {
	var deleted bool
	var old string
	var oldRev int64 // 0 se o documento não existe
	err := tx.QueryRow(`SELECT deleted_at IS NOT NULL, data, rev FROM entities WHERE user_id=? AND kind=? AND id=?`,
		uid, op.Kind, op.ID).Scan(&deleted, &old, &oldRev)
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
	switch {
	case op.Kind == "recurrence" && stale(op.ID, oldRev) && found:
		if norm = staleRule(old, norm); norm == nil {
			return res, nil
		}
	case op.Kind == "transaction" && !found && pastEnd(tx, uid, norm, stale):
		res.Status = "conflict"
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

// GCRev é o marco do GC: o maior rev de tombstone já descartado do usuário (0 = nunca descartou).
// Quem tem cursor menor que isso perdeu alguma exclusão e precisa refazer a cópia local inteira.
func (s *Store) GCRev(uid string) (rev int64, err error) {
	err = s.db.QueryRow(`SELECT gc_rev FROM users WHERE id=?`, uid).Scan(&rev)
	return
}

// GC remove os tombstones excluídos há mais que `retention` e sobe o marco (gc_rev) de cada usuário atingido,
// tudo numa transação. Linha viva não tem deleted_at e nunca casa com o filtro. Devolve quantas linhas saíram.
// ponytail: varre `entities` inteira (sem índice em deleted_at); roda 1x por dia e a tabela é pequena.
func (s *Store) GC(retention time.Duration) (int64, error) {
	cut := time.Now().UTC().Add(-retention).Format("2006-01-02 15:04:05") // mesmo formato do datetime('now')
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	const old = `e.deleted_at IS NOT NULL AND e.deleted_at < ?`
	// total_n conta tombstones (teto de 4x a cota): desce junto, senão o teto nunca liberaria.
	if _, err := tx.Exec(`UPDATE users SET
		  gc_rev  = MAX(gc_rev, (SELECT MAX(e.rev) FROM entities e WHERE e.user_id=users.id AND `+old+`)),
		  total_n = total_n - (SELECT COUNT(*) FROM entities e WHERE e.user_id=users.id AND `+old+`)
		WHERE id IN (SELECT e.user_id FROM entities e WHERE `+old+`)`, cut, cut, cut); err != nil {
		return 0, err
	}
	res, err := tx.Exec(`DELETE FROM entities AS e WHERE `+old, cut)
	if err != nil {
		return 0, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}
	return n, tx.Commit()
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
	// Escrita primeiro: pega o lock antes de ler o rev (um Push concorrente espera, em vez de dar BUSY ou rev velho).
	var rev int64
	if err := tx.QueryRow(`UPDATE users SET rev=rev WHERE id=? RETURNING rev`, uid).Scan(&rev); err != nil {
		return err
	}
	// rev único por linha (o pull pagina por rev e empate pularia itens), tudo num UPDATE só.
	res, err := tx.Exec(`UPDATE entities SET deleted_at=datetime('now'), data='{}', rev=?+t.n
		FROM (SELECT kind,id,ROW_NUMBER() OVER (ORDER BY rev) n FROM entities WHERE user_id=? AND deleted_at IS NULL) t
		WHERE entities.user_id=? AND entities.kind=t.kind AND entities.id=t.id`, rev, uid, uid)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE users SET rev=?, rows_n=0, bytes_n=0 WHERE id=?`, rev+n, uid); err != nil {
		return err
	}
	return tx.Commit()
}
