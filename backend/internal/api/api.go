// Package api expõe o HTTP/JSON. Usa só a stdlib (Go 1.22: roteamento por método e path).
package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"financas/internal/auth"
	"financas/internal/finance"
	"financas/internal/store"
)

type Server struct {
	Store    *store.Store
	Verifier auth.Verifier // valida o ID token do Google
	ClientID string        // Client ID do Google, exposto ao front em /api/auth/config
	MaxUsers int           // trava do cadastro aberto; <=0 = sem limite
	// SessionTTL: validade da sessão, renovada com o uso. Padrão 90 dias.
	SessionTTL time.Duration
	Origins    []string // origens permitidas via CORS (ex.: o app Capacitor)

	limiter limiter
	// Horizon: até quando materializar recorrências, em meses a partir de hoje.
	HorizonMonths int
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })

	mux.HandleFunc("GET /api/auth/config", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]string{"google_client_id": s.ClientID})
	})
	mux.HandleFunc("POST /api/auth/google", s.loginGoogle)
	mux.HandleFunc("POST /api/auth/logout", s.logout)
	mux.HandleFunc("GET /api/auth/me", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, userFrom(r))
	})

	mux.HandleFunc("GET /api/summary", s.summary)
	mux.HandleFunc("POST /api/accounts", s.createAccount)
	mux.HandleFunc("GET /api/categories", s.listCategories)
	mux.HandleFunc("POST /api/categories", s.createCategory)

	mux.HandleFunc("GET /api/transactions", s.listTransactions)
	mux.HandleFunc("POST /api/transactions", s.createTransaction)
	mux.HandleFunc("POST /api/transactions/{id}/pay", s.pay)
	mux.HandleFunc("POST /api/transactions/{id}/unpay", s.unpay)
	mux.HandleFunc("DELETE /api/transactions/{id}", s.deleteTransaction)

	mux.HandleFunc("POST /api/recurrences", s.createRecurrence)

	return s.cors(s.auth(mux))
}

// ---------- middlewares ----------

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if o := r.Header.Get("Origin"); o != "" {
			for _, allowed := range s.Origins {
				if o == allowed {
					w.Header().Set("Access-Control-Allow-Origin", o)
					w.Header().Set("Vary", "Origin")
					w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
					w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
				}
			}
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type ctxKey struct{}

// userFrom devolve o usuário autenticado (o middleware garante que existe nas rotas protegidas).
func userFrom(r *http.Request) store.User {
	u, _ := r.Context().Value(ctxKey{}).(store.User)
	return u
}

func (s *Server) ttl() time.Duration {
	if s.SessionTTL > 0 {
		return s.SessionTTL
	}
	return 90 * 24 * time.Hour
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return ""
	}
	return strings.TrimPrefix(h, "Bearer ")
}

// public: rotas que não exigem sessão.
var public = map[string]bool{"/api/health": true, "/api/auth/config": true, "/api/auth/google": true}

func (s *Server) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") || public[r.URL.Path] {
			next.ServeHTTP(w, r)
			return
		}
		tok := bearer(r)
		if tok == "" {
			writeErr(w, 401, "não autorizado")
			return
		}
		u, err := s.Store.SessionUser(tok, s.ttl())
		if errors.Is(err, store.ErrNoSession) {
			writeErr(w, 401, "sessão expirada")
			return
		}
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, u)))
	})
}

// limiter: no máximo N tentativas por IP por minuto (em memória; some ao reiniciar).
// ponytail: atrás do Caddy usa o último X-Forwarded-For; exposto direto na internet daria para
// forjar o cabeçalho — sempre rode atrás do proxy.
type limiter struct {
	mu   sync.Mutex
	hits map[string][]time.Time
}

func (l *limiter) allow(ip string, n int) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.hits == nil {
		l.hits = map[string][]time.Time{}
	}
	cut := time.Now().Add(-time.Minute)
	kept := l.hits[ip][:0]
	for _, t := range l.hits[ip] {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= n {
		l.hits[ip] = kept
		return false
	}
	l.hits[ip] = append(kept, time.Now())
	return true
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[len(parts)-1])
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	return host
}

// ---------- handlers ----------

// POST /api/auth/google {id_token, device} -> {token, user}
func (s *Server) loginGoogle(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(clientIP(r), 10) {
		writeErr(w, 429, "muitas tentativas; aguarde um minuto")
		return
	}
	var in struct {
		IDToken string `json:"id_token"`
		Device  string `json:"device"`
	}
	if !decode(w, r, &in) {
		return
	}
	c, err := s.Verifier.Verify(r.Context(), in.IDToken)
	if err != nil {
		writeErr(w, 401, err.Error())
		return
	}
	u, err := s.Store.UpsertGoogleUser(c.Sub, c.Email, c.Name, c.Picture, s.MaxUsers)
	if errors.Is(err, store.ErrSignupsClosed) {
		writeErr(w, 403, err.Error())
		return
	}
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	dev := in.Device
	if len(dev) > 80 {
		dev = dev[:80]
	}
	tok, err := s.Store.NewSession(u.ID, dev, s.ttl())
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"token": tok, "user": u})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	respond(w, map[string]bool{"ok": true}, s.Store.RevokeSession(bearer(r)))
}

// GET /api/summary?until=YYYY-MM-DD  (padrão: último dia do mês atual)
func (s *Server) summary(w http.ResponseWriter, r *http.Request) {
	now := time.Now()
	until := r.URL.Query().Get("until")
	if until == "" {
		until = finance.FormatDate(endOfMonth(now))
	}
	if _, err := finance.ParseDate(until); err != nil {
		writeErr(w, 400, "until inválido (use YYYY-MM-DD)")
		return
	}
	monthStart := finance.FormatDate(time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC))

	balances, err := s.Store.Balances(userFrom(r).ID, until)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	var cur, proj int64
	for _, b := range balances {
		cur += b.CurrentCents
		proj += b.ProjectedCents
	}
	spending, err := s.Store.SpendingByCategory(userFrom(r).ID, monthStart, finance.FormatDate(endOfMonth(now)))
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{
		"until":           until,
		"current_cents":   cur,
		"projected_cents": proj,
		"accounts":        balances,
		"spending":        spending,
	})
}

func (s *Server) createAccount(w http.ResponseWriter, r *http.Request) {
	var a store.Account
	if !decode(w, r, &a) {
		return
	}
	if strings.TrimSpace(a.Name) == "" {
		writeErr(w, 400, "informe o nome da conta")
		return
	}
	id, err := s.Store.CreateAccount(userFrom(r).ID, a)
	respondCreated(w, id, err)
}

func (s *Server) listCategories(w http.ResponseWriter, r *http.Request) {
	cs, err := s.Store.Categories(userFrom(r).ID)
	respond(w, cs, err)
}

func (s *Server) createCategory(w http.ResponseWriter, r *http.Request) {
	var c store.Category
	if !decode(w, r, &c) {
		return
	}
	if strings.TrimSpace(c.Name) == "" || (c.Kind != "income" && c.Kind != "expense") {
		writeErr(w, 400, "informe nome e tipo (income ou expense)")
		return
	}
	id, err := s.Store.CreateCategory(userFrom(r).ID, c)
	respondCreated(w, id, err)
}

func (s *Server) listTransactions(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	ts, err := s.Store.ListTransactions(userFrom(r).ID, q.Get("from"), q.Get("to"), q.Get("status"))
	respond(w, ts, err)
}

type createTxReq struct {
	store.Transaction
	Installments int `json:"installments"` // >1 = compra parcelada
}

func (s *Server) createTransaction(w http.ResponseWriter, r *http.Request) {
	var in createTxReq
	if !decode(w, r, &in) {
		return
	}
	t := in.Transaction
	if err := validateTx(t); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if in.Installments > 1 {
		if t.Kind == "transfer" {
			writeErr(w, 400, "transferência não pode ser parcelada")
			return
		}
		first, _ := finance.ParseDate(t.Date)
		ids, err := s.Store.CreateInstallments(userFrom(r).ID, t, in.Installments, first)
		if err != nil {
			writeStoreErr(w, err)
			return
		}
		writeJSON(w, 201, map[string]any{"ids": ids})
		return
	}
	id, err := s.Store.CreateTransaction(userFrom(r).ID, t)
	respondCreated(w, id, err)
}

func (s *Server) pay(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var body struct {
		PaidAt string `json:"paid_at"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body) // corpo é opcional
	if body.PaidAt != "" {
		if _, err := finance.ParseDate(body.PaidAt); err != nil {
			writeErr(w, 400, "paid_at inválido")
			return
		}
	}
	err := s.Store.MarkPaid(userFrom(r).ID, id, body.PaidAt)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, 404, "lançamento não encontrado ou já efetivado")
		return
	}
	respond(w, map[string]bool{"ok": true}, err)
}

func (s *Server) unpay(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	respond(w, map[string]bool{"ok": true}, s.Store.MarkPending(userFrom(r).ID, id))
}

func (s *Server) deleteTransaction(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	respond(w, map[string]bool{"ok": true}, s.Store.DeleteTransaction(userFrom(r).ID, id))
}

func (s *Server) createRecurrence(w http.ResponseWriter, r *http.Request) {
	var rec store.Recurrence
	if !decode(w, r, &rec) {
		return
	}
	if rec.IntervalN < 1 {
		rec.IntervalN = 1
	}
	if rec.Kind != "income" && rec.Kind != "expense" {
		writeErr(w, 400, "tipo deve ser income ou expense")
		return
	}
	if rec.AmountCents <= 0 || strings.TrimSpace(rec.Description) == "" || rec.AccountID == 0 {
		writeErr(w, 400, "informe descrição, valor e conta")
		return
	}
	start, err := finance.ParseDate(rec.StartDate)
	if err != nil {
		writeErr(w, 400, "start_date inválido")
		return
	}
	rule := finance.Rule{Frequency: finance.Frequency(rec.Frequency), Interval: rec.IntervalN, Start: start}
	if rec.EndDate != nil {
		e, err := finance.ParseDate(*rec.EndDate)
		if err != nil {
			writeErr(w, 400, "end_date inválido")
			return
		}
		rule.End = &e
	}
	if err := rule.Validate(); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	id, err := s.Store.CreateRecurrence(userFrom(r).ID, rec, s.horizon())
	respondCreated(w, id, err)
}

// Horizon devolve até onde as recorrências são materializadas.
func (s *Server) horizon() time.Time { return Horizon(time.Now(), s.HorizonMonths) }

// Horizon: hoje + N meses (padrão 12).
func Horizon(now time.Time, months int) time.Time {
	if months < 1 {
		months = 12
	}
	return time.Date(now.Year(), now.Month()+time.Month(months), now.Day(), 0, 0, 0, 0, time.UTC)
}

// ---------- utilidades ----------

func validateTx(t store.Transaction) error {
	switch t.Kind {
	case "income", "expense", "transfer":
	default:
		return errors.New("tipo deve ser income, expense ou transfer")
	}
	if strings.TrimSpace(t.Description) == "" {
		return errors.New("informe a descrição")
	}
	if t.AmountCents <= 0 {
		return errors.New("valor deve ser maior que zero")
	}
	if t.AccountID == 0 {
		return errors.New("informe a conta")
	}
	if _, err := finance.ParseDate(t.Date); err != nil {
		return errors.New("data inválida (use YYYY-MM-DD)")
	}
	if t.Kind == "transfer" {
		if t.TransferAccountID == nil || *t.TransferAccountID == t.AccountID {
			return errors.New("transferência exige uma conta de destino diferente")
		}
	} else if t.TransferAccountID != nil {
		return errors.New("conta de destino só vale para transferência")
	}
	if t.Status != "" && t.Status != "pending" && t.Status != "paid" {
		return errors.New("status deve ser pending ou paid")
	}
	return nil
}

func endOfMonth(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month()+1, 0, 0, 0, 0, 0, time.UTC)
}

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		writeErr(w, 400, "id inválido")
		return 0, false
	}
	return id, true
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeErr(w, 400, "JSON inválido: "+err.Error())
		return false
	}
	return true
}

func respond(w http.ResponseWriter, v any, err error) {
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, 200, v)
}

func respondCreated(w http.ResponseWriter, id int64, err error) {
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, 201, map[string]int64{"id": id})
}

func writeStoreErr(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrRef) {
		writeErr(w, 400, err.Error())
		return
	}
	writeErr(w, 500, err.Error())
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
