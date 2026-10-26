// Package store é a camada de persistência (SQLite).
package store

import (
	"database/sql"
	_ "embed"
	"fmt"
	"time"

	_ "modernc.org/sqlite" // driver SQLite puro Go (sem CGO)

	"financas/internal/finance"
)

//go:embed sql/schema.sql
var schemaSQL string

//go:embed sql/balances.sql
var balancesSQL string

//go:embed sql/spending_by_category.sql
var spendingSQL string

type Store struct{ db *sql.DB }

// Open abre (ou cria) o banco e aplica o schema.
func Open(path string) (*Store, error) {
	// WAL + busy_timeout: leituras não bloqueiam escrita e evitam "database is locked".
	dsn := fmt.Sprintf("file:%s?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // app pessoal: uma conexão basta e elimina disputa de lock
	if _, err := db.Exec(schemaSQL); err != nil {
		return nil, fmt.Errorf("aplicando schema: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

// ---------- modelos ----------

type Account struct {
	ID                  int64  `json:"id"`
	Name                string `json:"name"`
	Type                string `json:"type"`
	InitialBalanceCents int64  `json:"initial_balance_cents"`
}

type AccountBalance struct {
	ID             int64  `json:"id"`
	Name           string `json:"name"`
	Type           string `json:"type"`
	CurrentCents   int64  `json:"current_cents"`
	ProjectedCents int64  `json:"projected_cents"`
}

type Category struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	ParentID *int64 `json:"parent_id"`
	Color    string `json:"color,omitempty"`
}

type Transaction struct {
	ID                int64   `json:"id"`
	Kind              string  `json:"kind"` // income | expense | transfer
	Description       string  `json:"description"`
	AmountCents       int64   `json:"amount_cents"`
	Date              string  `json:"date"`
	Status            string  `json:"status"` // pending | paid
	PaidAt            *string `json:"paid_at"`
	AccountID         int64   `json:"account_id"`
	TransferAccountID *int64  `json:"transfer_account_id"`
	CategoryID        *int64  `json:"category_id"`
	RecurrenceID      *int64  `json:"recurrence_id"`
	InstallmentNo     *int    `json:"installment_no"`
	InstallmentTotal  *int    `json:"installment_total"`
	Notes             string  `json:"notes,omitempty"`
}

type Recurrence struct {
	ID          int64   `json:"id"`
	Kind        string  `json:"kind"`
	Description string  `json:"description"`
	AmountCents int64   `json:"amount_cents"`
	AccountID   int64   `json:"account_id"`
	CategoryID  *int64  `json:"category_id"`
	Frequency   string  `json:"frequency"`
	IntervalN   int     `json:"interval_n"`
	StartDate   string  `json:"start_date"`
	EndDate     *string `json:"end_date"`
}

type CategorySpending struct {
	CategoryID   int64  `json:"category_id"`
	Category     string `json:"category"`
	PaidCents    int64  `json:"paid_cents"`
	PendingCents int64  `json:"pending_cents"`
}

// ---------- contas / categorias ----------

func (s *Store) CreateAccount(a Account) (int64, error) {
	if a.Type == "" {
		a.Type = "checking"
	}
	r, err := s.db.Exec(`INSERT INTO accounts(name,type,initial_balance_cents) VALUES(?,?,?)`,
		a.Name, a.Type, a.InitialBalanceCents)
	if err != nil {
		return 0, err
	}
	return r.LastInsertId()
}

func (s *Store) Balances(until string) ([]AccountBalance, error) {
	rows, err := s.db.Query(balancesSQL, until)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AccountBalance{}
	for rows.Next() {
		var b AccountBalance
		if err := rows.Scan(&b.ID, &b.Name, &b.Type, &b.CurrentCents, &b.ProjectedCents); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (s *Store) CreateCategory(c Category) (int64, error) {
	r, err := s.db.Exec(`INSERT INTO categories(name,kind,parent_id,color) VALUES(?,?,?,?)`,
		c.Name, c.Kind, c.ParentID, nullIfEmpty(c.Color))
	if err != nil {
		return 0, err
	}
	return r.LastInsertId()
}

func (s *Store) Categories() ([]Category, error) {
	rows, err := s.db.Query(`SELECT id,name,kind,parent_id,COALESCE(color,'') FROM categories ORDER BY kind,name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Category{}
	for rows.Next() {
		var c Category
		if err := rows.Scan(&c.ID, &c.Name, &c.Kind, &c.ParentID, &c.Color); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) SpendingByCategory(from, to string) ([]CategorySpending, error) {
	rows, err := s.db.Query(spendingSQL, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CategorySpending{}
	for rows.Next() {
		var c CategorySpending
		if err := rows.Scan(&c.CategoryID, &c.Category, &c.PaidCents, &c.PendingCents); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ---------- lançamentos ----------

const txCols = `id,kind,description,amount_cents,date,status,paid_at,account_id,
transfer_account_id,category_id,recurrence_id,installment_no,installment_total,COALESCE(notes,'')`

func scanTx(sc interface{ Scan(...any) error }) (Transaction, error) {
	var t Transaction
	err := sc.Scan(&t.ID, &t.Kind, &t.Description, &t.AmountCents, &t.Date, &t.Status, &t.PaidAt,
		&t.AccountID, &t.TransferAccountID, &t.CategoryID, &t.RecurrenceID,
		&t.InstallmentNo, &t.InstallmentTotal, &t.Notes)
	return t, err
}

// ListTransactions filtra por período e (opcionalmente) status. Strings vazias = sem filtro.
func (s *Store) ListTransactions(from, to, status string) ([]Transaction, error) {
	rows, err := s.db.Query(`SELECT `+txCols+` FROM transactions
		WHERE (?1 = '' OR date >= ?1) AND (?2 = '' OR date <= ?2) AND (?3 = '' OR status = ?3)
		ORDER BY date, id`, from, to, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Transaction{}
	for rows.Next() {
		t, err := scanTx(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) CreateTransaction(t Transaction) (int64, error) {
	if t.Status == "" {
		t.Status = "pending"
	}
	if t.Status == "paid" && t.PaidAt == nil {
		d := t.Date
		t.PaidAt = &d
	}
	r, err := s.db.Exec(`INSERT INTO transactions
		(kind,description,amount_cents,date,status,paid_at,account_id,transfer_account_id,category_id,notes)
		VALUES(?,?,?,?,?,?,?,?,?,?)`,
		t.Kind, t.Description, t.AmountCents, t.Date, t.Status, t.PaidAt, t.AccountID,
		t.TransferAccountID, t.CategoryID, nullIfEmpty(t.Notes))
	if err != nil {
		return 0, err
	}
	return r.LastInsertId()
}

// CreateInstallments cria as N parcelas de uma compra numa única transação SQL.
func (s *Store) CreateInstallments(base Transaction, n int, first time.Time) ([]int64, error) {
	parts, err := finance.SplitInstallments(finance.Cents(base.AmountCents), n, first)
	if err != nil {
		return nil, err
	}
	group := fmt.Sprintf("%d-%d", time.Now().UnixNano(), base.AccountID)
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	ids := make([]int64, 0, n)
	for _, p := range parts {
		r, err := tx.Exec(`INSERT INTO transactions
			(kind,description,amount_cents,date,status,account_id,category_id,
			 installment_no,installment_total,installment_group)
			VALUES(?,?,?,?, 'pending', ?,?,?,?,?)`,
			base.Kind, base.Description, int64(p.Amount), finance.FormatDate(p.Date),
			base.AccountID, base.CategoryID, p.No, p.Total, group)
		if err != nil {
			return nil, err
		}
		id, _ := r.LastInsertId()
		ids = append(ids, id)
	}
	return ids, tx.Commit()
}

// MarkPaid efetiva um lançamento pendente. paidAt vazio = hoje.
func (s *Store) MarkPaid(id int64, paidAt string) error {
	if paidAt == "" {
		paidAt = time.Now().Format("2006-01-02")
	}
	r, err := s.db.Exec(`UPDATE transactions SET status='paid', paid_at=? WHERE id=? AND status='pending'`, paidAt, id)
	if err != nil {
		return err
	}
	if n, _ := r.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) MarkPending(id int64) error {
	_, err := s.db.Exec(`UPDATE transactions SET status='pending', paid_at=NULL WHERE id=?`, id)
	return err
}

func (s *Store) DeleteTransaction(id int64) error {
	_, err := s.db.Exec(`DELETE FROM transactions WHERE id=?`, id)
	return err
}

// ---------- recorrências ----------

// CreateRecurrence grava a regra e já materializa as ocorrências até `horizon`.
func (s *Store) CreateRecurrence(r Recurrence, horizon time.Time) (int64, error) {
	res, err := s.db.Exec(`INSERT INTO recurrences
		(kind,description,amount_cents,account_id,category_id,frequency,interval_n,start_date,end_date)
		VALUES(?,?,?,?,?,?,?,?,?)`,
		r.Kind, r.Description, r.AmountCents, r.AccountID, r.CategoryID,
		r.Frequency, r.IntervalN, r.StartDate, r.EndDate)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	r.ID = id
	return id, s.materialize(r, "", horizon)
}

// MaterializeAll gera as ocorrências que faltam de todas as recorrências ativas.
// Rode na subida do servidor e uma vez por dia: a janela rola sozinha.
func (s *Store) MaterializeAll(horizon time.Time) error {
	rows, err := s.db.Query(`SELECT id,kind,description,amount_cents,account_id,category_id,
		frequency,interval_n,start_date,end_date,COALESCE(generated_until,'')
		FROM recurrences WHERE active=1`)
	if err != nil {
		return err
	}
	type item struct {
		r     Recurrence
		since string
	}
	var items []item
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.r.ID, &it.r.Kind, &it.r.Description, &it.r.AmountCents, &it.r.AccountID,
			&it.r.CategoryID, &it.r.Frequency, &it.r.IntervalN, &it.r.StartDate, &it.r.EndDate, &it.since); err != nil {
			rows.Close()
			return err
		}
		items = append(items, it)
	}
	rows.Close()
	for _, it := range items {
		if err := s.materialize(it.r, it.since, horizon); err != nil {
			return err
		}
	}
	return nil
}

// materialize insere as ocorrências em (since, horizon]. O índice único
// (recurrence_id, date) torna a operação idempotente: rodar duas vezes não duplica.
func (s *Store) materialize(r Recurrence, since string, horizon time.Time) error {
	start, err := finance.ParseDate(r.StartDate)
	if err != nil {
		return err
	}
	rule := finance.Rule{Frequency: finance.Frequency(r.Frequency), Interval: r.IntervalN, Start: start}
	if r.EndDate != nil {
		e, err := finance.ParseDate(*r.EndDate)
		if err != nil {
			return err
		}
		rule.End = &e
	}
	from := start
	if since != "" {
		d, err := finance.ParseDate(since)
		if err != nil {
			return err
		}
		from = d.AddDate(0, 0, 1)
	}
	occ, err := rule.Occurrences(from, horizon)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	last := since
	for _, d := range occ {
		ds := finance.FormatDate(d)
		if _, err := tx.Exec(`INSERT OR IGNORE INTO transactions
			(kind,description,amount_cents,date,status,account_id,category_id,recurrence_id)
			VALUES(?,?,?,?, 'pending', ?,?,?)`,
			r.Kind, r.Description, r.AmountCents, ds, r.AccountID, r.CategoryID, r.ID); err != nil {
			return err
		}
		last = ds
	}
	if last != "" {
		if _, err := tx.Exec(`UPDATE recurrences SET generated_until=? WHERE id=?`, last, r.ID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
