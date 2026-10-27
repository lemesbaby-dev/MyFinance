# MyFinance

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
- O saldo é calculado **no app** (`frontend/src/lib/finance.js`); o servidor só guarda os documentos.

**Recorrências**: a regra é um documento `recurrence`; o app materializa as ocorrências como
lançamentos *pendentes* nos próximos 12 meses (na criação e a cada abertura/sincronização; sem job no servidor).
Um índice único `(user_id, recurrence_id, date)` no servidor impede duplicar a ocorrência entre aparelhos. Dia 31 em mês curto vira o último
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
- **Backup**: `scripts/backup.sh` (cron diário; usa `sqlite3 .backup`, rotação de `KEEP_DAYS` dias, comentários de como
  enviar para fora da VM com rclone/scp) e `scripts/restore-test.sh` (restaura o backup num arquivo temporário e roda
  `PRAGMA integrity_check` + contagem de linhas). Rode o restore-test de vez em quando: backup nunca restaurado é só esperança.
  ```bash
  DB_PATH=/var/lib/financas/financas.db BACKUP_DIR=/var/backups/financas scripts/backup.sh
  BACKUP_DIR=/var/backups/financas scripts/restore-test.sh
  ```
- **Schema versionado**: o banco guarda `PRAGMA user_version`; ao subir, o binário aplica as migrações pendentes
  (lista `migrations` em `backend/internal/store/store.go`). Banco antigo sem `user_version` é promovido sem perder dados.
  Binário mais antigo que o banco se recusa a abrir.
- `ADDR` padrão é `127.0.0.1:8080` (atrás do proxy). O `X-Forwarded-For` só é confiado quando a conexão vem de
  `TRUSTED_PROXY` (IP ou CIDR, lista separada por vírgula; padrão: loopback). Em IPv6 o limite de requisições usa o prefixo /64.
- Variáveis: `ADDR`, `DB_PATH`, `STATIC_DIR`, `GOOGLE_CLIENT_ID`, `MAX_USERS`, `ALLOWED_ORIGINS` (CORS), `TRUSTED_PROXY`.
- O servidor responde com `Content-Security-Policy` (e `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) em todas as
  respostas, faz shutdown gracioso em SIGINT/SIGTERM e registra um log de acesso (método, caminho, status, duração).
  `GET /api/health` confere o banco (503 se não responder): use-o no monitoramento.

## Instalar no celular (PWA)

Abra o endereço (HTTPS) no navegador do celular:
- **Android/Chrome:** menu ⋮ → *Instalar app* (ou o cartão "Instalar" na aba Mais).
- **iPhone/Safari:** Compartilhar → *Adicionar à Tela de Início*. Instalar importa: o Safari pode apagar os dados
  de sites que não são abertos por ~7 dias, mas não os de apps instalados na tela inicial.

O app abre sem internet (service worker guarda o casco; os dados ficam no aparelho e sincronizam depois).

## API

| Método | Rota | |
|---|---|---|
| POST | `/api/auth/google` · `/api/auth/logout` · GET `/api/auth/me` | login Google, sessão |
| GET | `/api/sync?since=<rev>` | mudanças do usuário após o cursor (pull) |
| POST | `/api/sync` | lote de operações da fila do app, idempotente por `op_id` (push) |
| GET | `/api/export?format=json` | todos os documentos do usuário (download) |
| DELETE | `/api/account` | `{"confirm_email": "..."}`: apaga a conta e tudo dela |
| GET | `/api/health` | liveness + ping no banco |

O app guarda uma cópia local (IndexedDB) e calcula tudo offline (`frontend/src/lib/finance.js`); o servidor só autentica,
valida e sincroniza. Detalhes em `docs/02-arquitetura-offline.md`.

Design: tokens, componentes (`frontend/src/ui/`) e regras em `docs/design-system.md`; tom de voz em `docs/voz-e-microcopy.md`. Página de componentes só em dev: `npm run dev` e `#/design`.

Testes: `cd backend && go test ./...` e `cd frontend && npm test` (node:test, sem dependências além de `fake-indexeddb`).

Autenticação: `POST /api/auth/google` troca o ID token do Google por uma sessão; as demais rotas exigem `Authorization: Bearer <sessão>`. Todos os dados são isolados por usuário.

## Próximos passos (do que os concorrentes têm)

1. **Cartão de crédito** com fechamento/vencimento da fatura (compra entra na fatura do ciclo).
2. **Orçamento por categoria** (limite mensal + alerta).
3. Importação **OFX/CSV**.
4. Open Finance (Pluggy/Belvo) — só se valer o custo.

Pendências conhecidas (ver `docs/05-plano-de-entregas.md`): limpeza (GC) de tombstones e detecção de conflito por `base_rev`.
