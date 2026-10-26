package finance

import (
	"errors"
	"time"
)

type Frequency string

const (
	Daily   Frequency = "daily"
	Weekly  Frequency = "weekly"
	Monthly Frequency = "monthly"
	Yearly  Frequency = "yearly"
)

// Rule descreve uma recorrência. Datas são sempre em UTC, sem horário.
type Rule struct {
	Frequency Frequency
	Interval  int        // a cada N períodos (>= 1)
	Start     time.Time  // primeira ocorrência
	End       *time.Time // nil = sem fim (inclusive quando definido)
}

// Date monta uma data UTC à meia-noite.
func Date(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// ParseDate lê "YYYY-MM-DD".
func ParseDate(s string) (time.Time, error) {
	return time.ParseInLocation("2006-01-02", s, time.UTC)
}

// FormatDate escreve "YYYY-MM-DD".
func FormatDate(t time.Time) string { return t.Format("2006-01-02") }

func daysIn(y int, m time.Month) int {
	return time.Date(y, m+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// nth devolve a n-ésima ocorrência (n=0 é Start).
// No mensal/anual o dia original é preservado e "encolhido" quando o mês é curto:
// começando em 31/01 → 28/02 → 31/03 (e não 28/03). Por isso calculamos a partir de
// Start a cada vez, em vez de encadear a ocorrência anterior.
func (r Rule) nth(n int) time.Time {
	step := n * r.Interval
	switch r.Frequency {
	case Daily:
		return r.Start.AddDate(0, 0, step)
	case Weekly:
		return r.Start.AddDate(0, 0, 7*step)
	case Monthly:
		return addMonthsClamped(r.Start, step)
	case Yearly:
		return addMonthsClamped(r.Start, 12*step)
	}
	return r.Start
}

func addMonthsClamped(t time.Time, months int) time.Time {
	total := int(t.Month()) - 1 + months
	y := t.Year() + total/12
	m := time.Month(total%12 + 1)
	d := t.Day()
	if max := daysIn(y, m); d > max {
		d = max
	}
	return Date(y, m, d)
}

// Validate confere a regra.
func (r Rule) Validate() error {
	switch r.Frequency {
	case Daily, Weekly, Monthly, Yearly:
	default:
		return errors.New("frequência inválida")
	}
	if r.Interval < 1 {
		return errors.New("intervalo deve ser >= 1")
	}
	if r.End != nil && r.End.Before(r.Start) {
		return errors.New("data final anterior à inicial")
	}
	return nil
}

// maxOccurrences protege contra regras absurdas (ex.: diária por 100 anos).
const maxOccurrences = 5000

// Occurrences lista as ocorrências com from <= data <= to, respeitando End.
func (r Rule) Occurrences(from, to time.Time) ([]time.Time, error) {
	if err := r.Validate(); err != nil {
		return nil, err
	}
	var out []time.Time
	for n := 0; n < maxOccurrences; n++ {
		d := r.nth(n)
		if d.After(to) || (r.End != nil && d.After(*r.End)) {
			break
		}
		if !d.Before(from) {
			out = append(out, d)
		}
	}
	return out, nil
}

// Installment é uma parcela de uma compra parcelada.
type Installment struct {
	No     int
	Total  int
	Amount Cents
	Date   time.Time
}

// SplitInstallments divide total em n parcelas mensais a partir de first.
// A soma das parcelas é sempre igual ao total: os centavos que sobram da divisão
// vão para as primeiras parcelas (R$ 100,00 em 3x → 33,34 / 33,33 / 33,33).
func SplitInstallments(total Cents, n int, first time.Time) ([]Installment, error) {
	if n < 1 {
		return nil, errors.New("número de parcelas deve ser >= 1")
	}
	if total <= 0 {
		return nil, errors.New("valor deve ser positivo")
	}
	base := total / Cents(n)
	rest := int(total % Cents(n))
	out := make([]Installment, n)
	for i := 0; i < n; i++ {
		amt := base
		if i < rest {
			amt++
		}
		out[i] = Installment{
			No: i + 1, Total: n, Amount: amt,
			Date: addMonthsClamped(first, i),
		}
	}
	return out, nil
}
