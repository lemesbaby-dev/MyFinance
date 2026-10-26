// Package api expõe o HTTP/JSON. Usa só a stdlib (Go 1.22: roteamento por método e path).
package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"financas/internal/auth"
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
	// TrustedProxies: de quem confiamos o X-Forwarded-For (IP ou CIDR). Vazio = só loopback.
	TrustedProxies []*net.IPNet

	limiter limiter
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
		if err := s.Store.Ping(); err != nil {
			log.Printf("health: %v", err)
			writeErr(w, 503, "banco indisponível")
			return
		}
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})

	mux.HandleFunc("GET /api/auth/config", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]string{"google_client_id": s.ClientID})
	})
	mux.HandleFunc("POST /api/auth/google", s.loginGoogle)
	mux.HandleFunc("POST /api/auth/logout", s.logout)
	mux.HandleFunc("GET /api/auth/me", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, userFrom(r))
	})

	mux.HandleFunc("GET /api/sync", s.pull)
	mux.HandleFunc("POST /api/sync", s.push)
	mux.HandleFunc("GET /api/export", s.export)
	mux.HandleFunc("DELETE /api/account", s.deleteAccount)

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
			writeStoreErr(w, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, u)))
	})
}

// limiter: no máximo N tentativas por chave por minuto (em memória; some ao reiniciar).
// ponytail: janela por lista de timestamps; contador por janela fixa se o volume pedir.
type limiter struct {
	mu    sync.Mutex
	hits  map[string][]time.Time
	swept time.Time // última varredura de chaves esquecidas (no máximo 1 por minuto)
}

func (l *limiter) allow(key string, n int) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.hits == nil {
		l.hits = map[string][]time.Time{}
	}
	now := time.Now()
	cut := now.Add(-time.Minute)
	if now.Sub(l.swept) >= time.Minute { // varre chaves que nunca voltaram, para o mapa não crescer sem limite
		l.swept = now
		for k, ts := range l.hits {
			if k != key && (len(ts) == 0 || ts[len(ts)-1].Before(cut)) {
				delete(l.hits, k)
			}
		}
	}
	kept := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	if len(kept) == 0 {
		delete(l.hits, key) // sem hit na janela: não deixa a chave velha no mapa
	}
	if len(kept) >= n {
		l.hits[key] = kept
		return false
	}
	l.hits[key] = append(kept, now)
	return true
}

// ParseTrustedProxies lê "IP[,CIDR...]" (ex.: "10.0.0.0/8,192.168.1.5"). Vazio = loopback.
func ParseTrustedProxies(list string) ([]*net.IPNet, error) {
	var out []*net.IPNet
	for _, f := range strings.Split(list, ",") {
		if f = strings.TrimSpace(f); f == "" {
			continue
		}
		if !strings.Contains(f, "/") {
			if ip := net.ParseIP(f); ip != nil && ip.To4() != nil {
				f += "/32"
			} else {
				f += "/128"
			}
		}
		_, n, err := net.ParseCIDR(f)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, nil
}

func (s *Server) trusted(ip net.IP) bool {
	if len(s.TrustedProxies) == 0 {
		return ip.IsLoopback()
	}
	for _, n := range s.TrustedProxies {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// clientIP: RemoteAddr, ou o último X-Forwarded-For quando a conexão vem de um proxy confiável.
// IPv6 vira o prefixo /64 (um cliente tem o /64 inteiro; chave por endereço seria burlável).
func (s *Server) clientIP(r *http.Request) string {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	if ip := net.ParseIP(host); ip != nil && s.trusted(ip) {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			host = strings.TrimSpace(parts[len(parts)-1])
		}
	}
	if ip := net.ParseIP(host); ip != nil && ip.To4() == nil {
		return ip.Mask(net.CIDRMask(64, 128)).String() + "/64"
	}
	return host
}

// ---------- handlers ----------

// POST /api/auth/google {id_token, device} -> {token, user}
func (s *Server) loginGoogle(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(s.clientIP(r), 10) {
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
	if errors.Is(err, auth.ErrUpstream) {
		log.Printf("google: %v", err)
		writeErr(w, 503, "Google indisponível, tente novamente")
		return
	}
	if err != nil {
		writeErr(w, 401, "token do Google inválido")
		return
	}
	u, err := s.Store.UpsertGoogleUser(c.Sub, c.Email, c.Name, c.Picture, s.MaxUsers)
	if errors.Is(err, store.ErrSignupsClosed) {
		writeErr(w, 403, err.Error())
		return
	}
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	dev := in.Device
	if len(dev) > 80 {
		dev = dev[:80]
	}
	tok, err := s.Store.NewSession(u.ID, dev, s.ttl())
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"token": tok, "user": u})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	respond(w, map[string]bool{"ok": true}, s.Store.RevokeSession(bearer(r)))
}

// GET /api/sync?since=<rev>&limit=<n> -> {changes, cursor, more, rev}
func (s *Server) pull(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow("p:"+userFrom(r).ID, 300) {
		writeErr(w, 429, "muitas requisições; aguarde um minuto")
		return
	}
	since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 1000 {
		limit = 1000
	}
	ch, cursor, more, err := s.Store.Pull(userFrom(r).ID, since, limit)
	rev := int64(0)
	if err == nil {
		rev, err = s.Store.Rev(userFrom(r).ID)
	}
	respond(w, map[string]any{"changes": ch, "cursor": cursor, "more": more, "rev": rev}, err)
}

// POST /api/sync {ops:[...]} -> {results:[...]}
func (s *Server) push(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	if !s.limiter.allow("u:"+u.ID, 120) {
		writeErr(w, 429, "muitas requisições; aguarde um minuto")
		return
	}
	var in struct {
		Ops []store.Op `json:"ops"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.Ops) > store.MaxOps {
		writeErr(w, 400, "lote grande demais (máximo 500 operações)")
		return
	}
	res, err := s.Store.Push(u.ID, in.Ops)
	respond(w, map[string]any{"results": res}, err)
}

// GET /api/export?format=json -> todos os documentos do usuário, como download.
func (s *Server) export(w http.ResponseWriter, r *http.Request) {
	if f := r.URL.Query().Get("format"); f != "" && f != "json" {
		writeErr(w, 400, "format deve ser json")
		return
	}
	u := userFrom(r)
	docs, err := s.Store.Export(u.ID)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="financas-export.json"`)
	writeJSON(w, 200, map[string]any{"exported_at": time.Now().UTC().Format(time.RFC3339),
		"email": u.Email, "entities": docs})
}

// DELETE /api/account {"confirm_email": "..."} -> apaga o usuário e tudo dele.
func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	var in struct {
		ConfirmEmail string `json:"confirm_email"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !strings.EqualFold(strings.TrimSpace(in.ConfirmEmail), u.Email) {
		writeErr(w, 400, "confirmação não confere com o e-mail da conta")
		return
	}
	respond(w, map[string]bool{"ok": true}, s.Store.DeleteUser(u.ID))
}

// ---------- utilidades ----------

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

func writeStoreErr(w http.ResponseWriter, err error) {
	log.Printf("erro interno: %v", err)
	writeErr(w, 500, "erro interno")
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// Wrap põe cabeçalhos de segurança em TODAS as respostas (API e estáticos) e um log de acesso
// (método, caminho, status, duração; nunca Authorization nem query string).
func Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", csp)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer-when-downgrade")
		h.Set("X-Frame-Options", "DENY")
		sw := &statusWriter{ResponseWriter: w, status: 200}
		start := time.Now()
		next.ServeHTTP(sw, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, sw.status, time.Since(start).Round(time.Millisecond))
	})
}

// O botão do Google Sign-In usa script, iframe, stylesheet (e, no fluxo novo, requests) de
// accounts.google.com; os estilos inline vêm do próprio botão/Svelte.
const csp = "default-src 'self'; script-src 'self' https://accounts.google.com; frame-src https://accounts.google.com; " +
	"connect-src 'self' https://accounts.google.com/gsi/; img-src 'self' data: https://*.googleusercontent.com; " +
	"style-src 'self' 'unsafe-inline' https://accounts.google.com; font-src 'self'; frame-ancestors 'none'; " +
	"base-uri 'self'; form-action 'self'"

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(c int) { w.status = c; w.ResponseWriter.WriteHeader(c) }
