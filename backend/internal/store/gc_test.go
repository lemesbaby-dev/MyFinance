package store

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

const retention = 180 * 24 * time.Hour

func del(id string) Op { return Op{OpID: "del-" + id, Kind: "account", ID: id, Action: "delete"} }

// age envelhece o tombstone (como se a exclusão tivesse acontecido há `days` dias).
func age(t *testing.T, st *Store, id string, days int) {
	t.Helper()
	res, err := st.db.Exec(`UPDATE entities SET deleted_at=datetime('now',?) WHERE id=? AND deleted_at IS NOT NULL`,
		fmt.Sprintf("-%d days", days), id)
	if err != nil {
		t.Fatal(err)
	}
	if n, _ := res.RowsAffected(); n != 1 {
		t.Fatalf("age %s: %d linhas", id, n)
	}
}

func TestGCRespeitaRetencaoEIsolamento(t *testing.T) {
	st, ana := open(t)
	u2, _ := st.UpsertGoogleUser("sub2", "b@x.com", "B", "", 0)
	u3, _ := st.UpsertGoogleUser("sub3", "c@x.com", "C", "", 0)
	bia, caio := u2.ID, u3.ID

	st.Push(ana, []Op{acc("viva"), acc("velha"), acc("recente"), del("velha"), del("recente")}) // revs 1..5
	st.Push(bia, []Op{acc("b-velha"), del("b-velha"), acc("b-viva")})                           // revs 1..3
	st.Push(caio, []Op{acc("c-viva"), acc("c-recente"), del("c-recente")})
	age(t, st, "velha", 181)
	age(t, st, "recente", 179)
	age(t, st, "b-velha", 400)

	n, err := st.GC(retention)
	if err != nil || n != 2 {
		t.Fatalf("GC = %d, %v; quero 2", n, err)
	}
	if got := count(t, st, `SELECT COUNT(*) FROM entities WHERE id IN ('velha','b-velha')`); got != 0 {
		t.Errorf("tombstones antigos continuam: %d", got)
	}
	if got := count(t, st, `SELECT COUNT(*) FROM entities WHERE id IN ('viva','b-viva','c-viva') AND deleted_at IS NULL`); got != 3 {
		t.Errorf("linhas vivas = %d, quero 3", got)
	}
	if got := count(t, st, `SELECT COUNT(*) FROM entities WHERE id IN ('recente','c-recente') AND deleted_at IS NOT NULL`); got != 2 {
		t.Errorf("tombstones dentro da retenção = %d, quero 2", got)
	}
	// o marco é o rev do tombstone descartado de cada usuário; quem não perdeu nada fica em 0
	for uid, want := range map[string]int64{ana: 4, bia: 2, caio: 0} {
		if got, err := st.GCRev(uid); err != nil || got != want {
			t.Errorf("gc_rev = %d, %v; quero %d", got, err, want)
		}
	}
	// contadores de cota continuam batendo com a varredura (total_n conta tombstones)
	read := func() (s string) {
		rows, _ := st.db.Query(`SELECT id,rows_n,bytes_n,total_n FROM users ORDER BY id`)
		defer rows.Close()
		for rows.Next() {
			var id string
			var r, b, tt int64
			rows.Scan(&id, &r, &b, &tt)
			s += fmt.Sprintf("%s:%d/%d/%d ", id, r, b, tt)
		}
		return
	}
	before := read()
	if _, err := st.db.Exec(recountSQL); err != nil {
		t.Fatal(err)
	}
	if after := read(); before != after {
		t.Errorf("contadores após GC %q != varredura %q", before, after)
	}

	// rodar de novo não muda nada, e o marco nunca recua
	if n, err := st.GC(retention); err != nil || n != 0 {
		t.Errorf("segundo GC = %d, %v", n, err)
	}
	if got, _ := st.GCRev(ana); got != 4 {
		t.Errorf("gc_rev recuou: %d", got)
	}
	// idempotência do push continua: o mesmo op_id não reaplica
	if res, _ := st.Push(ana, []Op{acc("viva"), del("velha")}); res[0].Status != "dup" || res[1].Status != "dup" {
		t.Errorf("reenvio após GC: %+v", res)
	}
}

func TestGCLiberaOTetoDeTombstones(t *testing.T) {
	defer func(r int64) { MaxRows = r }(MaxRows)
	MaxRows = 1 // teto total = 4 linhas, vivas ou não
	st, uid := open(t)
	for i := 0; i < 4; i++ {
		st.Push(uid, []Op{acc(fmt.Sprint("a", i)), del(fmt.Sprint("a", i))})
	}
	if res, _ := st.Push(uid, []Op{acc("nova")}); res[0].Status != "rejected" {
		t.Fatalf("teto deveria recusar: %+v", res[0])
	}
	if n, err := st.GC(-time.Hour); err != nil || n != 4 { // retenção negativa: todo tombstone é "antigo"
		t.Fatalf("GC = %d, %v", n, err)
	}
	if res, _ := st.Push(uid, []Op{acc("nova")}); res[0].Status != "ok" {
		t.Errorf("após o GC deveria caber: %+v", res[0])
	}
}

// Banco de produção (v2, com dados) sobe para a versão atual sem perder nada.
func TestMigraBancoV2ComDados(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v2.db")
	old, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{schemaSQL,
		`INSERT INTO users(id,google_sub,email,rev) VALUES('u1','s1','a@x.com',3)`,
		`INSERT INTO entities(user_id,kind,id,rev,data) VALUES('u1','account','a1',1,'{"name":"A"}'),('u1','account','a2',3,'{}')`,
		`UPDATE entities SET deleted_at=datetime('now','-300 days') WHERE id='a2'`,
		`INSERT INTO sync_ops(user_id,op_id) VALUES('u1','op1')`,
		migrations[0], `PRAGMA user_version=2`} {
		if _, err := old.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	old.Close()
	st, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	var v int
	st.db.QueryRow(`PRAGMA user_version`).Scan(&v)
	if v != len(migrations)+1 {
		t.Errorf("user_version = %d, quero %d", v, len(migrations)+1)
	}
	var rev, gc, r, tt int64
	st.db.QueryRow(`SELECT rev,gc_rev,rows_n,total_n FROM users WHERE id='u1'`).Scan(&rev, &gc, &r, &tt)
	if rev != 3 || gc != 0 || r != 1 || tt != 2 || count(t, st, `SELECT COUNT(*) FROM entities`) != 2 ||
		count(t, st, `SELECT COUNT(*) FROM sync_ops`) != 1 {
		t.Errorf("após migrar: rev=%d gc_rev=%d rows=%d total=%d", rev, gc, r, tt)
	}
	// a migração não apaga nada; quem apaga é o GC, e só o tombstone
	if n, err := st.GC(retention); err != nil || n != 1 {
		t.Errorf("GC = %d, %v", n, err)
	}
	if gc, _ := st.GCRev("u1"); gc != 3 || count(t, st, `SELECT COUNT(*) FROM entities WHERE id='a1'`) != 1 {
		t.Errorf("gc_rev = %d ou linha viva sumiu", gc)
	}
}
