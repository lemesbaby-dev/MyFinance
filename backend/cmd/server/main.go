// Comando server: API + arquivos estáticos do front, num único binário.
package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"financas/internal/api"
	"financas/internal/auth"
	"financas/internal/store"
)

func main() {
	var (
		addr   = flag.String("addr", env("ADDR", "127.0.0.1:8080"), "endereço de escuta")
		dbPath = flag.String("db", env("DB_PATH", "financas.db"), "arquivo SQLite")
		static = flag.String("static", env("STATIC_DIR", "../frontend/dist"), "pasta do front compilado")
	)
	flag.Parse()

	clientID := os.Getenv("GOOGLE_CLIENT_ID")
	if clientID == "" {
		log.Println("AVISO: GOOGLE_CLIENT_ID vazio — ninguém consegue entrar. Veja docs/04-api.md.")
	}
	maxUsers, err := strconv.Atoi(env("MAX_USERS", "200")) // "0" = sem limite
	if err != nil || maxUsers < 0 {
		log.Fatalf("MAX_USERS inválido: %q (use um inteiro >= 0)", os.Getenv("MAX_USERS"))
	}

	// Retenção dos tombstones (exclusões) antes do GC. "0" desliga a limpeza.
	gcDays, err := retentionDays(env("TOMBSTONE_RETENTION_DAYS", "180"))
	if err != nil {
		log.Fatalf("TOMBSTONE_RETENTION_DAYS inválido: %q (use um inteiro de 0 a %d; 0 desliga)", os.Getenv("TOMBSTONE_RETENTION_DAYS"), maxRetentionDays)
	}

	st, err := store.Open(*dbPath)
	if err != nil {
		log.Fatalf("abrindo banco: %v", err)
	}

	tp, err := api.ParseTrustedProxies(os.Getenv("TRUSTED_PROXY"))
	if err != nil {
		log.Fatalf("TRUSTED_PROXY inválido: %v", err)
	}
	srv := &api.Server{
		Store:    st,
		Verifier: &auth.Google{ClientID: clientID},
		ClientID: clientID,
		MaxUsers: maxUsers,
		Origins:  strings.Split(env("ALLOWED_ORIGINS", "http://localhost:5173"), ","),

		TrustedProxies: tp,
	}

	mux := http.NewServeMux()
	mux.Handle("/api/", srv.Handler())
	mux.Handle("/", spa(*static))

	hs := &http.Server{Addr: *addr, Handler: api.Wrap(mux),
		ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, IdleTimeout: 120 * time.Second}
	// Desligamento gracioso: termina as requisições em curso e só então fecha o banco.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if gcDays > 0 {
		go gcLoop(ctx, st, time.Duration(gcDays)*24*time.Hour)
	}
	done := make(chan struct{})
	failed := false
	go func() {
		defer close(done)
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := hs.Shutdown(sctx); err != nil {
			log.Printf("shutdown: %v", err)
		}
	}()
	log.Printf("ouvindo em %s (db=%s, static=%s)", *addr, *dbPath, *static)
	if err := hs.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Printf("servidor: %v", err)
		stop()
		failed = true
	}
	<-done
	st.Close()
	if failed {
		os.Exit(1)
	}
}

// maxRetentionDays: teto de TOMBSTONE_RETENTION_DAYS (100 anos). Acima de ~106 mil dias a conversão para
// time.Duration estoura int64, a retenção fica negativa e o GC apagaria TODOS os tombstones.
const maxRetentionDays = 36500

func retentionDays(v string) (int, error) {
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 || n > maxRetentionDays {
		return 0, errors.New("fora do intervalo")
	}
	return n, nil
}

// gcLoop limpa os tombstones antigos na subida e depois uma vez por dia, até o processo encerrar.
func gcLoop(ctx context.Context, st *store.Store, retention time.Duration) {
	t := time.NewTicker(24 * time.Hour)
	defer t.Stop()
	for {
		if n, err := st.GC(retention); err != nil {
			log.Printf("gc de tombstones: %v", err)
		} else if n > 0 {
			log.Printf("gc de tombstones: %d removidos", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// spa serve o front e cai em index.html para rotas do lado do cliente.
func spa(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fi, err := os.Stat(filepath.Join(dir, filepath.FromSlash(r.URL.Path)))
		if err == nil && fi.IsDir() && strings.HasPrefix(r.URL.Path, "/assets") { // sem listagem de diretório
			http.NotFound(w, r)
			return
		}
		if err != nil && !strings.Contains(r.URL.Path, ".") {
			r.URL.Path = "/"
		}
		// Arquivos com hash no nome nunca mudam; o resto (index, sw.js, manifest) precisa revalidar
		// para o navegador enxergar versão nova do app e do service worker.
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		fs.ServeHTTP(w, r)
	})
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
