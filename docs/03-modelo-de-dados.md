# 03 — Modelo de dados (alvo)

Convenções: `id` TEXT (UUIDv7 do cliente); dinheiro em centavos (INTEGER); datas `YYYY-MM-DD`
(TEXT); `rev` incrementado pelo servidor a cada escrita; `deleted_at` para exclusão lógica.
Toda tabela de dados tem `user_id` e **toda consulta filtra por ele**.

```sql
users(
  id TEXT PK, email TEXT UNIQUE NOT NULL, google_sub TEXT UNIQUE,  -- `sub` do Google: identidade estável
  name TEXT, picture TEXT, created_at TEXT
)

sessions(                      -- token opaco; guardamos só o hash
  token_hash TEXT PK, user_id TEXT NOT NULL, device TEXT,
  created_at TEXT, last_seen TEXT, revoked_at TEXT
)

accounts(
  id, user_id, name, type CHECK IN ('checking','cash','savings','investment'),
  initial_balance_cents, archived, rev, deleted_at
)

categories(
  id, user_id, name, kind CHECK IN ('income','expense'),
  parent_id NULL, color NULL, rev, deleted_at
)

recurrences(
  id, user_id, kind, description, amount_cents > 0, account_id, category_id NULL,
  frequency CHECK IN ('daily','weekly','monthly','yearly'), interval_n >= 1,
  start_date, end_date NULL, active, rev, deleted_at
)

transactions(
  id, user_id, kind CHECK IN ('income','expense','transfer'),
  description, amount_cents > 0, date, status CHECK IN ('pending','paid'), paid_at NULL,
  account_id, transfer_account_id NULL, category_id NULL,
  recurrence_id NULL, installment_no NULL, installment_total NULL, installment_group NULL,
  notes NULL, rev, deleted_at
)
  -- CHECKs do esqueleto mantidos (transfer ⇔ destino, destino ≠ origem, paid ⇔ paid_at)
  -- UNIQUE (user_id, recurrence_id, date) WHERE recurrence_id IS NOT NULL AND deleted_at IS NULL

sync_ops(                      -- idempotência do push
  op_id TEXT PK, user_id TEXT, applied_at TEXT
)

meta(key TEXT PK, value TEXT)  -- contador global de `rev`
```

## Índices
`(user_id, rev)` em cada tabela de dados (pull); `(user_id, date)` e `(user_id, status, date)` em `transactions`.

## Armazenamento no cliente (IndexedDB)
Stores: `accounts`, `categories`, `recurrences`, `transactions` (índices por `date`, `account_id`,
`category_id`), `outbox` (autoincrement), `meta` (`cursor`, `user`, `lastSyncAt`).

## Regras de saldo (calculadas no cliente)
- Saldo atual da conta = `initial_balance` + Σ deltas de lançamentos `paid` não excluídos.
- Delta: `income` +valor; `expense` −valor; `transfer` −valor na origem, +valor no destino.
- Previsto até D = atual + Σ deltas de `pending` com `date ≤ D` (inclui atrasados).
- Gastos do mês por categoria: `expense` do mês, pagos **e** pendentes (a confirmar com você).

## Migração do esqueleto
Banco novo; não há dados de produção a migrar. O `schema.sql` atual é substituído.
