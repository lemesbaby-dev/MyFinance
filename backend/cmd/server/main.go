// Comando server: API + arquivos estáticos do front, num único binário.
package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"

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

	st, err := store.Open(*dbPath)
	if err != nil {
		log.Fatalf("abrindo banco: %v", err)
	}
	defer st.Close()

	srv := &api.Server{
		Store:    st,
		Verifier: &auth.Google{ClientID: clientID},
		ClientID: clientID,
		MaxUsers: maxUsers,
		Origins:  strings.Split(env("ALLOWED_ORIGINS", "https://localhost,http://localhost,capacitor://localhost,http://localhost:5173"), ","),
	}

	mux := http.NewServeMux()
	mux.Handle("/api/", srv.Handler())
	mux.Handle("/", spa(*static))

	log.Printf("ouvindo em %s (db=%s, static=%s)", *addr, *dbPath, *static)
	log.Fatal(http.ListenAndServe(*addr, mux))
}

// spa serve o front e cai em index.html para rotas do lado do cliente.
func spa(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := os.Stat(dir + r.URL.Path); err != nil && !strings.Contains(r.URL.Path, ".") {
			r.URL.Path = "/"
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
