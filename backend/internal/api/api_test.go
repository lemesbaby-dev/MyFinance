package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
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
	e := &env{t: t, st: st, h: (&Server{Store: st, Verifier: fakeVerifier{}, MaxUsers: maxUsers}).Handler()}
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

func TestLimiterEClientIP(t *testing.T) {
	var l limiter
	l.allow("1.1.1.1", 1)
	l.hits["1.1.1.1"][0] = time.Now().Add(-2 * time.Minute) // hit velho
	if !l.allow("1.1.1.1", 1) || len(l.hits["1.1.1.1"]) != 1 {
		t.Error("hit vencido deveria liberar")
	}
	for i := 0; i < 1500; i++ { // IPs que nunca voltam
		l.hits[strconv.Itoa(i)] = []time.Time{time.Now().Add(-2 * time.Minute)}
	}
	l.allow("3.3.3.3", 1)
	if len(l.hits) > 3 {
		t.Errorf("mapa não foi limpo: %d chaves", len(l.hits))
	}

	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("X-Forwarded-For", "9.9.9.9")
	r.RemoteAddr = "203.0.113.5:1234"
	if ip := clientIP(r); ip != "203.0.113.5" {
		t.Errorf("XFF forjado confiado: %s", ip)
	}
	r.RemoteAddr = "127.0.0.1:1234"
	if ip := clientIP(r); ip != "9.9.9.9" {
		t.Errorf("atrás do proxy deveria usar XFF: %s", ip)
	}
}

func TestMaxSessoes(t *testing.T) {
	e := newEnv(t)
	uid := userID(t, e)
	first, _ := e.st.NewSession(uid, "x", time.Hour)
	for i := 0; i < 25; i++ {
		e.st.NewSession(uid, "x", time.Hour)
	}
	if code, _, _ := e.do("GET", "/api/auth/me", first, nil); code != 401 {
		t.Errorf("sessão mais antiga deveria ter sido apagada, deu %d", code)
	}
	if code, _, _ := e.do("GET", "/api/auth/me", "", nil); code != 401 {
		// e.tok (login inicial) também é antiga demais: 26+ sessões emitidas
		t.Errorf("sessão inicial deveria ter sido apagada, deu %d", code)
	}
}

type errVerifier struct{ err error }

func (v errVerifier) Verify(context.Context, string) (auth.Claims, error) {
	return auth.Claims{}, v.err
}

func TestErrosNaoVazam(t *testing.T) {
	e := newEnv(t)
	for _, c := range []struct {
		err  error
		code int
		msg  string
	}{
		{auth.ErrUpstream, 503, "Google indisponível, tente novamente"},
		{errors.New("segredo interno: aud=xyz"), 401, "token do Google inválido"},
	} {
		h := (&Server{Store: e.st, Verifier: errVerifier{c.err}}).Handler()
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("POST", "/api/auth/google", strings.NewReader(`{"id_token":"x"}`)))
		if rec.Code != c.code || !strings.Contains(rec.Body.String(), c.msg) || strings.Contains(rec.Body.String(), "segredo") {
			t.Errorf("status %d corpo %s, quero %d %q", rec.Code, rec.Body.String(), c.code, c.msg)
		}
	}
	rec := httptest.NewRecorder()
	writeStoreErr(rec, errors.New("SQL: tabela x quebrou"))
	if rec.Code != 500 || strings.Contains(rec.Body.String(), "SQL") {
		t.Errorf("erro interno vazou: %d %s", rec.Code, rec.Body.String())
	}
}

func TestAuth(t *testing.T) {
	e := newEnv(t)
	for _, tok := range []string{"-", "lixo"} {
		if code, _, _ := e.do("GET", "/api/auth/me", tok, nil); code != 401 {
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
	if code, _, _ := e.do("GET", "/api/auth/me", "", nil); code != 401 {
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
	if code, _, _ := e.do("GET", "/api/auth/me", tok, nil); code != 401 {
		t.Errorf("sessão vencida deveria dar 401, deu %d", code)
	}
	if code, _, _ := e.do("GET", "/api/auth/me", "", nil); code != 200 {
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
