# Runbook de deploy — MyFinance

Produção: `https://<DOMINIO>`, numa VM Linux acessada por SSH (`<HOST_SSH>`).
Stack isolada de outros serviços da VM: compose próprio, rede própria, **nenhuma porta publicada no host**.

> Valores reais (domínio, host, usuário, caminhos, bucket, horários) ficam **fora do repositório** — o repo é público.
> Substitua os `<PLACEHOLDERS>` pelos valores do seu ambiente (guarde-os num gerenciador de senhas ou no `~/.ssh/config`).

| Placeholder | O que é |
|---|---|
| `<HOST_SSH>` | alias SSH da VM (definido em `~/.ssh/config`) |
| `<APP_DIR>` | pasta do app na VM; o código fica em `<APP_DIR>/src` |
| `<DOMINIO>` | domínio público do app |
| `<VOLUME_DADOS>` | volume Docker com o SQLite (`docker volume ls`) |

| Item | Valor |
|---|---|
| Containers | `financas-app` (Go + front estático, porta 8080 interna) e `financas-cloudflared` (túnel) |
| Código na VM | `<APP_DIR>/src` (**não é clone git**: é cópia do `main`) |
| Compose | `<APP_DIR>/src/deploy/docker-compose.yml` |
| Segredos | `<APP_DIR>/src/deploy/.env` (ver `.env.example`/README) — nunca versionar |
| Dados | volume `<VOLUME_DADOS>` montado em `/data` (`/data/financas.db`, SQLite) |
| Backup | cron diário → `<APP_DIR>/backups`, log em `<APP_DIR>/backup.log`, cópia externa em bucket S3 (credenciais em `<APP_DIR>/backup.env`) |
| Health | `GET /api/health` (healthcheck do container, 30s) |

## 1. Antes de subir

- PR mergeado no `main`; CI verde.
- Local, em `frontend/`: `npm test`, `npm run lint:css`, `npm run build` passam.
- Mudou schema? As migrações rodam sozinhas ao subir (`PRAGMA user_version`). Binário antigo **se recusa** a abrir banco mais novo, então rollback de código com migração exige restaurar backup (seção 5).

## 2. Deploy

Da sua máquina, na raiz do repo:

```bash
git fetch && git checkout main && git pull
ssh <HOST_SSH> 'docker tag financas:local financas:rollback || true'   # guarda a imagem atual (no 1º deploy ainda não existe: o || true evita erro)
git archive origin/main | ssh <HOST_SSH> 'tar -x -C <APP_DIR>/src'
ssh <HOST_SSH> 'cd <APP_DIR>/src/deploy && docker compose up -d --build financas'
```

Só o serviço `financas` é recriado; o `cloudflared` continua de pé. `.env` e o volume de dados não são tocados
(o `tar` só sobrescreve arquivos do repo; `.env` não está nele).

> Arquivo **removido** do repo não é apagado na VM pelo `tar`. Se isso importar (ex.: arquivo que entra no `COPY` do build), apague-o à mão.

## 3. Verificação

```bash
ssh <HOST_SSH> 'docker ps --format "{{.Names}} {{.Status}}" | grep financas'   # esperar (healthy) em ~50s
ssh <HOST_SSH> 'docker logs --tail 20 financas-app'                            # "ouvindo em 0.0.0.0:8080"
curl -s -o /dev/null -w "%{http_code}\n" https://<DOMINIO>/                    # 200
curl -s https://<DOMINIO>/ | grep -o 'assets/index-[^"]*'                      # hash do bundle mudou
```

Depois, abra o site, entre com o Google e confira a tela alterada. `(health: starting)` nos primeiros ~30s é normal.

## 4. Backup manual (antes de mudança arriscada)

```bash
ssh <HOST_SSH> 'set -a; . <APP_DIR>/backup.env; set +a; CONTAINER=financas-app BACKUP_DIR=<APP_DIR>/backups <APP_DIR>/src/scripts/backup.sh'
```

Termina com `enviado para s3://…` quando a cópia externa foi confirmada no bucket; qualquer `FALHA:` é erro real.

## 5. Rollback

**Só código** (sem migração nova):

```bash
ssh <HOST_SSH> 'docker tag financas:rollback financas:local && cd <APP_DIR>/src/deploy && docker compose up -d --no-build financas'
```

Isso funciona porque o compose usa `image: financas:local` junto de `build:` e o `--no-build` sobe a imagem já tagueada em vez de reconstruir. Lembre de também voltar os arquivos em `<APP_DIR>/src` (`git archive <commit-bom> | ssh … tar -x`), senão o próximo `--build` reaplica a versão ruim.

**Com migração de schema ou dado corrompido:** restaurar o backup mais recente.

1. `ssh <HOST_SSH> 'cd <APP_DIR>/src/deploy && docker compose stop financas'`
2. Escolha o arquivo em `<APP_DIR>/backups` (ou no bucket) e valide, na VM: `ssh <HOST_SSH> 'BACKUP_DIR=<APP_DIR>/backups <APP_DIR>/src/scripts/restore-test.sh'`.
3. Copie-o para `/data/financas.db` do volume, com o container parado (ex.: `docker run --rm -v <VOLUME_DADOS>:/data -v <APP_DIR>/backups:/b alpine sh -c 'rm -f /data/financas.db-wal /data/financas.db-shm && cp /b/<arquivo>.db /data/financas.db'`). O SQLite roda em modo WAL: sobras de `-wal`/`-shm` do banco antigo, se mantidas, seriam reaplicadas sobre o arquivo restaurado e o corromperiam — por isso o `rm -f`.
4. Faça o rollback de código e suba: `docker compose up -d --no-build financas`.

Dados feitos após o backup são perdidos; clientes offline reenviam o que tinham pendente ao reconectar.

## 6. Problemas comuns

| Sintoma | Causa provável | Ação |
|---|---|---|
| Site 502/1033 | `financas-cloudflared` caído ou `TUNNEL_TOKEN` errado | `docker logs financas-cloudflared`; `docker compose up -d cloudflared` |
| Login Google falha | `GOOGLE_CLIENT_ID`/`ALLOWED_ORIGINS` no `.env` não batem com o domínio | corrigir `.env` e recriar `financas` |
| Container reinicia | binário mais velho que o banco, ou `.env` ausente | `docker logs financas-app`; ver rollback com schema |
| Limite de requisições atinge todo mundo | `TRUSTED_PROXY` não cobre o IP do cloudflared | conferir a sub-rede da rede `internal` no compose |
| Build falha na VM | disco cheio / cache | `df -h`; `docker builder prune` (cuidado: a VM pode rodar outros serviços) |

## 7. Regras

- Nada de `docker system prune`/`down -v`: a VM é compartilhada e `-v` apaga o volume de dados.
- Mexa só em recursos com prefixo `financas-`.
- Nunca imprimir nem commitar o `.env`, tokens, chaves ou credenciais do bucket.
