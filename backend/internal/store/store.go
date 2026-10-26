// Package store é a camada de persistência (SQLite).
package store

import (
	"database/sql"
	_ "embed"
	"fmt"

	_ "modernc.org/sqlite" // driver SQLite puro Go (sem CGO)
)

//go:embed sql/schema.sql
var schemaSQL string

type Store struct{ db *sql.DB }

// Open abre (ou cria) o banco e aplica o schema.
func Open(path string) (*Store, error) {
	// WAL + busy_timeout: leituras não bloqueiam escrita e evitam "database is locked".
	dsn := fmt.Sprintf("file:%s?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // uma conexão basta e elimina disputa de lock
	if _, err := db.Exec(schemaSQL); err != nil {
		return nil, fmt.Errorf("aplicando schema: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }
