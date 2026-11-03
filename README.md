# Dante Smart Remote Repairs

An integrated **IT support, remote assistance, hardware repair and IT e-commerce platform**: one system in which
customers report ICT problems, authorise AnyDesk remote sessions, approve repair quotations, follow repairs and buy IT
products, and in which the business runs its service desk, technicians, workshop, shared inventory, store, payments and
reporting.

| | |
|---|---|
| **Web** | React 19 · TypeScript · Tailwind CSS 4 · Vite · PWA (installable) |
| **API** | Node.js 22 · TypeScript · Express 5 · REST `/api/v1` · OpenAPI 3 at `/api/docs` |
| **Database** | MySQL 8 · 51 tables · knex migrations & seeds |
| **Shared** | `@dante/shared`: zod schemas, roles/permissions, request state machine, money helpers — reused by web and a future React Native app |
| **Tests** | 33 API integration tests on real MySQL (acceptance workflows 1–7) · 10 unit tests · 4 Playwright browser journeys |

Why Node.js rather than ASP.NET Core: see [docs/01_ARCHITECTURE_DECISION.md](docs/01_ARCHITECTURE_DECISION.md).

## Quick start (development)

Requirements: Node.js ≥ 20.11 (22 recommended), MySQL 8.

```bash
npm install
# database + user (adjust the password)
mysql -uroot -e "CREATE DATABASE dante_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
  CREATE USER 'dante'@'localhost' IDENTIFIED BY 'change-me'; GRANT ALL ON dante_dev.* TO 'dante'@'localhost';"
cp apps/api/.env.example apps/api/.env      # set DB_PASSWORD and JWT_SECRET
npm run db:migrate
npm run db:seed                              # reference data + demo data (development only)
npm run dev:api                              # http://localhost:4000  (docs: /api/docs)
npm run dev:web                              # http://localhost:5173  (proxies /api to :4000)
```

Demo accounts (development seed only), password **`DemoPass123!`**:

| Role | E-mail |
|---|---|
| Administrator | admin@dante.local |
| Support manager | manager@dante.local |
| Technicians | tech1@dante.local, tech2@dante.local |
| Inventory / store manager | store@dante.local |
| Finance officer | finance@dante.local |
| Individual customer | jane@example.com |
| Corporate customer (org admin / member) | it.lead@acme.example / staff@acme.example |

## Repository layout

```
apps/api            Express API — src/modules/<domain>/{*.routes,*.service}.ts, src/db (migrations, seeds), tests/
apps/web            React app — src/features/<area>/, src/components, src/lib (API client, auth), e2e/
packages/shared     Contract shared by API, web and future mobile clients
deploy/             nginx, systemd, backup & restore scripts
docs/               Architecture, database, setup, integrations, deployment, testing, OpenAPI
```

## Documentation

| Document | Contents |
|---|---|
| [01 Architecture decision](docs/01_ARCHITECTURE_DECISION.md) | Express vs ASP.NET Core evaluation and choice |
| [02 Architecture](docs/02_ARCHITECTURE.md) | Modules, workflows, state machines, inventory model, security, mobile readiness |
| [03 Database](docs/03_DATABASE.md) | Schema by module, constraints, transactions |
| [04 Setup](docs/04_SETUP.md) | Installation, configuration, scripts |
| [05 AnyDesk integration](docs/05_ANYDESK_INTEGRATION.md) | URL handler, REST API findings, licensing, manual fallback, consent |
| [06 Integrations](docs/06_INTEGRATIONS.md) | E-mail, SMS/WhatsApp, payment gateways, currency & tax |
| [07 Deployment](docs/07_DEPLOYMENT.md) | Production build, HTTPS, systemd, backups & recovery, checklist |
| [08 Testing](docs/08_TESTING.md) | How to run the tests, acceptance mapping, results |
| [09 Roadmap & limitations](docs/09_ROADMAP.md) | Phase status, known limitations, next steps |
| [openapi.json](docs/openapi.json) | Static OpenAPI 3 document (live at `/api/docs`) |

## Scripts

| Command | Purpose |
|---|---|
| `npm run typecheck` | Type-check all packages |
| `npm test` | Shared unit tests + API integration tests (needs MySQL test DB, see docs/08) |
| `npm run build` | Production bundles: `apps/api/dist`, `apps/web/dist` |
| `npm run db:migrate` / `db:rollback` / `db:seed` | Database management (`db:reset -w @dante/api` rebuilds dev data) |
| `npm run openapi -w @dante/api` | Regenerate `docs/openapi.json` |
| `npm run test:e2e -w @dante/web` | Playwright browser journeys against a running stack |
