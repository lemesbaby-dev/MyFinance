PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id                    INTEGER PRIMARY KEY,
  name                  TEXT    NOT NULL,
  type                  TEXT    NOT NULL DEFAULT 'checking'
                        CHECK (type IN ('checking','cash','savings','investment')),
  initial_balance_cents INTEGER NOT NULL DEFAULT 0,
  archived              INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id        INTEGER PRIMARY KEY,
  name      TEXT    NOT NULL,
  kind      TEXT    NOT NULL CHECK (kind IN ('income','expense')),
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  color     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cat_unique
  ON categories(kind, name, COALESCE(parent_id, 0));

-- Regra de recorrência. As ocorrências viram linhas em `transactions`
-- (materializadas até generated_until) e continuam editáveis uma a uma.
CREATE TABLE IF NOT EXISTS recurrences (
  id              INTEGER PRIMARY KEY,
  kind            TEXT    NOT NULL CHECK (kind IN ('income','expense')),
  description     TEXT    NOT NULL,
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  account_id      INTEGER NOT NULL REFERENCES accounts(id),
  category_id     INTEGER REFERENCES categories(id),
  frequency       TEXT    NOT NULL CHECK (frequency IN ('daily','weekly','monthly','yearly')),
  interval_n      INTEGER NOT NULL DEFAULT 1 CHECK (interval_n >= 1),
  start_date      TEXT    NOT NULL,          -- YYYY-MM-DD
  end_date        TEXT,                      -- NULL = sem fim
  generated_until TEXT,                      -- última data já materializada
  active          INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS transactions (
  id                  INTEGER PRIMARY KEY,
  kind                TEXT    NOT NULL CHECK (kind IN ('income','expense','transfer')),
  description         TEXT    NOT NULL,
  amount_cents        INTEGER NOT NULL CHECK (amount_cents > 0),  -- sempre positivo; o sinal vem de `kind`
  date                TEXT    NOT NULL,                           -- vencimento YYYY-MM-DD
  status              TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  paid_at             TEXT,
  account_id          INTEGER NOT NULL REFERENCES accounts(id),
  transfer_account_id INTEGER REFERENCES accounts(id),            -- só em transfer
  category_id         INTEGER REFERENCES categories(id),
  recurrence_id       INTEGER REFERENCES recurrences(id) ON DELETE SET NULL,
  installment_no      INTEGER,
  installment_total   INTEGER,
  installment_group   TEXT,                                       -- agrupa as parcelas de uma compra
  notes               TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK ((kind = 'transfer') = (transfer_account_id IS NOT NULL)),
  CHECK (transfer_account_id IS NULL OR transfer_account_id <> account_id),
  CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_tx_date     ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_status   ON transactions(status, date);
CREATE INDEX IF NOT EXISTS idx_tx_account  ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_recurrence_date
  ON transactions(recurrence_id, date) WHERE recurrence_id IS NOT NULL;

-- Efeito de cada lançamento sobre cada conta (delta com sinal).
-- Transferência gera duas linhas: sai de uma conta, entra na outra.
CREATE VIEW IF NOT EXISTS v_movements AS
  SELECT id AS tx_id, account_id, date, status,
         CASE kind WHEN 'income' THEN amount_cents ELSE -amount_cents END AS delta_cents
    FROM transactions
  UNION ALL
  SELECT id, transfer_account_id, date, status, amount_cents
    FROM transactions WHERE kind = 'transfer';
