// Package finance reúne as regras de negócio puras (sem banco, sem HTTP).
package finance

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// Cents é um valor monetário em centavos. Nunca use float para dinheiro.
type Cents int64

// FormatBRL formata como "R$ 1.234,56" (negativos: "-R$ 1.234,56").
func FormatBRL(c Cents) string {
	sign := ""
	if c < 0 {
		sign = "-"
		c = -c
	}
	reais := int64(c) / 100
	cent := int64(c) % 100
	s := strconv.FormatInt(reais, 10)
	var parts []string
	for len(s) > 3 {
		parts = append([]string{s[len(s)-3:]}, parts...)
		s = s[:len(s)-3]
	}
	parts = append([]string{s}, parts...)
	return fmt.Sprintf("%sR$ %s,%02d", sign, strings.Join(parts, "."), cent)
}

// ParseBRL aceita "1.234,56", "1234,56", "1234.56", "R$ 12,5" e "12".
func ParseBRL(in string) (Cents, error) {
	s := strings.TrimSpace(strings.ReplaceAll(in, "R$", ""))
	s = strings.ReplaceAll(s, " ", "")
	if s == "" {
		return 0, errors.New("valor vazio")
	}
	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")

	// Descobre o separador decimal: o último "," ou ".", se tiver 1–2 dígitos depois.
	dec := -1
	if i := strings.LastIndexAny(s, ",."); i >= 0 && len(s)-i-1 <= 2 && len(s)-i-1 >= 1 {
		dec = i
	}
	intPart, fracPart := s, ""
	if dec >= 0 {
		intPart, fracPart = s[:dec], s[dec+1:]
	}
	intPart = strings.NewReplacer(".", "", ",", "").Replace(intPart)
	if intPart == "" {
		intPart = "0"
	}
	for len(fracPart) < 2 {
		fracPart += "0"
	}
	reais, err := strconv.ParseInt(intPart, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("valor inválido: %q", in)
	}
	cent, err := strconv.ParseInt(fracPart, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("valor inválido: %q", in)
	}
	v := Cents(reais*100 + cent)
	if neg {
		v = -v
	}
	return v, nil
}
