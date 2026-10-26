# 04 — API (alvo)

Base: `/api`. JSON UTF-8. Autenticação: `Authorization: Bearer <token de sessão>` (exceto `/auth/*` e `/health`).
Erros: `{ "error": "mensagem" }` com o status HTTP correto (nunca erro em 200).

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | liveness + ping no banco (503 se o banco não responder) |
| POST | `/auth/google` | `{id_token, device}` → `{token, user}`. Valida o token e cria o usuário no 1º acesso (casa por `google_sub`) |
| POST | `/auth/logout` | revoga a sessão atual |
| GET | `/auth/me` | usuário da sessão |
| GET | `/sync?since=<rev>&limit=` | pull: documentos alterados e tombstones após `rev`, em ordem |
| POST | `/sync` | push: lote (≤500) de operações idempotentes por `op_id`; resultado por operação (ver `02-arquitetura-offline.md`) |
| GET | `/export?format=json` | exporta todos os documentos vivos do próprio usuário (`{exported_at, email, entities:[{kind,id,rev,data}]}`), como download (`Content-Disposition`). Só JSON por enquanto |
| DELETE | `/account` | corpo `{"confirm_email":"..."}` igual ao e-mail da conta; apaga o usuário e tudo (documentos, sessões, `sync_ops`) em cascata |

## Cadastro
Google Sign-In (Google Identity Services, botão "Entrar com Google"). **Cadastro aberto**: qualquer
conta Google com e-mail verificado entra e o usuário é criado no 1º acesso. Sem tela de aprovação
e sem administração de usuários. Requer um *OAuth Client ID* (tipo Web) no Google Cloud Console,
com o domínio do app em "Origens JavaScript autorizadas"; tela de consentimento publicada em
produção (escopos básicos `openid email profile` não exigem verificação do Google).

**Proteção contra abuso** (já que o cadastro é aberto e a VM é pequena):
- `MAX_USERS` (padrão 200): acima disso, novos cadastros recebem "cadastros encerrados" — é a trava de segurança do disco/RAM.
- Cota por usuário: ≤ 50 mil linhas e ≤ 20 MB de dados; push acima disso é rejeitado.
- Rate limit: por IP em `/auth/google` (10/min); por usuário em `/sync` (push 120/min, pull 300/min). IPv6 por prefixo /64; `X-Forwarded-For` só de `TRUSTED_PROXY`.
- Limite de 20 000 operações por usuário por dia; `sync_ops` guarda só os últimos 2000 `op_id`s.

Verificação do ID token no Go: assinatura RS256 contra as chaves públicas do Google (JWKS, com cache),
`iss` = accounts.google.com, `aud` = nosso Client ID, `exp`, `email_verified`. Dá para fazer com
a stdlib (crypto/rsa) ou com `google.golang.org/api/idtoken` — decidimos no M1.

## Validação no servidor (push)
Cada upsert passa por `store/validate.go`: campos exatos (desconhecido é recusado), tipo, valor > 0, datas, `paid_at` ⇔ `status=paid`,
transferência com destino diferente e referências (`account_id`, `transfer_account_id`, `recurrence_id`) existentes e do próprio usuário;
`category_id`/`parent_id` inexistentes viram `null` em vez de recusar. Datas entre 1900 e 2200; valores < R$ 1 trilhão.
Operação inválida retorna erro **por operação** e não derruba o lote; o cliente mostra o item como "rejeitado".

## Limites
Corpo ≤ 1 MB por requisição; lote ≤ 500 operações; rate limit por usuário.

## Cabeçalhos de segurança
Todas as respostas (API e estáticos) levam `Content-Security-Policy`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer-when-downgrade` e `X-Frame-Options: DENY`. A CSP é a pedida (`default-src 'self'`, scripts/iframes/estilos de
`accounts.google.com`, `frame-ancestors 'none'`…). Ajuste em relação ao pedido: `connect-src` inclui também `https://accounts.google.com/gsi/`
(a documentação do Google Identity Services o lista); o app usa só o botão (script `gsi/client`, iframe e stylesheet `gsi/style`, estilos inline),
coberto por `script-src`, `frame-src` e `style-src` (`'unsafe-inline'`). Se o botão sumir após mudar a CSP, olhe primeiro o console do
navegador (violações de CSP). Não foi verificado em navegador real nesta revisão.
