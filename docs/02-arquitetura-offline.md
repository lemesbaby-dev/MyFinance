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
| `gone` | item já excluído (exclusão vence edição) | tira da fila; o pull traz o tombstone; **aparece na lista de recusados** ("foi excluído em outro aparelho") |
| `conflict` | INSERT de ocorrência de recorrência duplicada (outro aparelho já gerou o mesmo dia) | descarta a cópia local |
| `rejected` | inválida (`error`) — formato, referências, cota, limite diário, ou UPDATE que colidiria com outra ocorrência da recorrência | registra para a interface mostrar: contador na barra de status e na aba Mais; o item fica marcado "não enviado" e **fora dos saldos** até ser descartado ou corrigido (salvar de novo) |

Só `ok` entra em `sync_ops` (reenviar uma recusada devolve o mesmo status). `delete` de id desconhecido é no-op `ok`.
Referências já presentes no documento gravado não são revalidadas na edição. `GET /api/sync` devolve também `rev`:
se o cursor do app for maior, o servidor foi restaurado de backup e o app reenfileira tudo e refaz o pull.

**Conflitos**: *última escrita vence* por documento, na ordem de chegada; **exclusão vence edição**.
⚠️ **Limitação conhecida**: não há detecção de conflito por `base_rev`. Se dois aparelhos editam o mesmo documento
offline, a edição que chegar por último substitui a outra por inteiro (todos os campos do documento, não só o que mudou).
`pay/unpay` é um upsert do lançamento inteiro (`status` + `paid_at`).

**Isolamento e limites**: toda leitura/escrita filtra por `user_id`; ids e `op_id` valem por usuário.
Cota: 50 mil documentos e 20 MB por usuário, 16 KB por documento; os contadores (`rows_n`, `bytes_n`, `total_n`) ficam em `users`
e são atualizados dentro do push (recalculáveis: ver `recountSQL` em `store.go`), sem varrer `entities` a cada push.
`sync_ops` guarda só os últimos 2000 `op_id`s por usuário (e nada com mais de 90 dias). Limite de 20 000 operações por usuário
por dia (UTC; as que passarem voltam `rejected` "limite diário"). Rate limit: 120 pushes/min e 300 pulls/min por usuário.

**Referências a categorias** (`category_id`, `parent_id`) para categoria inexistente ou excluída **não** são recusadas:
o servidor grava `null` ("cura"). `account_id`, `transfer_account_id` e `recurrence_id` inválidos continuam `rejected`.
Datas valem de 1900 a 2200 e valores < R$ 1 trilhão, no servidor e no app.

**No app** (`frontend/src/lib/`): `db.js` (IndexedDB: `entities`, `outbox`, `meta`; grava dado e operação na
mesma transação), `sync.js` (push → pull; offline não é erro), `session.js` (de quem é o token e a cópia local), `uuid.js` (UUIDv7).
O pull **não sobrescreve** item com alteração local ainda na fila. Ao trocar de usuário no aparelho, a cópia local é zerada.
Se a cópia é de outra conta com alterações não enviadas (ou recusadas), o token da conta nova **não é gravado** (fica em memória) até
o usuário escolher "Descartar e continuar" ou entrar com a outra conta; o token salvo leva o `userId` e, ao abrir, é comparado com
o usuário da cópia local (divergiu: tela de bloqueio). Nada é enviado enquanto bloqueado. O push divide o lote ao meio em 400/413
(até 1 op; a que continuar falhando vira "recusada") e limita cada lote a ~600 KB.

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

## Deploy (VM)
- 1 VM pequena, **Caddy** (HTTPS automático via Let's Encrypt) → Go em `127.0.0.1:8080`, que também serve o front.
- Firewall: só 22 (por chave), 80, 443.
- Backup: `scripts/backup.sh` diário (`sqlite3 .backup`, rotação) + cópia para fora da VM (rclone/scp, exemplos no script).
  Restauração testada com `scripts/restore-test.sh` (integrity_check + contagem de linhas).
- Domínio/subdomínio apontando para a VM (necessário para HTTPS e para PWA instalar).
