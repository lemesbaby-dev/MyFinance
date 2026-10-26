package api

import (
	"fmt"
	"strings"
	"testing"

	"financas/internal/store"
)

type m = map[string]any

var opSeq int

func op(kind, id, action string, data m) m {
	opSeq++
	o := m{"op_id": fmt.Sprintf("op%d", opSeq), "kind": kind, "id": id, "action": action}
	if data != nil {
		o["data"] = data
	}
	return o
}

func upsert(kind, id string, data m) m { return op(kind, id, "upsert", data) }

func account(name string) m {
	return m{"name": name, "type": "checking", "initial_balance_cents": 100000, "archived": false}
}

func expense(acc string, extra m) m {
	d := m{"kind": "expense", "description": "Mercado", "amount_cents": 1500, "date": "2026-10-10",
		"status": "pending", "account_id": acc}
	for k, v := range extra {
		d[k] = v
	}
	return d
}

// push envia o lote e devolve os status por operação.
func (e *env) push(tok string, ops ...m) []string {
	e.t.Helper()
	code, o, _ := e.do("POST", "/api/sync", tok, m{"ops": ops})
	if code != 200 {
		e.t.Fatalf("push: %d %v", code, o)
	}
	var st []string
	for _, r := range o["results"].([]any) {
		rm := r.(map[string]any)
		s := rm["status"].(string)
		if s == "rejected" {
			s += ": " + rm["error"].(string)
		}
		st = append(st, s)
	}
	return st
}

type change struct {
	Kind, ID string
	Rev      int64
	Deleted  bool
	Data     map[string]any
}

func (e *env) pull(tok string, since int64) ([]change, int64, bool) {
	e.t.Helper()
	code, o, _ := e.do("GET", fmt.Sprintf("/api/sync?since=%d", since), tok, nil)
	if code != 200 {
		e.t.Fatalf("pull: %d %v", code, o)
	}
	var out []change
	for _, c := range o["changes"].([]any) {
		cm := c.(map[string]any)
		ch := change{Kind: cm["kind"].(string), ID: cm["id"].(string), Rev: int64(cm["rev"].(float64)), Deleted: cm["deleted"].(bool)}
		ch.Data, _ = cm["data"].(map[string]any)
		out = append(out, ch)
	}
	return out, int64(o["cursor"].(float64)), o["more"].(bool)
}

func wantStatus(t *testing.T, got []string, want ...string) {
	t.Helper()
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("status = %v, quero %v", got, want)
	}
}

func TestSyncIdaEVolta(t *testing.T) {
	e := newEnv(t)
	wantStatus(t, e.push("", upsert("account", "acc1", account("Nubank")),
		upsert("category", "cat1", m{"name": "Mercado", "kind": "expense", "parent_id": nil, "color": ""}),
		upsert("transaction", "tx1", expense("acc1", m{"category_id": "cat1"}))), "ok", "ok", "ok")

	ch, cursor, more := e.pull("", 0)
	if len(ch) != 3 || more || cursor != 3 {
		t.Fatalf("pull = %d mudanças, cursor %d, more %v", len(ch), cursor, more)
	}
	for i, c := range ch {
		if c.Rev != int64(i+1) {
			t.Errorf("rev fora de ordem: %+v", c)
		}
	}
	if ch[2].Data["amount_cents"].(float64) != 1500 || ch[2].Data["category_id"] != "cat1" {
		t.Errorf("dados do lançamento: %v", ch[2].Data)
	}
	// outro aparelho do mesmo usuário (outra sessão) recebe o mesmo
	tok2 := e.login("ana", "ana@x.com")
	if ch2, _, _ := e.pull(tok2, 0); len(ch2) != 3 {
		t.Errorf("2º aparelho recebeu %d, quero 3", len(ch2))
	}
	// pull incremental: nada novo depois do cursor
	if ch, c2, _ := e.pull("", cursor); len(ch) != 0 || c2 != cursor {
		t.Errorf("pull incremental trouxe %d, cursor %d", len(ch), c2)
	}
	// edição: só a linha editada volta, com rev maior (última escrita vence)
	wantStatus(t, e.push("", upsert("transaction", "tx1", expense("acc1", m{"amount_cents": 2000, "status": "paid", "paid_at": "2026-10-11"}))), "ok")
	ch, cursor, _ = e.pull("", cursor)
	if len(ch) != 1 || ch[0].ID != "tx1" || ch[0].Data["amount_cents"].(float64) != 2000 || cursor != 4 {
		t.Errorf("pull após edição: %+v cursor %d", ch, cursor)
	}
}

func TestSyncIdempotente(t *testing.T) {
	e := newEnv(t)
	batch := []m{upsert("account", "acc1", account("A")), upsert("transaction", "tx1", expense("acc1", nil))}
	wantStatus(t, e.push("", batch...), "ok", "ok")
	_, c1, _ := e.pull("", 0)
	// a rede caiu depois do servidor aplicar: o app reenvia o MESMO lote
	wantStatus(t, e.push("", batch...), "dup", "dup")
	if ch, c2, _ := e.pull("", 0); len(ch) != 2 || c2 != c1 {
		t.Errorf("reenvio mudou o estado: %d linhas, cursor %d→%d", len(ch), c1, c2)
	}
}

func TestSyncExclusaoVenceEdicao(t *testing.T) {
	e := newEnv(t)
	e.push("", upsert("account", "acc1", account("A")), upsert("transaction", "tx1", expense("acc1", nil)))
	wantStatus(t, e.push("", op("transaction", "tx1", "delete", nil)), "ok")
	ch, _, _ := e.pull("", 2)
	if len(ch) != 1 || !ch[0].Deleted || ch[0].ID != "tx1" {
		t.Fatalf("tombstone esperado: %+v", ch)
	}
	// aparelho offline editou antes de saber da exclusão: a exclusão vence
	wantStatus(t, e.push("", upsert("transaction", "tx1", expense("acc1", m{"amount_cents": 9}))), "gone")
	if ch, _, _ := e.pull("", 3); len(ch) != 0 {
		t.Errorf("edição ressuscitou o lançamento: %+v", ch)
	}
	// excluir de novo é inofensivo; excluir o que o servidor nunca viu é no-op (sem tombstone)
	wantStatus(t, e.push("", op("transaction", "tx1", "delete", nil), op("transaction", "txX", "delete", nil)), "ok", "ok")
	if ch, _, _ := e.pull("", 3); len(ch) != 0 {
		t.Errorf("delete de id desconhecido gravou algo: %+v", ch)
	}
	wantStatus(t, e.push("", upsert("transaction", "txX", expense("acc1", nil))), "ok")
}

func TestSyncRejeitaSemDerrubarOLote(t *testing.T) {
	e := newEnv(t)
	e.push("", upsert("account", "acc1", account("A")), upsert("account", "acc2", account("B")))
	bad := func(extra m) m {
		return upsert("transaction", "t"+fmt.Sprint(len(extra))+fmt.Sprint(opSeq), expense("acc1", extra))
	}
	st := e.push("",
		bad(m{"amount_cents": 0}),
		bad(m{"date": "01/10/2026"}),
		bad(m{"campo_estranho": 1}),
		bad(m{"kind": "pix"}),
		bad(m{"kind": "transfer", "transfer_account_id": "acc1"}),
		bad(m{"account_id": "naoexiste"}),
		bad(m{"status": "paid"}), // paid sem paid_at
		bad(m{"installment_no": 1}),
		bad(m{"description": strings.Repeat("x", 500)}),
		upsert("transaction", "id com espaço", expense("acc1", nil)),
		op("transaction", "txok", "explode", nil),
		upsert("coisa", "x", m{}),
		upsert("transaction", "tx-valida", expense("acc1", nil)), // a boa, no meio do lixo
	)
	for i, s := range st[:12] {
		if !strings.HasPrefix(s, "rejected") {
			t.Errorf("caso inválido %d aceito: %s", i, s)
		}
	}
	if st[12] != "ok" {
		t.Errorf("a operação válida deveria passar: %s", st[12])
	}
	if ch, _, _ := e.pull("", 2); len(ch) != 1 || ch[0].ID != "tx-valida" {
		t.Errorf("só a válida deveria ter gravado: %+v", ch)
	}
	// transferência válida
	wantStatus(t, e.push("", upsert("transaction", "tr1", expense("acc1", m{"kind": "transfer", "transfer_account_id": "acc2"}))), "ok")
}

func TestSyncIsolamentoEntreUsuarios(t *testing.T) {
	e := newEnv(t)
	ana := e.tok
	bia := e.login("bia", "bia@x.com")
	e.push(ana, upsert("account", "acc-ana", account("Ana")), upsert("transaction", "tx-ana", expense("acc-ana", nil)))

	if ch, c, _ := e.pull(bia, 0); len(ch) != 0 || c != 0 {
		t.Errorf("Bia viu dados da Ana: %+v", ch)
	}
	// Bia não pode apontar para a conta da Ana
	wantStatus(t, e.push(bia,
		upsert("transaction", "tx-bia", expense("acc-ana", nil)),
		upsert("recurrence", "rec-bia", m{"kind": "expense", "description": "x", "amount_cents": 1, "account_id": "acc-ana",
			"frequency": "monthly", "interval_n": 1, "start_date": "2026-10-01", "active": true})),
		"rejected: conta inválida", "rejected: conta inválida")
	// usar o mesmo id que a Ana: cria o PRÓPRIO registro, sem tocar no dela
	wantStatus(t, e.push(bia, upsert("account", "acc-ana", account("da Bia")), op("transaction", "tx-ana", "delete", nil)), "ok", "ok")
	ch, _, _ := e.pull(ana, 0)
	if len(ch) != 2 {
		t.Fatalf("Ana deveria ter 2 linhas, tem %d", len(ch))
	}
	for _, c := range ch {
		if c.Deleted || (c.Kind == "account" && c.Data["name"] != "Ana") {
			t.Errorf("Bia alterou dado da Ana: %+v", c)
		}
	}
	// op_id é por usuário: o mesmo op_id de outra pessoa não vira "dup"
	o := upsert("account", "a1", account("X"))
	wantStatus(t, e.push(ana, o), "ok")
	wantStatus(t, e.push(bia, o), "ok")
}

func TestSyncRecorrenciaNaoDuplica(t *testing.T) {
	e := newEnv(t)
	e.push("", upsert("account", "acc1", account("A")),
		upsert("recurrence", "rec1", m{"kind": "expense", "description": "Academia", "amount_cents": 9900, "account_id": "acc1",
			"frequency": "monthly", "interval_n": 1, "start_date": "2026-10-01", "active": true}))
	occ := func(id string) m {
		return upsert("transaction", id, expense("acc1", m{"recurrence_id": "rec1", "date": "2026-11-01"}))
	}
	// dois aparelhos materializaram a mesma ocorrência, cada um com seu UUID
	wantStatus(t, e.push("", occ("tx-aparelho-A")), "ok")
	wantStatus(t, e.push("", occ("tx-aparelho-B")), "conflict")
	// outro dia da mesma recorrência é normal
	wantStatus(t, e.push("", upsert("transaction", "tx-dez", expense("acc1", m{"recurrence_id": "rec1", "date": "2026-12-01"}))), "ok")
	// editar a própria ocorrência (mesmo id) não conflita consigo mesma
	wantStatus(t, e.push("", upsert("transaction", "tx-aparelho-A", expense("acc1", m{"recurrence_id": "rec1", "date": "2026-11-01", "amount_cents": 1}))), "ok")
	// recorrência inexistente
	wantStatus(t, e.push("", upsert("transaction", "tx-x", expense("acc1", m{"recurrence_id": "nao"}))), "rejected: recorrência inválida")
}

func TestSyncPaginacaoELimites(t *testing.T) {
	e := newEnv(t)
	ops := []m{upsert("account", "acc1", account("A"))}
	for i := 0; i < 5; i++ {
		ops = append(ops, upsert("transaction", fmt.Sprintf("tx%d", i), expense("acc1", nil)))
	}
	e.push("", ops...)
	code, o, _ := e.do("GET", "/api/sync?since=0&limit=4", "", nil)
	if code != 200 || len(o["changes"].([]any)) != 4 || o["more"] != true || o["cursor"].(float64) != 4 {
		t.Fatalf("página 1: %d %v", code, o)
	}
	code, o, _ = e.do("GET", "/api/sync?since=4&limit=4", "", nil)
	if len(o["changes"].([]any)) != 2 || o["more"] != false {
		t.Errorf("página 2: %v", o)
	}

	big := make([]m, store.MaxOps+1)
	for i := range big {
		big[i] = upsert("account", fmt.Sprintf("a%d", i), account("A"))
	}
	if code, _, _ := e.do("POST", "/api/sync", "", m{"ops": big}); code != 400 {
		t.Errorf("lote de %d operações deveria dar 400, deu %d", len(big), code)
	}
	for _, path := range []string{"/api/sync?since=0"} {
		if code, _, _ := e.do("GET", path, "-", nil); code != 401 {
			t.Errorf("sync sem sessão deveria dar 401, deu %d", code)
		}
	}
}

func TestSyncReenvioDeRecusadaDevolveOMesmoStatus(t *testing.T) {
	e := newEnv(t)
	bad := upsert("transaction", "t1", expense("naoexiste", nil))
	wantStatus(t, e.push("", bad), "rejected: conta inválida")
	wantStatus(t, e.push("", bad), "rejected: conta inválida") // não vira dup
	e.push("", upsert("account", "acc1", account("A")), upsert("transaction", "t2", expense("acc1", nil)),
		op("transaction", "t2", "delete", nil))
	gone := upsert("transaction", "t2", expense("acc1", nil))
	wantStatus(t, e.push("", gone), "gone")
	wantStatus(t, e.push("", gone), "gone")
	conf := upsert("transaction", "t3", expense("acc1", m{"recurrence_id": "r", "date": "2026-11-01"}))
	e.push("", upsert("recurrence", "r", m{"kind": "expense", "description": "x", "amount_cents": 1, "account_id": "acc1",
		"frequency": "monthly", "interval_n": 1, "start_date": "2026-10-01", "active": true}),
		upsert("transaction", "t4", expense("acc1", m{"recurrence_id": "r", "date": "2026-11-01"})))
	wantStatus(t, e.push("", conf), "conflict")
	wantStatus(t, e.push("", conf), "conflict")
}

func TestSyncEdicaoComPaiExcluido(t *testing.T) {
	e := newEnv(t)
	e.push("", upsert("account", "acc1", account("A")), upsert("account", "acc2", account("B")),
		upsert("transaction", "tx1", expense("acc1", nil)))
	e.push("", op("account", "acc1", "delete", nil))
	// o app é quem cascateia: editar o lançamento que já apontava para a conta excluída passa
	wantStatus(t, e.push("", upsert("transaction", "tx1", expense("acc1", m{"amount_cents": 7}))), "ok")
	// referência NOVA continua exigindo conta viva
	wantStatus(t, e.push("", upsert("transaction", "tx2", expense("acc1", nil))), "rejected: conta inválida")
	wantStatus(t, e.push("", upsert("transaction", "tx1", expense("acc2", nil))), "ok")
	wantStatus(t, e.push("", upsert("transaction", "tx1", expense("acc1", nil))), "rejected: conta inválida") // acc1 já não é do doc
}

func TestSyncConflitoEmUpdateEhRejected(t *testing.T) {
	e := newEnv(t)
	e.push("", upsert("account", "acc1", account("A")),
		upsert("recurrence", "rec1", m{"kind": "expense", "description": "x", "amount_cents": 1, "account_id": "acc1",
			"frequency": "monthly", "interval_n": 1, "start_date": "2026-10-01", "active": true}))
	occ := func(id, date string) m {
		return upsert("transaction", id, expense("acc1", m{"recurrence_id": "rec1", "date": date}))
	}
	wantStatus(t, e.push("", occ("a", "2026-11-01"), occ("b", "2026-12-01")), "ok", "ok")
	wantStatus(t, e.push("", occ("b", "2026-11-01")), "rejected: já existe uma ocorrência desta recorrência nessa data")
}

func TestSyncCategoriaSemCiclo(t *testing.T) {
	e := newEnv(t)
	cat := func(id string, parent any) m {
		return upsert("category", id, m{"name": id, "kind": "expense", "parent_id": parent, "color": ""})
	}
	wantStatus(t, e.push("", cat("a", nil), cat("b", "a"), cat("c", "b")), "ok", "ok", "ok")
	wantStatus(t, e.push("", cat("a", "c")), "rejected: hierarquia de categorias inválida (ciclo ou mais de 10 níveis)")
	wantStatus(t, e.push("", cat("a", "a")), "rejected: categoria-mãe inválida")
	// cadeia funda demais
	prev := "c"
	var ops []m
	for i := 0; i < 11; i++ {
		id := fmt.Sprint("n", i)
		ops = append(ops, cat(id, prev))
		prev = id
	}
	st := e.push("", ops...)
	if !strings.HasPrefix(st[10], "rejected") || st[0] != "ok" {
		t.Errorf("cadeia > 10 níveis deveria ser recusada no fim: %v", st)
	}
}

func TestSyncPullDevolveRev(t *testing.T) {
	e := newEnv(t)
	e.push("", upsert("account", "acc1", account("A")), upsert("account", "acc2", account("B")))
	if _, o, _ := e.do("GET", "/api/sync?since=0", "", nil); o["rev"].(float64) != 2 {
		t.Errorf("rev = %v, quero 2", o["rev"])
	}
}
