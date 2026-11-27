package api

import (
	"fmt"
	"testing"
)

// Issue #29: escrita de regra de recorrência baseada em cópia antiga (cursor do push < rev da regra).

func rec(extra m) m {
	d := m{"kind": "expense", "description": "Aluguel", "amount_cents": 9900, "account_id": "acc1", "category_id": nil,
		"frequency": "monthly", "interval_n": 1, "start_date": "2026-01-10", "end_date": nil, "active": true,
		"generated_until": "2027-01-10"}
	for k, v := range extra {
		d[k] = v
	}
	return d
}

func occ(id, date string, extra m) m {
	d := m{"recurrence_id": "rec1", "date": date}
	for k, v := range extra {
		d[k] = v
	}
	return upsert("transaction", id, expense("acc1", d))
}

// doc devolve o documento vivo e o cursor de quem acabou de ler tudo.
func (e *env) doc(id string) (map[string]any, int64) {
	e.t.Helper()
	ch, cursor, _ := e.pull("", 0)
	for _, c := range ch {
		if c.ID == id && !c.Deleted {
			return c.Data, cursor
		}
	}
	return nil, cursor
}

func (e *env) wantRule(what string, endDate any, active bool, generatedUntil string) {
	e.t.Helper()
	r, _ := e.doc("rec1")
	if r["end_date"] != endDate || r["active"] != active || r["generated_until"] != generatedUntil {
		e.t.Errorf("%s: end_date=%v active=%v generated_until=%v; quero %v %v %v", what,
			r["end_date"], r["active"], r["generated_until"], endDate, active, generatedUntil)
	}
}

// seed: conta + regra + uma ocorrência efetivada; devolve o cursor do aparelho B, que para de sincronizar aqui.
func seedRule(e *env) int64 {
	e.t.Helper()
	wantStatus(e.t, e.push("", upsert("account", "acc1", account("A")), upsert("recurrence", "rec1", rec(nil)),
		occ("tx-jan", "2026-01-10", m{"status": "paid", "paid_at": "2026-01-10"})), "ok", "ok", "ok")
	_, cursor := e.doc("rec1")
	return cursor
}

func TestSyncCopiaAntigaNaoReabreRegraEncerrada(t *testing.T) {
	for name, ended := range map[string]m{
		"esta e as próximas (end_date)": {"end_date": "2026-06-30"},
		"excluir todas (active:false)":  {"active": false},
		"encerrar (os dois)":            {"end_date": "2026-06-30", "active": false},
	} {
		t.Run(name, func(t *testing.T) {
			e := newEnv(t)
			b := seedRule(e)
			// aparelho A, em dia, encerra a regra
			_, a := e.doc("rec1")
			wantStatus(t, e.pushAt(a, upsert("recurrence", "rec1", rec(ended))), "ok")
			end, active := ended["end_date"], ended["active"] != false

			// aparelho B abre semanas depois com a cópia antiga: estende (ocorrências novas + a regra inteira, sem o encerramento)
			wantStatus(t, e.pushAt(b,
				occ("tx-b1", "2027-02-10", nil),
				occ("tx-b2", "2027-03-10", m{"status": "paid", "paid_at": "2027-03-10"}), // B gerou e o usuário efetivou offline
				upsert("recurrence", "rec1", rec(m{"generated_until": "2027-03-10", "description": "cópia de B"})),
			), "conflict", "ok", "ok")
			e.wantRule("extensão da cópia antiga", end, active, "2027-03-10")
			if r, _ := e.doc("rec1"); r["description"] != "cópia de B" {
				t.Errorf("os outros campos seguem o último documento: %v", r["description"])
			}
			if d, _ := e.doc("tx-b1"); d != nil {
				t.Errorf("ocorrência pendente além do encerramento ficou: %v", d)
			}
			if d, _ := e.doc("tx-b2"); d == nil {
				t.Errorf("ocorrência efetivada não pode sumir")
			}
			if d, _ := e.doc("tx-jan"); d == nil || d["status"] != "paid" {
				t.Errorf("o que já existia não muda: %v", d)
			}

			// outro lote do mesmo envio (mesmo cursor), e a regra duas vezes no mesmo lote (B estendeu offline em dois dias)
			wantStatus(t, e.pushAt(b,
				occ("tx-b3", "2027-04-10", nil),
				upsert("recurrence", "rec1", rec(m{"generated_until": "2027-04-10"})),
				occ("tx-b4", "2027-05-10", nil),
				upsert("recurrence", "rec1", rec(m{"generated_until": "2027-05-10"})),
			), "conflict", "ok", "conflict", "ok")
			e.wantRule("2º lote", end, active, "2027-05-10")

			// app antigo em cache (não manda cursor) e generated_until que não recua
			wantStatus(t, e.push("", occ("tx-b5", "2027-06-10", nil), upsert("recurrence", "rec1", rec(m{"generated_until": "2026-12-10"}))), "conflict", "ok")
			e.wantRule("app sem cursor", end, active, "2027-05-10")

			// ocorrência dentro do que a regra cobria continua entrando (servidor restaurado, reenvio da cópia local)
			wantStatus(t, e.pushAt(b, occ("tx-b6", "2026-05-10", nil)), "ok")
		})
	}
}

func TestSyncRegraDivididaNaoDuplicaPorCopiaAntiga(t *testing.T) {
	e := newEnv(t)
	b := seedRule(e)
	wantStatus(t, e.pushAt(b, occ("tx-jul", "2026-07-10", nil)), "ok") // pendente que B conhece
	_, b = e.doc("rec1")
	// A edita "esta e as próximas" em julho: regra nova, a antiga termina na véspera e a pendente é religada
	_, a := e.doc("rec1")
	wantStatus(t, e.pushAt(a,
		upsert("recurrence", "rec2", rec(m{"amount_cents": 12000})),
		upsert("recurrence", "rec1", rec(m{"end_date": "2026-07-09"})),
		occ("tx-jul", "2026-07-10", m{"recurrence_id": "rec2", "amount_cents": 12000}),
		occ("tx-a-fev", "2027-02-10", m{"recurrence_id": "rec2", "amount_cents": 12000}), // A estendeu a regra nova
	), "ok", "ok", "ok", "ok")

	wantStatus(t, e.pushAt(b, occ("tx-b-fev", "2027-02-10", nil), upsert("recurrence", "rec1", rec(m{"generated_until": "2027-02-10"}))), "conflict", "ok")
	e.wantRule("regra dividida", "2026-07-09", true, "2027-02-10")
	ch, _, _ := e.pull("", 0)
	perDate := map[string]int{}
	for _, c := range ch {
		if c.Kind == "transaction" && !c.Deleted {
			perDate[fmt.Sprint(c.Data["date"])]++
		}
	}
	for d, n := range perDate {
		if n > 1 {
			t.Errorf("%d lançamentos em %s", n, d)
		}
	}
}

func TestSyncAparelhoEmDiaPodeReabrirRegra(t *testing.T) {
	e := newEnv(t)
	seedRule(e)
	at := func() int64 { _, c := e.doc("rec1"); return c }
	wantStatus(t, e.pushAt(at(), upsert("recurrence", "rec1", rec(m{"end_date": "2026-06-30", "active": false}))), "ok")
	// quem já leu o encerramento pode adiar e tirar a data final, reativar e recuar o generated_until (issue #33)
	wantStatus(t, e.pushAt(at(), upsert("recurrence", "rec1", rec(m{"end_date": "2026-09-30", "active": false}))), "ok")
	e.wantRule("adiar", "2026-09-30", false, "2027-01-10")
	wantStatus(t, e.pushAt(at(), upsert("recurrence", "rec1", rec(m{"generated_until": "2026-06-30"}))), "ok")
	e.wantRule("tirar e reativar", nil, true, "2026-06-30")
	// duas edições na fila, no mesmo lote: a regra só mudou por este aparelho
	wantStatus(t, e.pushAt(at(),
		upsert("recurrence", "rec1", rec(m{"end_date": "2026-03-31"})),
		upsert("recurrence", "rec1", rec(nil)),
		occ("tx-abr", "2026-04-10", nil),
	), "ok", "ok", "ok")
	e.wantRule("encerrar e reabrir no mesmo lote", nil, true, "2027-01-10")
	// regra criada e encerrada na mesma fila, e ocorrência pendente além do fim gravada por quem está em dia
	wantStatus(t, e.pushAt(at(), upsert("recurrence", "rec1", rec(m{"end_date": "2026-03-31"}))), "ok")
	wantStatus(t, e.pushAt(at(), occ("tx-dez", "2026-12-10", nil)), "ok")
}

func TestSyncCopiaAntigaInconciliavelNaoGravaRegraInvalida(t *testing.T) {
	e := newEnv(t)
	b := seedRule(e)
	_, a := e.doc("rec1")
	wantStatus(t, e.pushAt(a, upsert("recurrence", "rec1", rec(m{"end_date": "2026-06-30"}))), "ok")
	// a cópia antiga mudou o início para depois do fim que ela não viu: fica o documento gravado (sem "recusado")
	wantStatus(t, e.pushAt(b, upsert("recurrence", "rec1", rec(m{"start_date": "2026-08-10", "description": "cópia de B"}))), "ok")
	if r, _ := e.doc("rec1"); r["start_date"] != "2026-01-10" || r["end_date"] != "2026-06-30" || r["description"] != "Aluguel" {
		t.Errorf("regra = %v", r)
	}
}
