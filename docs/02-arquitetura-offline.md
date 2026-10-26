# 02 — Arquitetura e estratégia offline

## Decisão central
Você escolheu a **opção B (cache + fila de escrita)**. Como o requisito é offline para **tudo**
(incluindo projeção e meses futuros), a consequência prática é:

> **O cliente guarda uma cópia completa dos dados do usuário e calcula tudo localmente.
> O servidor é armazenamento, autenticação e ponto de sincronização.**

Com ≤10 usuários e poucos milhares de linhas por pessoa, copiar tudo para o aparelho é barato
(~1–3 MB) e evita um motor de consulta parcial.

## Decisão proposta: lógica financeira só no cliente (JS)
Hoje o esqueleto calcula saldo, recorrência e parcelas em **Go**. Offline isso precisa existir
em **JS**. Manter as duas = dois lugares para divergir. Proposta:

- Saldo, recorrência e parcelas passam a viver **só no JS** (`frontend/src/lib/finance/`).
- O servidor deixa de calcular; o Go fica com auth, CRUD de linhas, sync e backup.
- Os testes do Go (`finance_test.go`) viram **vetores de teste** portados para o JS (dia 31, parcelas 33,34/33,33/33,33 etc.).
- Some o `summary` do servidor e o job de 24 h que materializa recorrências.

⚠️ **Precisa da sua confirmação** — é a maior mudança em relação ao esqueleto.

## Componentes
```
PWA (Svelte)
 ├─ IndexedDB ........ cópia dos dados + tabela `outbox` (fila de operações)
 ├─ lib/finance ...... saldo, recorrência, parcelas (puro, testável)
 ├─ lib/sync ......... push da outbox + pull de mudanças
 └─ Service Worker ... cache do "casco" (HTML/JS/CSS/ícones)

Servidor (Go + SQLite WAL)
 ├─ auth ............. login, sessão
 ├─ /api/sync ........ push (lote idempotente) e pull (por cursor)
 └─ SQLite ........... linhas + tombstones + `rev` crescente
```
Cliente usa a biblioteca `idb` (wrapper pequeno) ou IndexedDB puro. Sem SQLite-WASM (pesado).

## Identificadores
- **UUIDv7 gerado no cliente** para toda entidade (conta, categoria, lançamento, recorrência).
  Permite criar offline e reenviar sem duplicar.
- O servidor guarda o UUID como `id` (TEXT). `INTEGER` autoincrement deixa de ser a chave.

## Protocolo de sincronização (implementado no M2)
O servidor guarda **documentos JSON** numa só tabela `entities` (`user_id, kind, id, rev, deleted_at, data`),
com `kind` ∈ `account | category | recurrence | transaction`. `rev` é um contador **por usuário**
(cada escrita incrementa) e serve de cursor. Exclusão é lógica (tombstone).

**Pull** — `GET /api/sync?since=<rev>&limit=<n≤1000>` →
`{ changes: [{kind, id, rev, deleted, data}], cursor, more }`. O app repete enquanto `more=true`.

**Push** — `POST /api/sync` (lote ≤ 500 operações, aplicado numa transação):
```json
{ "ops": [ { "op_id": "uuid", "kind": "transaction", "id": "uuid", "action": "upsert|delete", "data": { … } } ] }
```
Resposta `{ results: [{op_id, status, error?}] }`, com `status`:

| status | significado | o app faz |
|---|---|---|
| `ok` | aplicada | tira da fila |
| `dup` | `op_id` já aplicado (reenvio após queda de rede) | tira da fila |
| `gone` | item já excluído (exclusão vence edição) | tira da fila; o pull traz o tombstone |
| `conflict` | INSERT de ocorrência de recorrência duplicada (outro aparelho já gerou o mesmo dia) | descarta a cópia local |
| `rejected` | inválida (`error`) — formato, referências, cota, ou UPDATE que colidiria com outra ocorrência da recorrência | registra para a interface mostrar |

Só `ok` entra em `sync_ops` (reenviar uma recusada devolve o mesmo status). `delete` de id desconhecido é no-op `ok`.
Referências já presentes no documento gravado não são revalidadas na edição. `GET /api/sync` devolve também `rev`:
se o cursor do app for maior, o servidor foi restaurado de backup e o app reenfileira tudo e refaz o pull.

**Conflitos**: *última escrita vence* por documento, na ordem de chegada; **exclusão vence edição**.
`pay/unpay` é um upsert do lançamento inteiro (`status` + `paid_at`).

**Isolamento e limites**: toda leitura/escrita filtra por `user_id`; ids e `op_id` valem por usuário.
Cota: 50 mil documentos e 20 MB por usuário, 16 KB por documento.

**No app** (`frontend/src/lib/`): `db.js` (IndexedDB: `entities`, `outbox`, `meta`; grava dado e operação na
mesma transação), `sync.js` (push → pull; offline não é erro), `uuid.js` (UUIDv7). O pull **não sobrescreve**
item com alteração local ainda na fila. Ao trocar de usuário no aparelho, a cópia local é zerada.

**Quando sincroniza**: ao abrir, ao voltar `online`, após cada gravação (debounce 2 s) e botão manual.
Falha de rede ⇒ a operação continua na outbox; nada se perde. (M2: ao abrir, ao voltar online, ao voltar à aba e 1,5 s após gravar.)

**Ordem**: a outbox é enviada na ordem de criação; o servidor valida referências (conta existe e é do usuário).

## Recorrências e parcelas offline
- Regra de recorrência é uma entidade; as **ocorrências são lançamentos** gerados no cliente
  (12 meses à frente), ligados por `recurrence_id`.
- Índice único `(recurrence_id, date)` no servidor com `ON CONFLICT DO NOTHING` impede duplicata
  se dois aparelhos materializarem a mesma janela.
- **Janela rolante**: ao abrir o app, o cliente estende as ocorrências até hoje + 12 meses
  (substitui o job de 24 h do servidor). Se ninguém abre o app, ninguém precisa dos lançamentos.
- Parcelas: N lançamentos com o mesmo `installment_group`, gerados no cliente.

## Mudança em relação ao esqueleto
| Esqueleto | Passa a ser |
|---|---|
| `id INTEGER` | `id TEXT` (UUIDv7) |
| token único `FINANCAS_TOKEN` | login por usuário + sessão |
| sem `user_id` | `user_id` em todas as tabelas |
| `/api/summary`, `/api/transactions…` | `/api/sync` (+ auth) |
| cálculo em Go | cálculo em JS |
| delete físico | `deleted_at` (tombstone) |

## Deploy (Contabo)
- 1 VM pequena, **Caddy** (HTTPS automático via Let's Encrypt) → Go em `127.0.0.1:8080`, que também serve o front.
- Firewall: só 22 (por chave), 80, 443.
- Backup: `sqlite3 .backup` diário + cópia para fora da VM (ex.: bucket S3/B2 ou outra máquina). Restauração testada.
- Domínio/subdomínio apontando para a VM (necessário para HTTPS e para PWA instalar).
