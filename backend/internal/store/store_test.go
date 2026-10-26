package store

import (
	"path/filepath"
	"testing"
	"time"
)

// MaterializeAll não para na 1ª recorrência com defeito e devolve o primeiro erro.
func TestMaterializeAllContinuaAposErro(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.db.Exec(`INSERT INTO users(id,google_sub,email,name,picture) VALUES('u','s','e','n','p')`); err != nil {
		t.Fatal(err)
	}
	acc, err := s.CreateAccount("u", Account{Name: "C"})
	if err != nil {
		t.Fatal(err)
	}
	h := time.Now().AddDate(0, 6, 0)
	for _, d := range []string{"Ruim", "Boa"} {
		if _, err := s.CreateRecurrence("u", Recurrence{Kind: "expense", Description: d, AmountCents: 1,
			AccountID: acc, Frequency: "monthly", IntervalN: 1, StartDate: "2026-01-01"}, h); err != nil {
			t.Fatal(err)
		}
	}
	s.db.Exec(`UPDATE recurrences SET start_date='lixo' WHERE description='Ruim'`)
	s.db.Exec(`DELETE FROM transactions WHERE description='Boa'`)
	s.db.Exec(`UPDATE recurrences SET generated_until=NULL WHERE description='Boa'`)
	if err := s.MaterializeAll(h); err == nil {
		t.Error("deveria devolver o erro da regra corrompida")
	}
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM transactions WHERE description='Boa'`).Scan(&n)
	if n == 0 {
		t.Error("a recorrência saudável não foi materializada após o erro da outra")
	}
}

// Se materializar falha, a regra não pode ficar órfã.
func TestCreateRecurrenceAtomica(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	s.db.Exec(`INSERT INTO users(id,google_sub,email,name,picture) VALUES('u','s','e','n','p')`)
	acc, _ := s.CreateAccount("u", Account{Name: "C"})
	_, err = s.CreateRecurrence("u", Recurrence{Kind: "expense", Description: "x", AmountCents: 1,
		AccountID: acc, Frequency: "monthly", IntervalN: 1, StartDate: "lixo"}, time.Now())
	if err == nil {
		t.Fatal("start_date inválido deveria falhar")
	}
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM recurrences`).Scan(&n)
	if n != 0 {
		t.Errorf("regra órfã: %d", n)
	}
}
