# 07 — Deployment

## Development

See [04_SETUP.md](04_SETUP.md): `npm run dev:api` + `npm run dev:web` (Vite proxies `/api` and `/media` to the API).

## Production (single server: nginx + Node.js + MySQL)

This is the reference deployment the code was built and tested for. It serves the web app and the API from **one
HTTPS origin**, which keeps the refresh cookie first-party and avoids CORS in the browser.

### 1. Build

```bash
git clone <repository> /srv/dante && cd /srv/dante
npm ci
npm run build          # → apps/api/dist (bundled server + db-cli), apps/web/dist (static PWA)
```

If the web app and API are served from different origins, build the web app with
`VITE_API_URL=https://api.example.com/api/v1` and add the web origin to the API's `CORS_ORIGINS`.

### 2. Configure

`/srv/dante/apps/api/.env` (`chmod 600`, owned by the service user):

```bash
NODE_ENV=production
PORT=4000
APP_URL=https://example.com
API_URL=https://example.com
CORS_ORIGINS=https://example.com
COOKIE_SECURE=true                  # required in production (startup refuses otherwise)
JWT_SECRET=<64+ random characters>  # startup refuses the placeholder
DB_HOST=127.0.0.1  DB_USER=dante  DB_PASSWORD=…  DB_NAME=dante
STORAGE_DIR=/srv/dante/apps/api/storage
EMAIL_TRANSPORT=smtp  SMTP_HOST=…  SMTP_USER=…  SMTP_PASSWORD=…  EMAIL_FROM=…
# optional: ANYDESK_*, PAYMENT_GATEWAY/STRIPE_* (docs/05, docs/06)
```

### 3. Database

```bash
cd /srv/dante/apps/api
node --env-file=.env dist/db-cli.js migrate
node --env-file=.env dist/db-cli.js seed            # reference data only in production
```

<a id="first-administrator"></a>**First administrator:**

```bash
node --env-file=.env dist/db-cli.js create-admin owner@example.com Olivia Owner
# prints a one-time password; the admin must change it at first sign-in
```

Then create other staff from Admin → Staff accounts (they receive invitation e-mails).

### 4. Run the API

`deploy/dante-api.service` runs migrations on start (`ExecStartPre`), restarts on failure and limits file-system
access to the storage directory:

```bash
sudo useradd --system --home /srv/dante dante && sudo chown -R dante: /srv/dante/apps/api/storage
sudo cp deploy/dante-api.service /etc/systemd/system/ && sudo systemctl enable --now dante-api
journalctl -u dante-api -f          # JSON logs (pino); secrets and tokens are redacted
```

### 5. nginx + HTTPS

`deploy/nginx.conf` terminates TLS, adds HSTS and security headers, serves `apps/web/dist` (with immutable caching of
hashed assets and `no-cache` for the service worker), and proxies `/api/` and `/media/` to the API. Obtain
certificates with certbot. The API trusts one proxy hop (`trust proxy = 1`) for client IPs used in rate limiting and
the audit log.

### 6. Background jobs

Run in-process by the API: e-mail delivery retries (every minute) and expiry of unpaid orders (every 15 minutes). If
you run **several API instances**, these are safe to run concurrently (row locks and idempotent updates). For heavy
scale, move them to a single dedicated instance.

## Backups and recovery

* `deploy/backup-mysql.sh <dir>` makes a consistent online dump (`mysqldump --single-transaction`) plus a tarball of
  `STORAGE_DIR` (uploads), checks the archive, and prunes copies older than `KEEP_DAYS` (default 14). The round trip
  (backup → restore into a scratch database → row counts match) was tested.
* Schedule it daily, e.g. `0 2 * * * cd /srv/dante/apps/api && set -a && . ./.env && set +a && /srv/dante/deploy/backup-mysql.sh /var/backups/dante`,
  and copy the backup directory **off the server** (object storage or another host).
* Restore: `deploy/restore-mysql.sh <db-dump.sql.gz> [<storage.tar.gz>]` (asks for confirmation), then run
  `db-cli.js migrate` if the backup predates the current release.
* For point-in-time recovery, also enable MySQL binary logs (`binlog_expire_logs_seconds`) and keep them with the dumps.
* Test a restore regularly. An untested backup is not a backup.

## Production checklist

- [ ] HTTPS only; `COOKIE_SECURE=true`; strong `JWT_SECRET`; `.env` readable only by the service user
- [ ] MySQL user limited to the application database; MySQL not exposed to the internet
- [ ] `STORAGE_DIR` outside the web root; included in backups
- [ ] SMTP configured and tested (Settings → Integrations shows no failed deliveries)
- [ ] Currency, tax, payment methods and instructions set for the operating market
- [ ] Terms of service, privacy notice, handover terms and remote consent text replaced with the business's own wording
- [ ] First administrator created, demo data **not** loaded (`seed --demo` is refused in production)
- [ ] Daily off-site backups scheduled and a restore tested
- [ ] Optional integrations (AnyDesk API, payment gateway) tested with real credentials (see docs 05/06)
