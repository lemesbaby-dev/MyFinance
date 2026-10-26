package main

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestSpaSemListagemDeAssets(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "assets"), 0o755)
	os.WriteFile(filepath.Join(dir, "assets", "a-1.js"), []byte("x"), 0o644)
	os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>/assets/</html>"), 0o644)
	h := spa(dir)
	for path, want := range map[string]int{"/assets/": 404, "/assets": 404, "/assets/a-1.js": 200, "/": 200, "/rota-do-cliente": 200} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		if rec.Code != want {
			t.Errorf("%s = %d, quero %d", path, rec.Code, want)
		}
	}
}
