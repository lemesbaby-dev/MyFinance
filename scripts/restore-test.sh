#!/usr/bin/env bash
# Prova que um backup RESTAURA: copia para um arquivo temporário, roda integrity_check e conta linhas.
# Uso: scripts/restore-test.sh [arquivo-de-backup]     (sem argumento: o mais recente de BACKUP_DIR)
# Rode de vez em quando (ex.: mensal). Backup que nunca foi restaurado é só esperança.
set -euo pipefail

OUT="${BACKUP_DIR:-/var/backups/financas}"
src="${1:-$(ls -1t "$OUT"/financas-*.db 2>/dev/null | head -n1 || true)}"
[ -n "$src" ] && [ -f "$src" ] || { echo "nenhum backup encontrado (BACKUP_DIR=$OUT)" >&2; exit 1; }
if ! command -v sqlite3 >/dev/null 2>&1; then   # sem sqlite3 no host: usa o da imagem do app
  sqlite3() { docker run --rm -i --user "$(id -u)" --entrypoint sqlite3 -v "$tmp:$tmp" "${IMAGE:-financas:local}" "$@"; }
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp "$src" "$tmp/restore.db"
[ -f "$src-wal" ] && cp "$src-wal" "$tmp/restore.db-wal"

check="$(sqlite3 "$tmp/restore.db" 'PRAGMA integrity_check;')"
if [ "$check" != "ok" ]; then
  echo "FALHOU integrity_check em $src: $check" >&2
  exit 1
fi
q() { sqlite3 "$tmp/restore.db" "$1"; }
echo "restore ok: $src"
echo "  schema (user_version): $(q 'PRAGMA user_version;')"
echo "  users:                 $(q 'SELECT COUNT(*) FROM users;')"
echo "  entities (vivas):      $(q 'SELECT COUNT(*) FROM entities WHERE deleted_at IS NULL;')"
echo "  entities (total):      $(q 'SELECT COUNT(*) FROM entities;')"
echo "  sessions:              $(q 'SELECT COUNT(*) FROM sessions;')"
echo "  sync_ops:              $(q 'SELECT COUNT(*) FROM sync_ops;')"
