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

// migrations[i] leva o banco da versão i+1 para i+2 (PRAGMA user_version). A versão 1 é o schema.sql
// (idempotente: também "promove" um banco antigo que nunca teve user_version). Para mudar o schema,
// ACRESCENTE uma entrada aqui; nunca edite as anteriores.
var migrations = []string{
	// v2: contadores de uso e do limite diário por usuário (evita varrer `entities` a cada push).
	// Recalculáveis a qualquer momento com o mesmo UPDATE.
	`ALTER TABLE users ADD COLUMN rows_n  INTEGER NOT NULL DEFAULT 0;
	 ALTER TABLE users ADD COLUMN bytes_n INTEGER NOT NULL DEFAULT 0;
	 ALTER TABLE users ADD COLUMN total_n INTEGER NOT NULL DEFAULT 0;
	 ALTER TABLE users ADD COLUMN ops_day TEXT    NOT NULL DEFAULT '';
	 ALTER TABLE users ADD COLUMN ops_n   INTEGER NOT NULL DEFAULT 0;` + recountSQL,
}

// recountSQL: rows_n = vivos, bytes_n = bytes dos vivos, total_n = com tombstones.
const recountSQL = `
UPDATE users SET
  rows_n  = (SELECT COUNT(*) FROM entities e WHERE e.user_id=users.id AND e.deleted_at IS NULL),
  bytes_n = (SELECT COALESCE(SUM(length(CAST(e.data AS BLOB))),0) FROM entities e WHERE e.user_id=users.id AND e.deleted_at IS NULL),
  total_n = (SELECT COUNT(*) FROM entities e WHERE e.user_id=users.id);`

type Store struct{ db *sql.DB }

// Open abre (ou cria) o banco e leva o schema à versão atual.
func Open(path string) (*Store, error) {
	// WAL + busy_timeout: leituras não bloqueiam escrita e evitam "database is locked".
	dsn := fmt.Sprintf("file:%s?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // uma conexão basta e elimina disputa de lock
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func migrate(db *sql.DB) error {
	var v int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil {
		return err
	}
	if v > len(migrations)+1 {
		return fmt.Errorf("banco na versão %d, mais novo que este binário (%d)", v, len(migrations)+1)
	}
	step := func(ver int, stmt string) error {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("migração para v%d: %w", ver, err)
		}
		if _, err := tx.Exec(fmt.Sprintf(`PRAGMA user_version=%d`, ver)); err != nil {
			return err
		}
		return tx.Commit()
	}
	if v < 1 {
		if err := step(1, schemaSQL); err != nil {
			return err
		}
		v = 1
	}
	for ; v <= len(migrations); v++ {
		if err := step(v+1, migrations[v-1]); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) Close() error { return s.db.Close() }

// Ping confere que o banco responde (health check).
func (s *Store) Ping() error {
	var n int
	return s.db.QueryRow(`SELECT 1`).Scan(&n)
}
