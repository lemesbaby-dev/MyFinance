# Finanças

App pessoal de controle financeiro: **saldo atual**, **saldo previsto**, categorias,
recorrências e parcelamentos. Roda no navegador (PWA) e no Android (APK via Capacitor).

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
- Variáveis: `ADDR`, `DB_PATH`, `STATIC_DIR`, `GOOGLE_CLIENT_ID`, `MAX_USERS`, `ALLOWED_ORIGINS` (CORS).

## APK (Android)

Requer Android Studio (ou SDK + JDK 17).

```bash
cd frontend
npx cap add android         # 1ª vez: gera a pasta android/
npm run android:sync        # build + copia o front para o projeto Android
npm run android:open        # abre no Android Studio → Build > Build APK(s)
```

Na primeira abertura do app, informe a URL HTTPS do servidor e o token. O APK usa a origem
`https://localhost` (já liberada no CORS por padrão).

## API

| Método | Rota | |
|---|---|---|
| GET | `/api/summary?until=YYYY-MM-DD` | saldos por conta, atual/previsto e gastos do mês por categoria |
| GET/POST | `/api/transactions` | filtros `from`, `to`, `status`; `installments` no POST cria parcelas |
| POST | `/api/transactions/{id}/pay` · `/unpay` | efetiva / desfaz |
| DELETE | `/api/transactions/{id}` | |
| POST | `/api/recurrences` | cria a regra e materializa 12 meses |
| POST | `/api/accounts` · GET/POST `/api/categories` | |

Autenticação: `POST /api/auth/google` troca o ID token do Google por uma sessão; as demais rotas exigem `Authorization: Bearer <sessão>`. Todos os dados são isolados por usuário.

## Próximos passos (do que os concorrentes têm)

1. **Cartão de crédito** com fechamento/vencimento da fatura (tabela `cards`; compra entra na fatura do ciclo).
2. **Orçamento por categoria** (limite mensal + alerta).
3. **Editar** lançamento (hoje só cria/paga/exclui) e editar/encerrar recorrência.
4. Importação **OFX/CSV** e exportação.
5. **Modo offline** de verdade (fila local de lançamentos que sincroniza depois).
6. Open Finance (Pluggy/Belvo) — só se valer o custo.
