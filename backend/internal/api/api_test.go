package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"financas/internal/auth"
	"financas/internal/store"
)

// fakeVerifier: o "id_token" de teste é "<sub>|<email>"; sem "|" é recusado.
type fakeVerifier struct{}

func (fakeVerifier) Verify(_ context.Context, tok string) (auth.Claims, error) {
	sub, email, ok := strings.Cut(tok, "|")
	if !ok {
		return auth.Claims{}, errors.New("token inválido")
	}
	return auth.Claims{Sub: sub, Email: email, Name: sub}, nil
}

type env struct {
	t   *testing.T
	st  *store.Store
	h   http.Handler
	tok string // sessão do usuário padrão "ana"; token "-" nas chamadas = anônimo
}

func newEnv(t *testing.T) *env { return newEnvMax(t, 0) }

func newEnvMax(t *testing.T, maxUsers int) *env {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	e := &env{t: t, st: st, h: (&Server{Store: st, Verifier: fakeVerifier{}, MaxUsers: maxUsers, HorizonMonths: 12}).Handler()}
	if maxUsers == 0 {
		e.tok = e.login("ana", "ana@x.com")
	}
	return e
}

// login faz o fluxo real /api/auth/google e devolve o token de sessão.
func (e *env) login(sub, email string) string {
	e.t.Helper()
	code, o, _ := e.do("POST", "/api/auth/google", "-", map[string]any{"id_token": sub + "|" + email, "device": "teste"})
	if code != 200 {
		e.t.Fatalf("login %s: %d %v", sub, code, o)
	}
	return o["token"].(string)
}

func (e *env) do(method, path, token string, body any) (int, map[string]any, []map[string]any) {
	e.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	if token == "" {
		token = e.tok
	}
	if token != "-" {
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
	e := newEnv(t)
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
	e := newEnv(t)
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
	e := newEnv(t)
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
	e := newEnv(t)
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

func TestValidacao(t *testing.T) {
	e := newEnv(t)
	_, o, _ := e.do("POST", "/api/accounts", "", map[string]any{"name": "A"})
	a := id(o)
	bad := []map[string]any{
		{"kind": "expense", "description": "x", "amount_cents": 0, "date": "2026-10-01", "account_id": a},
		{"kind": "expense", "description": "x", "amount_cents": 100, "date": "01/10/2026", "account_id": a},
		{"kind": "transfer", "description": "x", "amount_cents": 100, "date": "2026-10-01", "account_id": a, "transfer_account_id": a},
		{"kind": "expense", "description": "x", "amount_cents": 100, "date": "2026-10-01", "account_id": a, "campo_estranho": 1},
		{"kind": "pix", "description": "x", "amount_cents": 100, "date": "2026-10-01", "account_id": a},
	}
	for i, b := range bad {
		if code, _, _ := e.do("POST", "/api/transactions", "", b); code != 400 {
			t.Errorf("caso inválido %d aceito (status %d)", i, code)
		}
	}
}

func TestAuth(t *testing.T) {
	e := newEnv(t)
	for _, tok := range []string{"-", "lixo"} {
		if code, _, _ := e.do("GET", "/api/summary", tok, nil); code != 401 {
			t.Errorf("token %q deveria dar 401, deu %d", tok, code)
		}
	}
	if code, _, _ := e.do("GET", "/api/health", "-", nil); code != 200 {
		t.Errorf("health deve ser público, deu %d", code)
	}
	if code, _, _ := e.do("POST", "/api/auth/google", "-", map[string]any{"id_token": "ruim"}); code != 401 {
		t.Errorf("id_token inválido deveria dar 401, deu %d", code)
	}
	if code, o, _ := e.do("GET", "/api/auth/me", "", nil); code != 200 || o["email"] != "ana@x.com" {
		t.Errorf("me = %d %v", code, o)
	}
	// logout invalida a sessão
	e.do("POST", "/api/auth/logout", "", nil)
	if code, _, _ := e.do("GET", "/api/summary", "", nil); code != 401 {
		t.Errorf("após logout deveria dar 401, deu %d", code)
	}
	// novo login do mesmo Google = mesmo usuário (casa por sub, mesmo com e-mail novo)
	e.tok = e.login("ana", "ana.nova@x.com")
	if _, o, _ := e.do("GET", "/api/auth/me", "", nil); o["email"] != "ana.nova@x.com" {
		t.Errorf("e-mail não atualizou: %v", o)
	}
}

func userID(t *testing.T, e *env) string {
	t.Helper()
	u, err := e.st.SessionUser(e.tok, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	return u.ID
}

func TestSessaoExpirada(t *testing.T) {
	e := newEnv(t)
	tok, _ := e.st.NewSession(userID(t, e), "x", -time.Minute) // já nasce vencida
	if code, _, _ := e.do("GET", "/api/summary", tok, nil); code != 401 {
		t.Errorf("sessão vencida deveria dar 401, deu %d", code)
	}
	if code, _, _ := e.do("GET", "/api/summary", "", nil); code != 200 {
		t.Errorf("sessão válida deveria dar 200, deu %d", code)
	}
}

func TestCadastroEncerrado(t *testing.T) {
	e := newEnvMax(t, 1)
	e.login("ana", "ana@x.com")
	code, _, _ := e.do("POST", "/api/auth/google", "-", map[string]any{"id_token": "bia|bia@x.com"})
	if code != 403 {
		t.Errorf("2º usuário com MAX_USERS=1 deveria dar 403, deu %d", code)
	}
	e.login("ana", "ana@x.com") // quem já existe continua entrando
}

// O ponto central do M1: ninguém lê nem altera dado de outra pessoa.
func TestIsolamentoEntreUsuarios(t *testing.T) {
	e := newEnv(t)
	ana := e.tok
	bia := e.login("bia", "bia@x.com")

	_, o, _ := e.do("POST", "/api/accounts", ana, map[string]any{"name": "Conta da Ana", "initial_balance_cents": 100000})
	contaAna := id(o)
	_, o, _ = e.do("POST", "/api/categories", ana, map[string]any{"name": "Mercado", "kind": "expense"})
	catAna := id(o)
	_, o, _ = e.do("POST", "/api/transactions", ana, map[string]any{
		"kind": "expense", "description": "Segredo da Ana", "amount_cents": 5000, "date": "2026-10-10", "account_id": contaAna})
	txAna := id(o)

	// Bia não vê nada da Ana
	if _, s, _ := e.do("GET", "/api/summary?until=2026-10-31", bia, nil); s["current_cents"].(float64) != 0 || len(s["accounts"].([]any)) != 0 {
		t.Errorf("Bia viu contas da Ana: %v", s)
	}
	if _, _, l := e.do("GET", "/api/transactions", bia, nil); len(l) != 0 {
		t.Errorf("Bia listou %d lançamentos da Ana", len(l))
	}
	if _, _, l := e.do("GET", "/api/categories", bia, nil); len(l) != 0 {
		t.Errorf("Bia listou %d categorias da Ana", len(l))
	}

	// Bia não consegue mexer no lançamento da Ana (pagar, excluir)
	p := "/api/transactions/" + itoa(txAna)
	if code, _, _ := e.do("POST", p+"/pay", bia, map[string]any{}); code != 404 {
		t.Errorf("Bia pagou lançamento da Ana (status %d)", code)
	}
	e.do("DELETE", p, bia, nil)
	if _, _, l := e.do("GET", "/api/transactions", ana, nil); len(l) != 1 {
		t.Errorf("Bia apagou o lançamento da Ana (sobraram %d)", len(l))
	}

	// Bia não consegue apontar para conta/categoria da Ana (o FK do SQLite sozinho aceitaria)
	_, o, _ = e.do("POST", "/api/accounts", bia, map[string]any{"name": "Conta da Bia"})
	contaBia := id(o)
	cases := []struct {
		path string
		body map[string]any
	}{
		{"/api/transactions", map[string]any{"kind": "expense", "description": "x", "amount_cents": 1, "date": "2026-10-01", "account_id": contaAna}},
		{"/api/transactions", map[string]any{"kind": "expense", "description": "x", "amount_cents": 1, "date": "2026-10-01", "account_id": contaBia, "category_id": catAna}},
		{"/api/transactions", map[string]any{"kind": "transfer", "description": "x", "amount_cents": 1, "date": "2026-10-01", "account_id": contaBia, "transfer_account_id": contaAna}},
		{"/api/transactions", map[string]any{"kind": "expense", "description": "x", "amount_cents": 1000, "date": "2026-10-01", "account_id": contaAna, "installments": 3}},
		{"/api/recurrences", map[string]any{"kind": "expense", "description": "x", "amount_cents": 1, "account_id": contaAna, "frequency": "monthly", "start_date": "2026-10-01"}},
		{"/api/categories", map[string]any{"name": "x", "kind": "expense", "parent_id": catAna}},
	}
	for i, c := range cases {
		if code, _, _ := e.do("POST", c.path, bia, c.body); code != 400 {
			t.Errorf("referência cruzada %d aceita (status %d)", i, code)
		}
	}
	// e o saldo da Ana segue intacto
	if _, s, _ := e.do("GET", "/api/summary?until=2026-10-31", ana, nil); s["projected_cents"].(float64) != 95000 {
		t.Errorf("saldo previsto da Ana = %v, quero 95000", s["projected_cents"])
	}
}

// A materialização diária cobre todos os usuários, sem misturar os donos.
func TestRecorrenciaPorUsuario(t *testing.T) {
	e := newEnv(t)
	bia := e.login("bia", "bia@x.com")
	for _, tok := range []string{e.tok, bia} {
		_, o, _ := e.do("POST", "/api/accounts", tok, map[string]any{"name": "C"})
		first := time.Now().Format("2006-01") + "-01"
		code, o2, _ := e.do("POST", "/api/recurrences", tok, map[string]any{
			"kind": "expense", "description": "Academia", "amount_cents": 100,
			"account_id": id(o), "frequency": "monthly", "start_date": first})
		e.mustOK(code, 201, o2)
	}
	if err := e.st.MaterializeAll(Horizon(time.Now(), 12)); err != nil {
		t.Fatal(err)
	}
	for name, tok := range map[string]string{"ana": e.tok, "bia": bia} {
		if _, _, l := e.do("GET", "/api/transactions", tok, nil); len(l) != 13 {
			t.Errorf("%s tem %d ocorrências, quero 13", name, len(l))
		}
	}
}
