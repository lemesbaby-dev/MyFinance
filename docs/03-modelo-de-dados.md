# 03 — Modelo de dados (alvo)

Convenções: `id` TEXT (UUIDv7 do cliente); dinheiro em centavos (INTEGER); datas `YYYY-MM-DD`
(TEXT); `rev` incrementado pelo servidor a cada escrita; `deleted_at` para exclusão lógica.
Toda tabela de dados tem `user_id` e **toda consulta filtra por ele**.

Servidor (SQLite) — `backend/internal/store/sql/schema.sql`:

```sql
users(id, google_sub UNIQUE, email, name, picture, rev, created_at)   -- rev = cursor de sync do usuário
sessions(token_hash PK, user_id, device, created_at, expires_at)      -- só o hash do token
entities(user_id, kind, id, rev, deleted_at, data JSON)               -- PK (user_id, kind, id)
sync_ops(user_id, op_id)                                              -- idempotência do push
```
Índices: `(user_id, rev)` para o pull; **único** `(user_id, recurrence_id, date)` parcial em lançamentos
vivos com recorrência (impede duplicar ocorrência entre aparelhos).

> **Mudança de rumo no M2:** em vez de uma tabela SQL tipada por entidade, o servidor guarda documentos JSON
> validados em `store/validate.go`. Como o app calcula tudo localmente, o servidor não consulta por campo;
> isso reduz o código e o esquema não precisa de migração a cada ajuste de campo.

Formato dos documentos (`data`); ids são UUIDv7 gerados no app; dinheiro em centavos; datas `YYYY-MM-DD`:

```
account:     name, type(checking|cash|savings|investment), initial_balance_cents, archived
category:    name, kind(income|expense), parent_id?, color
recurrence:  kind, description, amount_cents>0, account_id, category_id?, frequency(daily|weekly|monthly|yearly),
             interval_n(1..1000), start_date, end_date?, active
transaction: kind(income|expense|transfer), description, amount_cents>0, date, status(pending|paid), paid_at?,
             account_id, transfer_account_id?, category_id?, recurrence_id?,
             installment_no?, installment_total?(≤120), installment_group?, notes
```
Regras validadas no servidor: `paid_at` existe se, e só se, `status=paid`; transferência exige destino válido e
diferente da origem; referências (`account_id`, `category_id`, `recurrence_id`, `parent_id`) existem, não foram
excluídas e são **do mesmo usuário**. O servidor **não** cascateia exclusões: apagar uma conta com lançamentos é
regra do app (M4).

## Armazenamento no cliente (IndexedDB)
Stores (`frontend/src/lib/db.js`): `entities` (chave `[kind, id]`, índice por `kind`), `outbox` (autoincrement),
`meta` (`cursor`, `user`, `rejected`). As consultas por data/conta/categoria são feitas em memória pelo app
(milhares de linhas por usuário) — índices extras só se a medição pedir.

## Regras de saldo (calculadas no cliente)
- Saldo atual da conta = `initial_balance` + Σ deltas de lançamentos `paid` não excluídos.
- Delta: `income` +valor; `expense` −valor; `transfer` −valor na origem, +valor no destino.
- Previsto até D = atual + Σ deltas de `pending` com `date ≤ D` (inclui atrasados).
- Gastos do mês por categoria: `expense` do mês, pagos **e** pendentes (a confirmar com você).

## Migração do esqueleto
Banco novo; não há dados de produção a migrar. O `schema.sql` atual é substituído.
