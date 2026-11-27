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

func TestRetentionDays(t *testing.T) {
	for in, want := range map[string]int{"0": 0, "180": 180, "36500": 36500} {
		if got, err := retentionDays(in); err != nil || got != want {
			t.Errorf("%q = %d, %v; quero %d", in, got, err, want)
		}
	}
	// acima do teto a duração estouraria int64 e ficaria negativa: o GC apagaria TODOS os tombstones
	for _, in := range []string{"36501", "106752", "999999999", "-1", "1.5", "abc", ""} {
		if _, err := retentionDays(in); err == nil {
			t.Errorf("%q deveria ser recusado", in)
		}
	}
}
