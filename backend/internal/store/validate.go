package store

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

// Formato dos documentos sincronizados (ids são UUIDs gerados no app).
// Qualquer campo fora destes é recusado: o servidor nunca guarda lixo.

type accountData struct {
	Name                string `json:"name"`
	Type                string `json:"type"`
	InitialBalanceCents int64  `json:"initial_balance_cents"`
	Archived            bool   `json:"archived"`
}

type categoryData struct {
	Name     string  `json:"name"`
	Kind     string  `json:"kind"`
	ParentID *string `json:"parent_id"`
	Color    string  `json:"color"`
}

type recurrenceData struct {
	Kind        string  `json:"kind"`
	Description string  `json:"description"`
	AmountCents int64   `json:"amount_cents"`
	AccountID   string  `json:"account_id"`
	CategoryID  *string `json:"category_id"`
	Frequency   string  `json:"frequency"`
	IntervalN   int     `json:"interval_n"`
	StartDate   string  `json:"start_date"`
	EndDate     *string `json:"end_date"`
	Active      bool    `json:"active"`
	// GeneratedUntil: até onde o app já gerou ocorrências (ocorrência excluída antes disso não volta).
	GeneratedUntil *string `json:"generated_until"`
}

type transactionData struct {
	Kind              string  `json:"kind"`
	Description       string  `json:"description"`
	AmountCents       int64   `json:"amount_cents"`
	Date              string  `json:"date"`
	Status            string  `json:"status"`
	PaidAt            *string `json:"paid_at"`
	AccountID         string  `json:"account_id"`
	TransferAccountID *string `json:"transfer_account_id"`
	CategoryID        *string `json:"category_id"`
	RecurrenceID      *string `json:"recurrence_id"`
	InstallmentNo     *int    `json:"installment_no"`
	InstallmentTotal  *int    `json:"installment_total"`
	InstallmentGroup  *string `json:"installment_group"`
	Notes             string  `json:"notes"`
}

const (
	maxText         = 200
	maxNotes        = 2000
	maxInstallments = 120
	maxCents        = 1_000_000_000_000_00 // R$ 1 trilhão: barra overflow/lixo sem atrapalhar ninguém
)

func validID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

func text(name, v string, max int, required bool) error {
	if required && strings.TrimSpace(v) == "" {
		return errors.New(name + " é obrigatório")
	}
	if utf8.RuneCountInString(v) > max { // runas, como o maxlength do cliente
		return errors.New(name + " muito longo")
	}
	return nil
}

func oneOf(v string, opts ...string) bool {
	for _, o := range opts {
		if v == o {
			return true
		}
	}
	return false
}

func strictDecode(raw json.RawMessage, v any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return errors.New("dados inválidos: " + err.Error())
	}
	return nil
}

// ref confere que id existe, não foi excluído e é do usuário (o dono vem do WHERE do exists).
type exists func(kind, id string) bool

func refOK(ex exists, kind string, id *string) bool { return id == nil || ex(kind, *id) }

// validateData confere o documento e devolve o JSON normalizado a ser gravado.
func validateData(kind, id string, raw json.RawMessage, ex exists, parentOf func(string) *string) (json.RawMessage, error) {
	var out any
	var err error
	switch kind {
	case "account":
		var a accountData
		if err = strictDecode(raw, &a); err == nil {
			err = firstErr(text("nome", a.Name, maxText, true),
				cond(oneOf(a.Type, "checking", "cash", "savings", "investment"), "tipo de conta inválido"),
				cond(a.InitialBalanceCents > -maxCents && a.InitialBalanceCents < maxCents, "saldo inicial fora do limite"))
		}
		out = a
	case "category":
		var c categoryData
		if err = strictDecode(raw, &c); err == nil {
			err = firstErr(text("nome", c.Name, maxText, true), text("cor", c.Color, 20, false),
				cond(oneOf(c.Kind, "income", "expense"), "tipo deve ser income ou expense"),
				cond(c.ParentID == nil || (*c.ParentID != id && ex("category", *c.ParentID)), "categoria-mãe inválida"),
				cond(!cycle(id, c.ParentID, parentOf), "hierarquia de categorias inválida (ciclo ou mais de 10 níveis)"))
		}
		out = c
	case "recurrence":
		var r recurrenceData
		if err = strictDecode(raw, &r); err == nil {
			err = firstErr(text("descrição", r.Description, maxText, true),
				cond(oneOf(r.Kind, "income", "expense"), "tipo deve ser income ou expense"),
				cond(r.AmountCents > 0 && r.AmountCents < maxCents, "valor deve ser maior que zero"),
				cond(ex("account", r.AccountID), "conta inválida"),
				cond(refOK(ex, "category", r.CategoryID), "categoria inválida"),
				ruleErr(r))
		}
		out = r
	case "transaction":
		var t transactionData
		if err = strictDecode(raw, &t); err == nil {
			if t.Status == "" {
				t.Status = "pending"
			}
			err = txErr(t, ex)
		}
		out = t
	default:
		err = errors.New("tipo de entidade inválido")
	}
	if err != nil {
		return nil, err
	}
	norm, _ := json.Marshal(out)
	return norm, nil
}

// cycle sobe a cadeia de parent_id (máx. 10 níveis); true se volta ao próprio id ou passa do limite.
func cycle(id string, parent *string, parentOf func(string) *string) bool {
	for i := 0; parent != nil; i++ {
		if *parent == id || i >= 10 {
			return true
		}
		parent = parentOf(*parent)
	}
	return false
}

func cond(ok bool, msg string) error {
	if ok {
		return nil
	}
	return errors.New(msg)
}

func firstErr(errs ...error) error {
	for _, e := range errs {
		if e != nil {
			return e
		}
	}
	return nil
}

const maxInterval = 1000

func parseDate(s string) (time.Time, error) { return time.ParseInLocation("2006-01-02", s, time.UTC) }

func ruleErr(r recurrenceData) error {
	start, err := parseDate(r.StartDate)
	if err != nil {
		return errors.New("start_date inválido")
	}
	if !oneOf(r.Frequency, "daily", "weekly", "monthly", "yearly") {
		return errors.New("frequência inválida")
	}
	if r.IntervalN < 1 || r.IntervalN > maxInterval {
		return errors.New("interval_n deve estar entre 1 e 1000")
	}
	if r.EndDate != nil {
		end, err := parseDate(*r.EndDate)
		if err != nil {
			return errors.New("end_date inválido")
		}
		if end.Before(start) {
			return errors.New("data final anterior à inicial")
		}
	}
	if r.GeneratedUntil != nil {
		if _, err := parseDate(*r.GeneratedUntil); err != nil {
			return errors.New("generated_until inválido")
		}
	}
	return nil
}

func txErr(t transactionData, ex exists) error {
	if err := firstErr(
		text("descrição", t.Description, maxText, true), text("notas", t.Notes, maxNotes, false),
		cond(oneOf(t.Kind, "income", "expense", "transfer"), "tipo deve ser income, expense ou transfer"),
		cond(t.AmountCents > 0 && t.AmountCents < maxCents, "valor deve ser maior que zero"),
		cond(oneOf(t.Status, "pending", "paid"), "status deve ser pending ou paid"),
		cond(ex("account", t.AccountID), "conta inválida"),
		cond(refOK(ex, "category", t.CategoryID), "categoria inválida"),
		cond(refOK(ex, "recurrence", t.RecurrenceID), "recorrência inválida"),
	); err != nil {
		return err
	}
	if _, err := parseDate(t.Date); err != nil {
		return errors.New("data inválida (use YYYY-MM-DD)")
	}
	if (t.Status == "paid") != (t.PaidAt != nil) {
		return errors.New("paid_at deve existir se, e somente se, status for paid")
	}
	if t.PaidAt != nil {
		if _, err := parseDate(*t.PaidAt); err != nil {
			return errors.New("paid_at inválido")
		}
	}
	if t.Kind == "transfer" {
		if t.TransferAccountID == nil || *t.TransferAccountID == t.AccountID || !ex("account", *t.TransferAccountID) {
			return errors.New("transferência exige uma conta de destino válida e diferente")
		}
	} else if t.TransferAccountID != nil {
		return errors.New("conta de destino só vale para transferência")
	}
	if (t.InstallmentNo == nil) != (t.InstallmentTotal == nil) {
		return errors.New("installment_no e installment_total andam juntos")
	}
	if t.InstallmentNo != nil && (*t.InstallmentNo < 1 || *t.InstallmentTotal > maxInstallments || *t.InstallmentNo > *t.InstallmentTotal) {
		return errors.New("parcela inválida")
	}
	return nil
}
