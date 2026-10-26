# 05 — Plano de entregas

Cada marco termina com algo que roda e foi validado. Ordem pensada para provar o risco maior
(offline + sync) cedo.

| # | Marco | Pronto quando |
|---|---|---|
| M0 | **Base** — rodar o esqueleto, `go test`, `npm run build`; repo git; CI mínimo | testes verdes, app abre local |
| M1 | **Multiusuário** — `users`, `sessions`, login Google (cadastro aberto + `MAX_USERS`/cotas), logout, `user_id` em tudo | teste prova que A não lê dados de B |
| M2 | **Camada local + sync** — IDs UUIDv7, `rev`/tombstone, `/api/sync`, IndexedDB, outbox | criar lançamento offline → voltar rede → aparece em outro aparelho, sem duplicar (teste com queda no meio do push) |
| M3 | **Lógica no cliente** — saldo atual/previsto, recorrência, parcelas em JS com os vetores de teste do Go | mesmos casos do `finance_test.go` passam em JS |
| M4 | **CRUD completo na UI** — contas, categorias, lançamentos, recorrências (editar: só esta / próximas / todas), navegação por mês | usar o app 100% em modo avião |
| M5 | **PWA** — instalável, ícones, aviso offline/pendências, `storage.persist()`, tela "Cartão — em breve" | Lighthouse PWA ok; teste real no Android e iPhone |
| M6 | **Deploy Contabo** — Caddy + HTTPS, serviço, firewall, backup diário com cópia externa, restauração testada | acessível por domínio; restore feito de verdade |
| M7 | **Exportar/excluir dados**, polimento, README | RF/RNF revisados |

## v2 (pós-MVP, por prioridade sugerida)
1. Cartão de crédito (fatura, fechamento/vencimento).
2. Orçamento por categoria com alerta.
3. Importação OFX/CSV.
4. Contas compartilhadas (casal/família).
5. Notificação de vencimento (Web Push).

## Validação por risco
- **Sync/offline**: testes automatizados de servidor (idempotência, tombstone, isolamento) + teste manual em modo avião.
- **Dinheiro/recorrência**: testes unitários dirigidos (dia 31, bissexto, parcelas).
- **Deploy/backup**: restauração real, não só "o cron rodou".

## Pendências conhecidas (fora do escopo da revisão independente)
- **GC de tombstones**: exclusões ficam como linhas `deleted_at` para sempre (limitadas pelo teto total de 4x a cota de linhas por usuário). Falta uma limpeza de tombstones antigos (cuidado com aparelhos que ficam muito tempo offline: precisam do tombstone para apagar a cópia local).
- **Detecção de conflito por `base_rev`**: hoje é "última escrita vence por documento" (ver `docs/02`); editar o mesmo item em dois aparelhos offline perde a edição que chegar primeiro.
- Cópia externa do backup depende de configurar o destino no `scripts/backup.sh` (rclone/scp); restauração real na VM ainda por fazer.

> Nota M2: bancos criados antes do M2 (M1) devem ser recriados; sem migração (nunca houve deploy).
> Nota M1: exige banco novo; o schema do M0 não é migrado (M0 nunca foi para produção).
