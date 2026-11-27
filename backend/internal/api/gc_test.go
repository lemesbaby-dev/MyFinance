package api

import (
	"fmt"
	"testing"
	"time"
)

// GC de tombstones: cursor anterior ao marco precisa refazer a cópia local.

func (e *env) gcAll() int64 {
	e.t.Helper()
	n, err := e.st.GC(-time.Hour) // retenção negativa: todo tombstone é "antigo"
	if err != nil {
		e.t.Fatal(err)
	}
	return n
}

func TestSyncCursorAntigoRecebeSinalDeRessincronizacao(t *testing.T) {
	e := newEnv(t)
	first := upsert("account", "acc1", account("A"))
	e.push("", first, upsert("account", "acc2", account("B")), upsert("account", "acc3", account("C"))) // revs 1..3
	e.push("", op("account", "acc1", "delete", nil))                                                    // rev 4
	if n, err := e.st.GC(180 * 24 * time.Hour); err != nil || n != 0 {
		t.Fatalf("tombstone novo não pode sair: %d, %v", n, err)
	}
	if ch, _, _ := e.pull("", 3); len(ch) != 1 || !ch[0].Deleted {
		t.Fatalf("antes do GC o pull incremental entrega o tombstone: %+v", ch)
	}
	if n := e.gcAll(); n != 1 {
		t.Fatalf("GC = %d, quero 1", n)
	}

	// cursor anterior ao marco: sem resposta incremental (faltaria o tombstone descartado)
	for _, since := range []int{0, 3} {
		code, o, _ := e.do("GET", fmt.Sprintf("/api/sync?since=%d", since), "", nil)
		if code != 409 || o["resync"] != true || o["changes"] != nil {
			t.Errorf("since=%d: %d %v, quero 409 com resync", since, code, o)
		}
	}
	// cursor no marco ou depois: segue incremental, no pull e no push
	if code, o, _ := e.do("POST", "/api/sync", "", m{"ops": []m{upsert("account", "acc4", account("D"))}, "cursor": 4}); code != 200 {
		t.Fatalf("push em dia: %d %v", code, o)
	}
	ch, cursor, more := e.pull("", 4)
	if len(ch) != 1 || ch[0].ID != "acc4" || cursor != 5 || more {
		t.Errorf("incremental após o marco: %+v cursor=%d more=%v", ch, cursor, more)
	}

	// leitura completa (full=1): só o que existe, paginada
	code, o, _ := e.do("GET", "/api/sync?since=0&full=1&limit=2", "", nil)
	if code != 200 || len(o["changes"].([]any)) != 2 || o["more"] != true || o["cursor"].(float64) != 3 {
		t.Fatalf("full página 1: %d %v", code, o)
	}
	code, o, _ = e.do("GET", "/api/sync?since=3&full=1&limit=2", "", nil)
	if code != 200 || len(o["changes"].([]any)) != 1 || o["more"] != false || o["cursor"].(float64) != 5 {
		t.Fatalf("full página 2: %d %v", code, o)
	}

	// push de quem não prova estar em dia é recusado inteiro (nada é aplicado)
	for _, body := range []m{
		{"ops": []m{upsert("account", "acc1", account("ressuscitada"))}},              // app antigo: sem cursor
		{"ops": []m{upsert("account", "acc1", account("ressuscitada"))}, "cursor": 3}, // cursor antigo
	} {
		code, o, _ := e.do("POST", "/api/sync", "", body)
		if code != 409 || o["resync"] != true {
			t.Errorf("push com cursor %v: %d %v, quero 409 com resync", body["cursor"], code, o)
		}
	}
	if ch, _, _ := e.pull("", 4); len(ch) != 1 {
		t.Errorf("push recusado escreveu: %+v", ch)
	}
	// idempotência continua valendo depois do GC
	if code, o, _ := e.do("POST", "/api/sync", "", m{"ops": []m{first}, "cursor": 5}); code != 200 ||
		o["results"].([]any)[0].(map[string]any)["status"] != "dup" {
		t.Errorf("reenvio após GC: %d %v", code, o)
	}
}

// Sobrou só documento com rev menor que o marco: o cursor final da leitura completa sobe até o marco,
// senão o app pediria ressincronização para sempre.
func TestSyncLeituraCompletaAlcancaOMarco(t *testing.T) {
	e := newEnv(t)
	e.push("", upsert("account", "acc1", account("A")), upsert("account", "acc2", account("B")))
	e.push("", op("account", "acc2", "delete", nil)) // rev 3
	e.gcAll()
	code, o, _ := e.do("GET", "/api/sync?since=0&full=1", "", nil)
	if code != 200 || len(o["changes"].([]any)) != 1 || o["cursor"].(float64) != 3 {
		t.Fatalf("full: %d %v", code, o)
	}
	if ch, cursor, _ := e.pull("", 3); len(ch) != 0 || cursor != 3 {
		t.Errorf("depois da leitura completa segue incremental: %+v %d", ch, cursor)
	}
}

func TestSyncGCIsoladoPorUsuario(t *testing.T) {
	e := newEnv(t)
	bia := e.login("bia", "bia@x.com")
	e.push("", upsert("account", "a1", account("A")), op("account", "a1", "delete", nil))
	e.push(bia, upsert("account", "b1", account("B")))
	e.gcAll()
	if ch, _, _ := e.pull(bia, 0); len(ch) != 1 || ch[0].ID != "b1" { // a Bia não tem marco: cursor 0 segue valendo
		t.Errorf("pull da Bia: %+v", ch)
	}
	wantStatus(t, e.push(bia, upsert("account", "b2", account("B2"))), "ok") // sem marco, nem precisa mandar cursor
	if code, o, _ := e.do("GET", "/api/sync?since=0", "", nil); code != 409 {
		t.Errorf("pull da Ana: %d %v", code, o)
	}
}

// O GC roda no meio de um pull incremental: a resposta ou traz o tombstone ou pede ressincronização.
// Nunca um 200 sem ele (o app avançaria o cursor para além do marco e ficaria com o documento para sempre).
func TestSyncPullConcorrenteComGCNaoPerdeExclusao(t *testing.T) {
	e := newEnv(t)
	for i := 0; i < 100; i++ {
		id := fmt.Sprint("acc", i)
		code, o, _ := e.do("POST", "/api/sync", "", m{"cursor": 2 * i,
			"ops": []m{upsert("account", id, account("A")), op("account", id, "delete", nil)}}) // tombstone no rev 2i+2
		if code != 200 {
			t.Fatalf("push %d: %d %v", i, code, o)
		}
		done := make(chan error, 1)
		go func() {
			time.Sleep(time.Duration(i%20) * 20 * time.Microsecond) // espalha o instante do GC pela requisição
			_, err := e.st.GC(-time.Hour)
			done <- err
		}()
		code, o, _ = e.do("GET", fmt.Sprintf("/api/sync?since=%d", 2*i+1), "", nil)
		if err := <-done; err != nil {
			t.Fatal(err)
		}
		if code == 409 {
			continue
		}
		if ch, _ := o["changes"].([]any); code != 200 || len(ch) != 1 || ch[0].(map[string]any)["deleted"] != true {
			t.Fatalf("iteração %d: %d %v; quero o tombstone ou 409", i, code, o)
		}
	}
}
