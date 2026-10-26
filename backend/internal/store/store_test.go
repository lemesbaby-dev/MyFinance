package store

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
)

func open(t *testing.T) (*Store, string) {
	t.Helper()
	st, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	u, err := st.UpsertGoogleUser("sub1", "a@x.com", "A", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	return st, u.ID
}

func acc(id string) Op {
	return Op{OpID: "op-" + id, Kind: "account", ID: id, Action: "upsert",
		Data: json.RawMessage(`{"name":"A","type":"checking","initial_balance_cents":0,"archived":false}`)}
}

func TestCotaDeLinhas(t *testing.T) {
	defer func(r int64) { MaxRows = r }(MaxRows)
	MaxRows = 3
	st, uid := open(t)
	for i := 0; i < 5; i++ {
		res, err := st.Push(uid, []Op{acc(fmt.Sprint("a", i))})
		if err != nil {
			t.Fatal(err)
		}
		want := "ok"
		if i >= 3 {
			want = "rejected"
		}
		if res[0].Status != want {
			t.Errorf("conta %d: %s (%s), quero %s", i, res[0].Status, res[0].Error, want)
		}
	}
	// editar o que já existe não conta como linha nova; excluir libera espaço
	if res, _ := st.Push(uid, []Op{{OpID: "ed", Kind: "account", ID: "a0", Action: "upsert",
		Data: json.RawMessage(`{"name":"Editada","type":"cash","initial_balance_cents":1,"archived":false}`)}}); res[0].Status != "ok" {
		t.Errorf("edição bloqueada pela cota: %+v", res[0])
	}
	st.Push(uid, []Op{{OpID: "del", Kind: "account", ID: "a1", Action: "delete"}})
	if res, _ := st.Push(uid, []Op{acc("a9")}); res[0].Status != "ok" {
		t.Errorf("excluir deveria liberar cota: %+v", res[0])
	}
}

func TestCotaDeBytes(t *testing.T) {
	defer func(b int64) { MaxBytes = b }(MaxBytes)
	MaxBytes = 100
	st, uid := open(t)
	r1, _ := st.Push(uid, []Op{acc("a1")}) // 73 bytes
	r2, _ := st.Push(uid, []Op{acc("a2")})
	if r1[0].Status != "ok" || r2[0].Status != "rejected" {
		t.Errorf("cota de bytes: %+v %+v", r1[0], r2[0])
	}
}

func TestPushNaoVazaEntreLotes(t *testing.T) {
	// erro de banco (usuário inexistente) aborta o lote inteiro e não grava nada
	st, _ := open(t)
	if _, err := st.Push("fantasma", []Op{acc("a1")}); err == nil {
		t.Error("usuário inexistente deveria falhar")
	}
	var n int
	st.db.QueryRow(`SELECT COUNT(*) FROM entities`).Scan(&n)
	if n != 0 {
		t.Errorf("lote abortado deixou %d linhas", n)
	}
}
