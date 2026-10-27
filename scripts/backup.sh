#!/usr/bin/env bash
# Backup do SQLite com o app rodando (modo WAL). Uso: scripts/backup.sh   (cron diário, ver abaixo)
#   DB_PATH      banco de produção          (padrão /var/lib/financas/financas.db)
#   BACKUP_DIR   onde guardar as cópias     (padrão /var/backups/financas)
#   KEEP_DAYS    rotação: apaga cópias mais velhas que N dias (padrão 14)
#
# Cron (diário às 03:15):   15 3 * * *  /opt/financas/scripts/backup.sh >> /var/log/financas-backup.log 2>&1
#
# Cópia para FORA da VM (backup na mesma máquina não protege de perder a máquina). Escolha uma:
#   rclone copy "$BACKUP_DIR" b2:meu-bucket/financas --max-age 48h          # S3/B2/Drive (rclone config antes)
#   scp -q "$dest" backup@outra-maquina:/srv/backups/financas/              # ou rsync -a "$BACKUP_DIR"/ host:/dir/
# Descomente o bloco "envio" no fim deste script depois de configurar o destino.
set -euo pipefail

DB="${DB_PATH:-/var/lib/financas/financas.db}"
OUT="${BACKUP_DIR:-/var/backups/financas}"
KEEP_DAYS="${KEEP_DAYS:-14}"

CONTAINER="${CONTAINER:-}"   # se definido, o banco está dentro desse container Docker (/data/financas.db)
[ -n "$CONTAINER" ] || [ -f "$DB" ] || { echo "banco não encontrado: $DB" >&2; exit 1; }
umask 077
mkdir -p "$OUT"
dest="$OUT/financas-$(date -u +%Y%m%dT%H%M%SZ).db"

if [ -n "$CONTAINER" ]; then
  docker exec "$CONTAINER" sh -c 'rm -f /tmp/b.db && sqlite3 /data/financas.db ".backup /tmp/b.db" && [ "$(sqlite3 /tmp/b.db "PRAGMA integrity_check;")" = ok ]' \
    || { echo "backup falhou/corrompido" >&2; exit 1; }
  docker cp "$CONTAINER:/tmp/b.db" "$dest" && docker exec "$CONTAINER" rm -f /tmp/b.db
elif command -v sqlite3 >/dev/null 2>&1; then
  # .backup usa a API de backup do SQLite: cópia consistente mesmo com escritas em andamento.
  sqlite3 "$DB" ".backup '$dest'"
  [ "$(sqlite3 "$dest" 'PRAGMA integrity_check;')" = "ok" ] || { echo "backup corrompido: $dest" >&2; rm -f "$dest"; exit 1; }
else
  # Sem sqlite3: copia o -wal PRIMEIRO e o .db depois (o WAL só cresce; um .db mais novo que o WAL
  # copiado não perde nada já confirmado) e guarda os dois juntos; o SQLite reaplica o -wal ao abrir.
  # É melhor-esforço: instale o sqlite3 (apt install sqlite3) para ter cópia garantidamente consistente.
  echo "AVISO: sqlite3 não encontrado; usando cópia de db+wal (melhor-esforço)" >&2
  [ -f "$DB-wal" ] && cp "$DB-wal" "$dest-wal"
  cp "$DB" "$dest"
fi
echo "backup ok: $dest ($(wc -c <"$dest") bytes)"

# Rotação
find "$OUT" -maxdepth 1 -name 'financas-*.db*' -type f -mtime +"$KEEP_DAYS" -delete

# --- envio para fora da VM: S3 (ex.: Contabo Object Storage) via rclone em container ---
# Defina S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY no ambiente do cron. Sem S3_BUCKET, só guarda local.
if [ -n "${S3_BUCKET:-}" ]; then
  docker run --rm -v "$OUT:/b:ro" \
    -e RCLONE_CONFIG_S3_TYPE=s3 -e RCLONE_CONFIG_S3_PROVIDER=Other -e RCLONE_CONFIG_S3_ENDPOINT="$S3_ENDPOINT" \
    -e RCLONE_CONFIG_S3_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" -e RCLONE_CONFIG_S3_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
    rclone/rclone:1.69 copy /b "S3:$S3_BUCKET/financas" --max-age 48h --include 'financas-*.db'
  echo "enviado para s3://$S3_BUCKET/financas"
fi
# --- alternativas (descomente um) ---
# rclone copy "$OUT" b2:meu-bucket/financas --max-age 48h
# scp -q "$dest" backup@outra-maquina:/srv/backups/financas/
