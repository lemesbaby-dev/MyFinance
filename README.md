# Finanças

App pessoal de controle financeiro: **saldo atual**, **saldo previsto**, categorias,
recorrências e parcelamentos. Roda no navegador (PWA).

```
frontend/  Svelte 5 + Vite (PWA)  ──► build estático em frontend/dist
backend/   Go (stdlib) + SQLite   ──► 1 binário: API + serve o frontend
```

## Como o saldo é calculado

| | Fórmula |
|---|---|
| **Saldo atual** | saldo inicial + tudo que já foi **pago/recebido** |
| **Saldo previsto até D** | saldo atual + lançamentos **pendentes** com vencimento ≤ D (inclui atrasados) |

- Valores em **centavos (inteiros)**, nunca float.
- `amount_cents` é sempre positivo; o sinal vem do `kind` (`income`, `expense`, `transfer`).
- Transferência sai de uma conta e entra em outra, e **não conta como despesa** nem receita.
- A view `v_movements` (em `schema.sql`) transforma cada lançamento em deltas por conta; as
  queries de saldo ficam em `backend/internal/store/sql/`.

**Recorrências**: a regra fica em `recurrences`; as ocorrências são materializadas como
lançamentos *pendentes* nos próximos 12 meses (na criação, na subida do servidor e a cada 24 h).
Um índice único `(recurrence_id, date)` torna isso idempotente. Dia 31 em mês curto vira o último
dia do mês (31/01 → 28/02 → 31/03).

**Parcelas**: a soma das parcelas é sempre igual ao total; a sobra de centavos vai para as
primeiras (R$ 100,00 em 3x → 33,34 / 33,33 / 33,33).

## Rodar em desenvolvimento

```bash
# 1) backend (precisa de Go 1.22+ e acesso ao proxy de módulos na primeira vez)
cd backend
go mod tidy                 # baixa modernc.org/sqlite e gera go.sum
go test ./...
GOOGLE_CLIENT_ID=<seu-client-id>.apps.googleusercontent.com go run ./cmd/server   # http://localhost:8080

# 2) frontend (outro terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5173  (proxy /api -> :8080)
```

**Login:** Google Sign-In. Crie um *OAuth Client ID* (tipo Web) no Google Cloud Console e, em
"Origens JavaScript autorizadas", adicione `http://localhost:5173` (dev) e o domínio de produção.
Cadastro aberto: qualquer conta Google entra; `MAX_USERS` (padrão 200) limita o total.

## Produção (VM)

```bash
cd frontend && npm ci && npm run build
cd ../backend
CGO_ENABLED=0 go build -o financas ./cmd/server        # binário único, sem dependências

GOOGLE_CLIENT_ID='xxx.apps.googleusercontent.com' MAX_USERS=200 \
DB_PATH=/var/lib/financas/financas.db \
STATIC_DIR=/opt/financas/dist \
ADDR=127.0.0.1:8080 ./financas
```

- Coloque atrás de um proxy com **HTTPS** (Caddy ou Nginx): a sessão trafega no header e o login Google exige HTTPS.
- **Backup**: copie o arquivo `.db` (use `sqlite3 financas.db ".backup out.db"` com o app rodando).
- Bancos criados antes do M2 (M1) devem ser recriados; sem migração (nunca houve deploy).
- **M1 exige banco novo**; o schema do M0 não é migrado (M0 nunca foi para produção).
- `ADDR` padrão é `127.0.0.1:8080` (atrás do proxy); só confiamos em `X-Forwarded-For` quando a conexão vem de loopback.
- Variáveis: `ADDR`, `DB_PATH`, `STATIC_DIR`, `GOOGLE_CLIENT_ID`, `MAX_USERS`, `ALLOWED_ORIGINS` (CORS).

## APK (Android)

**Fora do escopo:** o alvo é o PWA. O Capacitor/APK não é mantido e a tela de configuração
de servidor foi removida; o app de Android não funciona nesta versão.

## API

| Método | Rota | |
|---|---|---|
| POST | `/api/auth/google` · `/api/auth/logout` · GET `/api/auth/me` | login Google, sessão |
| GET | `/api/sync?since=<rev>` | mudanças do usuário após o cursor (pull) |
| POST | `/api/sync` | lote de operações da fila do app, idempotente por `op_id` (push) |

O app guarda uma cópia local (IndexedDB) e calcula tudo offline; o servidor só autentica, valida e sincroniza.
Detalhes em `docs/02-arquitetura-offline.md`. **Em andamento:** o saldo/recorrência/parcelas em JS (M3) e a
interface sobre a cópia local (M4) ainda não foram feitos — a tela atual (`App.svelte`) usa a API antiga e está quebrada
nesta branch até lá.

Autenticação: `POST /api/auth/google` troca o ID token do Google por uma sessão; as demais rotas exigem `Authorization: Bearer <sessão>`. Todos os dados são isolados por usuário.

## Próximos passos (do que os concorrentes têm)

1. **Cartão de crédito** com fechamento/vencimento da fatura (tabela `cards`; compra entra na fatura do ciclo).
2. **Orçamento por categoria** (limite mensal + alerta).
3. **Editar** lançamento (hoje só cria/paga/exclui) e editar/encerrar recorrência.
4. Importação **OFX/CSV** e exportação.
5. **Modo offline** de verdade (fila local de lançamentos que sincroniza depois).
6. Open Finance (Pluggy/Belvo) — só se valer o custo.
