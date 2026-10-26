package store

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
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

func TestCotaDeBytesVaiTambemNoUpdate(t *testing.T) {
	defer func(b int64) { MaxBytes = b }(MaxBytes)
	MaxBytes = 100
	st, uid := open(t)
	st.Push(uid, []Op{acc("a1")}) // 73 bytes
	big := Op{OpID: "big", Kind: "account", ID: "a1", Action: "upsert",
		Data: json.RawMessage(`{"name":"` + strings.Repeat("é", 40) + `","type":"cash","initial_balance_cents":0,"archived":false}`)}
	if res, _ := st.Push(uid, []Op{big}); res[0].Status != "rejected" { // 40 caracteres, 80 bytes
		t.Errorf("update inflando bytes passou: %+v", res[0])
	}
}

func TestDeleteDesconhecidoENaoGravaTombstone(t *testing.T) {
	st, uid := open(t)
	res, _ := st.Push(uid, []Op{{OpID: "d", Kind: "account", ID: "x", Action: "delete"}})
	var n int
	st.db.QueryRow(`SELECT COUNT(*) FROM entities`).Scan(&n)
	if res[0].Status != "ok" || n != 0 {
		t.Errorf("status %s, %d linhas", res[0].Status, n)
	}
}

func TestTetoDeTombstones(t *testing.T) {
	defer func(r int64) { MaxRows = r }(MaxRows)
	MaxRows = 1 // teto total = 4 linhas, vivas ou não
	st, uid := open(t)
	for i := 0; i < 5; i++ {
		id := fmt.Sprint("a", i)
		res, _ := st.Push(uid, []Op{acc(id)})
		want := "ok"
		if i == 4 {
			want = "rejected"
		}
		if res[0].Status != want {
			t.Errorf("conta %d: %s, quero %s", i, res[0].Status, want)
		}
		st.Push(uid, []Op{{OpID: "del" + id, Kind: "account", ID: id, Action: "delete"}})
	}
	var d string
	st.db.QueryRow(`SELECT data FROM entities WHERE id='a0'`).Scan(&d)
	if d != "{}" {
		t.Errorf("tombstone guarda dado: %s", d)
	}
}

func TestSyncOpsSoGuardaOk(t *testing.T) {
	st, uid := open(t)
	st.Push(uid, []Op{{OpID: "x y", Kind: "account", ID: "a", Action: "upsert"}, {OpID: "ruim", Kind: "account", ID: "a", Action: "upsert",
		Data: json.RawMessage(`{}`)}, acc("a1")})
	st.db.Exec(`UPDATE sync_ops SET applied_at=datetime('now','-100 days')`)
	st.Push(uid, []Op{acc("a2")}) // poda a antiga
	var n int
	st.db.QueryRow(`SELECT COUNT(*) FROM sync_ops`).Scan(&n)
	if n != 1 {
		t.Errorf("sync_ops tem %d linhas, quero 1 (só a2; as recusadas não entram e a velha foi podada)", n)
	}
}

func TestRecorrenciaGeneratedUntil(t *testing.T) {
	st, uid := open(t)
	st.Push(uid, []Op{acc("a1")})
	rec := func(id, gu string) Op {
		return Op{OpID: "op-" + id, Kind: "recurrence", ID: id, Action: "upsert", Data: json.RawMessage(
			`{"kind":"expense","description":"x","amount_cents":1,"account_id":"a1","category_id":null,"frequency":"monthly",` +
				`"interval_n":1,"start_date":"2026-10-01","end_date":null,"active":true,"generated_until":` + gu + `}`)}
	}
	res, _ := st.Push(uid, []Op{rec("r1", `"2027-10-15"`), rec("r2", `null`), rec("r3", `"2027-02-30"`)})
	if res[0].Status != "ok" || res[1].Status != "ok" || res[2].Status != "rejected" {
		t.Errorf("generated_until: %+v", res)
	}
}

func TestTextoContaRunasNaoBytes(t *testing.T) {
	if err := text("nome", strings.Repeat("ç", maxText), maxText, true); err != nil {
		t.Errorf("200 runas (400 bytes) deveriam passar: %v", err)
	}
	if err := text("nome", strings.Repeat("ç", maxText+1), maxText, true); err == nil {
		t.Error("201 runas deveriam ser recusadas")
	}
}
