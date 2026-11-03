# 04 — Installation & setup

## Prerequisites

* Node.js **20.11+** (22 LTS recommended) and npm 10
* MySQL **8.0** (InnoDB, `utf8mb4`)
* For e-mail in production: an SMTP account

## 1. Install

```bash
git clone <repository> dante && cd dante
npm install          # installs all workspaces (packages/shared, apps/api, apps/web)
```

## 2. Database

```sql
CREATE DATABASE dante_dev  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE dante_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;   -- for the test suite
CREATE USER 'dante'@'localhost' IDENTIFIED BY 'a-strong-password';
GRANT ALL ON dante_dev.*  TO 'dante'@'localhost';
GRANT ALL ON dante_test.* TO 'dante'@'localhost';
```

## 3. Configure the API

```bash
cp apps/api/.env.example apps/api/.env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # → JWT_SECRET
```

Minimum to set: `DB_PASSWORD`, `JWT_SECRET`. All variables are validated at start-up, so a missing or invalid value
stops the server with a clear message. Key variables:

| Variable | Meaning |
|---|---|
| `APP_URL`, `API_URL` | public URLs (used in e-mail links and payment redirects) |
| `CORS_ORIGINS` | every origin the web app is served from (comma-separated). Also used to check cookie-based session refresh |
| `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS`, `COOKIE_SECURE` | session lifetime; `COOKIE_SECURE=true` behind HTTPS (required in production) |
| `AUTH_RATE_LIMIT`, `API_RATE_LIMIT` | per-IP limits (auth attempts per 15 min, requests per minute) |
| `STORAGE_DIR`, `MAX_UPLOAD_MB` | upload storage (keep outside any web root) |
| `EMAIL_TRANSPORT`, `SMTP_*`, `EMAIL_FROM` | `log` prints e-mails to the console (development); `smtp` sends |
| `ANYDESK_*` | optional AnyDesk REST API (see doc 05) |
| `PAYMENT_GATEWAY`, `STRIPE_*` | optional online payments (see doc 06) |
| `ORDER_PAYMENT_TIMEOUT_HOURS` | unpaid orders are cancelled and their stock released after this |

## 4. Create the schema and seed

```bash
npm run db:migrate        # create/upgrade tables
npm run db:seed           # roles, permissions, categories, default settings (+ demo data in development)
# npm run db:reset -w @dante/api   rebuilds everything with demo data (refused in production)
```

In production `db:seed` loads **only** reference data (idempotent, safe on every deploy). Create the first
administrator with the `create-admin` snippet in [07_DEPLOYMENT.md](07_DEPLOYMENT.md#first-administrator).

## 5. Run (development)

```bash
npm run dev:api      # http://localhost:4000 — API docs at http://localhost:4000/api/docs
npm run dev:web      # http://localhost:5173 — proxies /api and /media to :4000
```

Sign in with the demo accounts listed in the README.

## 6. First-time business configuration

Sign in as an administrator → **Settings**:
1. Business name, contact details, support hours.
2. **Currency, decimals, tax rate/label, inclusive or exclusive tax, delivery fee** for your market (defaults are
   neutral: USD, 0 % tax).
3. Payment methods offered and the bank-transfer / mobile-money instructions.
4. AnyDesk download URL (defaults to `https://anydesk.com/en/downloads`) and the remote-access consent text.
5. Replace the placeholder terms of service, privacy notice and device-handover terms with your own.
6. Review the support categories.
Then create staff accounts (Staff accounts → Add staff member); each receives an invitation e-mail.
