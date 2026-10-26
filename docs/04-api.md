# 04 — API (alvo)

Base: `/api`. JSON UTF-8. Autenticação: `Authorization: Bearer <token de sessão>` (exceto `/auth/*` e `/health`).
Erros: `{ "error": "mensagem" }` com o status HTTP correto (nunca erro em 200).

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | liveness |
| POST | `/auth/google` | `{id_token, device}` → `{token, user}`. Valida o token e cria o usuário no 1º acesso (casa por `google_sub`) |
| POST | `/auth/logout` | revoga a sessão atual |
| GET | `/auth/me` | usuário da sessão |
| GET | `/sync?since=<rev>` | pull: linhas alteradas e tombstones após `rev` |
| POST | `/sync` | push: lote de operações idempotentes (ver `02-arquitetura-offline.md`) |
| GET | `/export?format=json\|csv` | exporta todos os dados do próprio usuário |
| DELETE | `/account` | exclui o usuário e todos os dados (confirmação digitando o e-mail) |

## Cadastro
Google Sign-In (Google Identity Services, botão "Entrar com Google"). **Cadastro aberto**: qualquer
conta Google com e-mail verificado entra e o usuário é criado no 1º acesso. Sem tela de aprovação
e sem administração de usuários. Requer um *OAuth Client ID* (tipo Web) no Google Cloud Console,
com o domínio do app em "Origens JavaScript autorizadas"; tela de consentimento publicada em
produção (escopos básicos `openid email profile` não exigem verificação do Google).

**Proteção contra abuso** (já que o cadastro é aberto e a VM é pequena):
- `MAX_USERS` (padrão 200): acima disso, novos cadastros recebem "cadastros encerrados" — é a trava de segurança do disco/RAM.
- Cota por usuário: ≤ 50 mil linhas e ≤ 20 MB de dados; push acima disso é rejeitado.
- Rate limit por usuário e por IP em `/auth/google` e `/sync`.

Verificação do ID token no Go: assinatura RS256 contra as chaves públicas do Google (JWKS, com cache),
`iss` = accounts.google.com, `aud` = nosso Client ID, `exp`, `email_verified`. Dá para fazer com
a stdlib (crypto/rsa) ou com `google.golang.org/api/idtoken` — decidimos no M1.

## Validação no servidor (push)
Mesmas regras do esqueleto (`validateTx`) para cada upsert: tipo, valor > 0, data válida,
transferência com destino diferente, `account_id`/`category_id`/`recurrence_id` pertencem ao usuário.
Operação inválida retorna erro **por operação** e não derruba o lote; o cliente mostra o item como "rejeitado".

## Limites
Corpo ≤ 1 MB por requisição; lote ≤ 500 operações; rate limit básico por usuário.
