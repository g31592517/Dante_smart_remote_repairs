#!/usr/bin/env bash
# Consistent online backup of the platform database + private uploads.
#   Usage: deploy/backup-mysql.sh /var/backups/dante
# Reads DB_* and STORAGE_DIR from the environment (e.g. `set -a; . apps/api/.env; set +a`).
# Keeps the last $KEEP_DAYS days. Schedule daily with cron or a systemd timer.
set -euo pipefail
DEST="${1:?destination directory required}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DEST"

# --single-transaction: consistent InnoDB snapshot without locking the application out
MYSQL_PWD="${DB_PASSWORD:?}" mysqldump --single-transaction --routines --triggers --no-tablespaces \
  -h "${DB_HOST:-127.0.0.1}" -P "${DB_PORT:-3306}" -u "${DB_USER:?}" "${DB_NAME:?}" \
  | gzip -9 > "$DEST/db-$STAMP.sql.gz"

# uploads (attachments, intake photos, product images)
if [ -d "${STORAGE_DIR:-./storage}" ]; then
  tar -czf "$DEST/storage-$STAMP.tar.gz" -C "$(dirname "${STORAGE_DIR:-./storage}")" "$(basename "${STORAGE_DIR:-./storage}")"
fi

gzip -t "$DEST/db-$STAMP.sql.gz"
find "$DEST" -name 'db-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
find "$DEST" -name 'storage-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
echo "Backup written: $DEST/db-$STAMP.sql.gz"
