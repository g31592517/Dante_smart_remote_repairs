#!/usr/bin/env bash
# Restore a backup made by backup-mysql.sh into the configured database (DESTRUCTIVE).
#   Usage: deploy/restore-mysql.sh /var/backups/dante/db-<stamp>.sql.gz [/var/backups/dante/storage-<stamp>.tar.gz]
set -euo pipefail
DUMP="${1:?path to db-*.sql.gz required}"
read -r -p "This replaces all data in database '${DB_NAME:?}'. Type the database name to continue: " CONFIRM
[ "$CONFIRM" = "$DB_NAME" ] || { echo "Aborted"; exit 1; }
gunzip -c "$DUMP" | MYSQL_PWD="${DB_PASSWORD:?}" mysql -h "${DB_HOST:-127.0.0.1}" -P "${DB_PORT:-3306}" -u "${DB_USER:?}" "$DB_NAME"
if [ -n "${2:-}" ]; then
  tar -xzf "$2" -C "$(dirname "${STORAGE_DIR:-./storage}")"
fi
echo "Restore complete. Run 'npm run db:migrate -w @dante/api' if the backup predates the current release."
