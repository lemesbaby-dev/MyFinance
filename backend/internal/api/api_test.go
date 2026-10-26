package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"financas/internal/store"
)

type env struct {
	t  *testing.T
	st *store.Store
	h  http.Handler
}

func newEnv(t *testing.T, token string) *env {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return &env{t: t, st: st, h: (&Server{Store: st, Token: token, HorizonMonths: 12}).Handler()}
}

func (e *env) do(method, path, token string, body any) (int, map[string]any, []map[string]any) {
	e.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	raw := rec.Body.Bytes()
	var obj map[string]any
	var arr []map[string]any
	if json.Unmarshal(raw, &obj) != nil {
		_ = json.Unmarshal(raw, &arr)
	}
	return rec.Code, obj, arr
}

func (e *env) mustOK(code, want int, obj map[string]any) {
	e.t.Helper()
	if code != want {
		e.t.Fatalf("status %d, quero %d (%v)", code, want, obj)
	}
}

func id(obj map[string]any) int64 { return int64(obj["id"].(float64)) }

func TestSaldosAtualEPrevisto(t *testing.T) {
	e := newEnv(t, "")
	code, o, _ := e.do("POST", "/api/accounts", "", map[string]any{"name": "Nubank", "initial_balance_cents": 100000})
	e.mustOK(code, 201, o)
	a := id(o)
	code, o, _ = e.do("POST", "/api/accounts", "", map[string]any{"name": "Carteira", "initial_balance_cents": 5000})
	e.mustOK(code, 201, o)
	b := id(o)

	tx := func(m map[string]any) {
		t.Helper()
		m["account_id"] = a
		code, o, _ := e.do("POST", "/api/transactions", "", m)
		e.mustOK(code, 201, o)
	}
	tx(map[string]any{"kind": "income", "description": "Salário", "amount_cents": 500000, "date": "2026-10-05", "status": "paid"})
	tx(map[string]any{"kind": "expense", "description": "Aluguel", "amount_cents": 150000, "date": "2026-10-10", "status": "paid"})
	tx(map[string]any{"kind": "transfer", "description": "Saque", "amount_cents": 20000, "date": "2026-10-12", "status": "paid", "transfer_account_id": b})
	tx(map[string]any{"kind": "expense", "description": "Mercado", "amount_cents": 30000, "date": "2026-10-20"})
	tx(map[string]any{"kind": "expense", "description": "Internet", "amount_cents": 12000, "date": "2026-10-30"})
	tx(map[string]any{"kind": "income", "description": "Freela", "amount_cents": 80000, "date": "2026-11-10"})

	code, o, _ = e.do("GET", "/api/summary?until=2026-10-31", "", nil)
	e.mustOK(code, 200, o)
	// Nubank 430000/388000 + Carteira 25000/25000
	if o["current_cents"].(float64) != 455000 || o["projected_cents"].(float64) != 413000 {
		t.Errorf("saldos = %v / %v, quero 455000 / 413000", o["current_cents"], o["projected_cents"])
	}
	code, o, _ = e.do("GET", "/api/summary?until=2026-11-30", "", nil)
	e.mustOK(code, 200, o)
	if o["projected_cents"].(float64) != 493000 {
		t.Errorf("previsto até 30/11 = %v, quero 493000", o["projected_cents"])
	}
}

func TestPagarMudaSaldoAtual(t *testing.T) {
	e := newEnv(t, "")
	_, o, _ := e.do("POST", "/api/accounts", "", map[string]any{"name": "C", "initial_balance_cents": 10000})
	a := id(o)
	_, o, _ = e.do("POST", "/api/transactions", "", map[string]any{
		"kind": "expense", "description": "Luz", "amount_cents": 4000, "date": "2026-10-15", "account_id": a})
	tid := id(o)
	_, s, _ := e.do("GET", "/api/summary?until=2026-10-31", "", nil)
	if s["current_cents"].(float64) != 10000 || s["projected_cents"].(float64) != 6000 {
		t.Fatalf("antes de pagar: %v / %v", s["current_cents"], s["projected_cents"])
	}
	code, o, _ := e.do("POST", "/api/transactions/"+itoa(tid)+"/pay", "", map[string]any{})
	e.mustOK(code, 200, o)
	_, s, _ = e.do("GET", "/api/summary?until=2026-10-31", "", nil)
	if s["current_cents"].(float64) != 6000 || s["projected_cents"].(float64) != 6000 {
		t.Errorf("depois de pagar: %v / %v", s["current_cents"], s["projected_cents"])
	}
	if code, _, _ := e.do("POST", "/api/transactions/"+itoa(tid)+"/pay", "", map[string]any{}); code != 404 {
		t.Errorf("pagar duas vezes deveria dar 404, deu %d", code)
	}
	e.do("POST", "/api/transactions/"+itoa(tid)+"/unpay", "", nil)
	_, s, _ = e.do("GET", "/api/summary?until=2026-10-31", "", nil)
	if s["current_cents"].(float64) != 10000 {
		t.Errorf("após desfazer: atual = %v", s["current_cents"])
	}
}

func itoa(n int64) string { b, _ := json.Marshal(n); return string(b) }

func TestParcelas(t *testing.T) {
	e := newEnv(t, "")
	_, o, _ := e.do("POST", "/api/accounts", "", map[string]any{"name": "C"})
	a := id(o)
	code, o, _ := e.do("POST", "/api/transactions", "", map[string]any{
		"kind": "expense", "description": "TV", "amount_cents": 10000, "date": "2027-01-31",
		"account_id": a, "installments": 3})
	e.mustOK(code, 201, o)
	_, _, list := e.do("GET", "/api/transactions?from=2027-01-01&to=2027-12-31", "", nil)
	if len(list) != 3 {
		t.Fatalf("%d parcelas, quero 3", len(list))
	}
	wantAmt := []float64{3334, 3333, 3333}
	wantDate := []string{"2027-01-31", "2027-02-28", "2027-03-31"}
	var sum float64
	for i, p := range list {
		sum += p["amount_cents"].(float64)
		if p["amount_cents"].(float64) != wantAmt[i] || p["date"] != wantDate[i] || p["installment_no"].(float64) != float64(i+1) {
			t.Errorf("parcela %d = %v", i+1, p)
		}
	}
	if sum != 10000 {
		t.Errorf("soma = %v", sum)
	}
}

func TestRecorrenciaIdempotente(t *testing.T) {
	e := newEnv(t, "")
	_, o, _ := e.do("POST", "/api/accounts", "", map[string]any{"name": "C"})
	a := id(o)
	now := time.Now()
	first := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).Format("2006-01-02")
	code, o, _ := e.do("POST", "/api/recurrences", "", map[string]any{
		"kind": "expense", "description": "Academia", "amount_cents": 9900,
		"account_id": a, "frequency": "monthly", "start_date": first})
	e.mustOK(code, 201, o)

	count := func() int {
		_, _, list := e.do("GET", "/api/transactions", "", nil)
		n := 0
		for _, x := range list {
			if x["description"] == "Academia" {
				n++
			}
		}
		return n
	}
	if n := count(); n != 13 { // mês atual + 12 seguintes
		t.Fatalf("%d ocorrências, quero 13", n)
	}
	for i := 0; i < 3; i++ { // rodar de novo não pode duplicar
		if err := e.st.MaterializeAll(Horizon(now, 12)); err != nil {
			t.Fatal(err)
		}
	}
	if n := count(); n != 13 {
		t.Errorf("após reexecutar: %d ocorrências, quero 13", n)
	}
	// janela avança: com horizonte maior surgem só as novas
	if err := e.st.MaterializeAll(Horizon(now, 14)); err != nil {
		t.Fatal(err)
	}
	if n := count(); n != 15 {
		t.Errorf("após ampliar horizonte: %d, quero 15", n)
	}
}

func TestValidacaoEAuth(t *testing.T) {
	e := newEnv(t, "segredo")
	if code, _, _ := e.do("GET", "/api/summary", "", nil); code != 401 {
		t.Errorf("sem token deveria dar 401, deu %d", code)
	}
	if code, _, _ := e.do("GET", "/api/summary", "errado", nil); code != 401 {
		t.Errorf("token errado deveria dar 401, deu %d", code)
	}
	if code, _, _ := e.do("GET", "/api/health", "", nil); code != 200 {
		t.Errorf("health deve ser público, deu %d", code)
	}
	_, o, _ := e.do("POST", "/api/accounts", "segredo", map[string]any{"name": "A"})
	a := id(o)
	bad := []map[string]any{
		{"kind": "expense", "description": "x", "amount_cents": 0, "date": "2026-10-01", "account_id": a},
		{"kind": "expense", "description": "x", "amount_cents": 100, "date": "01/10/2026", "account_id": a},
		{"kind": "transfer", "description": "x", "amount_cents": 100, "date": "2026-10-01", "account_id": a, "transfer_account_id": a},
		{"kind": "expense", "description": "x", "amount_cents": 100, "date": "2026-10-01", "account_id": a, "campo_estranho": 1},
		{"kind": "pix", "description": "x", "amount_cents": 100, "date": "2026-10-01", "account_id": a},
	}
	for i, b := range bad {
		if code, _, _ := e.do("POST", "/api/transactions", "segredo", b); code != 400 {
			t.Errorf("caso inválido %d aceito (status %d)", i, code)
		}
	}
}
