package finance

import (
	"testing"
	"time"
)

func TestFormatBRL(t *testing.T) {
	cases := map[Cents]string{
		0: "R$ 0,00", 5: "R$ 0,05", 123456: "R$ 1.234,56",
		100000000: "R$ 1.000.000,00", -2550: "-R$ 25,50",
	}
	for in, want := range cases {
		if got := FormatBRL(in); got != want {
			t.Errorf("FormatBRL(%d) = %q, quero %q", in, got, want)
		}
	}
}

func TestParseBRL(t *testing.T) {
	cases := map[string]Cents{
		"1.234,56": 123456, "1234,56": 123456, "1234.56": 123456,
		"R$ 12,5": 1250, "12": 1200, "0,99": 99, "-10,00": -1000,
		"1.000": 100000, // ponto com 3 dígitos depois = milhar, não decimal
	}
	for in, want := range cases {
		got, err := ParseBRL(in)
		if err != nil || got != want {
			t.Errorf("ParseBRL(%q) = %d, %v; quero %d", in, got, err, want)
		}
	}
	for _, bad := range []string{"", "abc", "R$"} {
		if _, err := ParseBRL(bad); err == nil {
			t.Errorf("ParseBRL(%q) deveria falhar", bad)
		}
	}
}

func dates(ts []time.Time) []string {
	out := make([]string, len(ts))
	for i, t := range ts {
		out[i] = FormatDate(t)
	}
	return out
}

func eq(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestMonthlyClampsShortMonths(t *testing.T) {
	r := Rule{Frequency: Monthly, Interval: 1, Start: Date(2026, 1, 31)}
	got, err := r.Occurrences(Date(2026, 1, 1), Date(2026, 5, 31))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"}
	if !eq(dates(got), want) {
		t.Errorf("got %v, quero %v", dates(got), want)
	}
}

func TestMonthlyLeapYear(t *testing.T) {
	r := Rule{Frequency: Monthly, Interval: 1, Start: Date(2028, 1, 31)}
	got, _ := r.Occurrences(Date(2028, 2, 1), Date(2028, 2, 29))
	if !eq(dates(got), []string{"2028-02-29"}) {
		t.Errorf("got %v", dates(got))
	}
}

func TestIntervalAndEnd(t *testing.T) {
	end := Date(2026, 12, 1)
	r := Rule{Frequency: Monthly, Interval: 3, Start: Date(2026, 1, 15), End: &end}
	got, _ := r.Occurrences(Date(2026, 1, 1), Date(2030, 1, 1))
	want := []string{"2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15"}
	if !eq(dates(got), want) {
		t.Errorf("got %v, quero %v", dates(got), want)
	}
}

func TestWindowStartsAfterRuleStart(t *testing.T) {
	r := Rule{Frequency: Weekly, Interval: 2, Start: Date(2026, 1, 1)}
	got, _ := r.Occurrences(Date(2026, 1, 20), Date(2026, 2, 20))
	want := []string{"2026-01-29", "2026-02-12"}
	if !eq(dates(got), want) {
		t.Errorf("got %v, quero %v", dates(got), want)
	}
}

func TestYearlyFeb29(t *testing.T) {
	r := Rule{Frequency: Yearly, Interval: 1, Start: Date(2028, 2, 29)}
	got, _ := r.Occurrences(Date(2028, 1, 1), Date(2030, 12, 31))
	want := []string{"2028-02-29", "2029-02-28", "2030-02-28"}
	if !eq(dates(got), want) {
		t.Errorf("got %v, quero %v", dates(got), want)
	}
}

func TestValidate(t *testing.T) {
	bad := []Rule{
		{Frequency: "x", Interval: 1, Start: Date(2026, 1, 1)},
		{Frequency: Monthly, Interval: 0, Start: Date(2026, 1, 1)},
	}
	for _, r := range bad {
		if _, err := r.Occurrences(Date(2026, 1, 1), Date(2026, 2, 1)); err == nil {
			t.Errorf("regra %+v deveria falhar", r)
		}
	}
}

func TestSplitInstallments(t *testing.T) {
	ps, err := SplitInstallments(10000, 3, Date(2026, 1, 31))
	if err != nil {
		t.Fatal(err)
	}
	wantAmt := []Cents{3334, 3333, 3333}
	wantDate := []string{"2026-01-31", "2026-02-28", "2026-03-31"}
	var sum Cents
	for i, p := range ps {
		sum += p.Amount
		if p.Amount != wantAmt[i] || FormatDate(p.Date) != wantDate[i] || p.No != i+1 || p.Total != 3 {
			t.Errorf("parcela %d = %+v", i+1, p)
		}
	}
	if sum != 10000 {
		t.Errorf("soma das parcelas = %d, quero 10000", sum)
	}
	if _, err := SplitInstallments(0, 3, Date(2026, 1, 1)); err == nil {
		t.Error("valor 0 deveria falhar")
	}
	if _, err := SplitInstallments(100, 0, Date(2026, 1, 1)); err == nil {
		t.Error("0 parcelas deveria falhar")
	}
}
