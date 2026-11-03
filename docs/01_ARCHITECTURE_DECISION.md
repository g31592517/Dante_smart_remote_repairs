# ADR-001 — Backend platform selection

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-03 |
| **Decision** | **Node.js 22 + TypeScript + Express 5**, MySQL 8 via `knex` + `mysql2`, validation with `zod` schemas shared between server, web client and a future React Native client |
| **Rejected** | ASP.NET Core 8/9 (viable; reasons below) · microservices (not needed at this scale) |

## 1. What the backend has to do

The requirements that actually discriminate between the candidates are:

1. **One integrated domain**: support desk + remote support + repair workshop + store + inventory + payments,
   with cross-module transactions (a repair quotation reserves stock that the shop also sells).
2. **Strong relational integrity** on MySQL: row locks for stock reservation, unique references,
   idempotent payment callbacks, audit trails.
3. **API-first** for a React web client now and **Android/iOS later** without a backend rewrite.
4. **Small team, fast iteration**, maintainable by developers who will also own the React frontend.
5. **Integrations**: AnyDesk REST (HMAC-signed HTTP), SMTP, a payment gateway still to be chosen, optional SMS/WhatsApp.
6. **Deployment** on modest infrastructure (a single VPS or a container host) with MySQL alongside.

## 2. Evaluation

Scored 1 (weak) – 5 (strong) for **this** project, not in general.

| Criterion | Node.js + TS + Express | ASP.NET Core | Notes |
|---|---|---|---|
| Development speed | **5** | 4 | Same language as the React app. One set of validation schemas (`zod`) drives server validation, client forms and API docs. In .NET the DTOs and validators would be written twice: C# for the server, TypeScript for the client. |
| Front/back language consistency | **5** | 2 | TypeScript end to end. A future **React Native** app can import the same `@dante/shared` package (enums, status machine, schemas, API types). A C# backend cannot share code with RN. |
| Maintainability | 4 | **5** | .NET's DI, project structure and compiler are stronger out of the box. We close most of the gap with strict TypeScript, a fixed module layout (`routes → service → repository`), ESLint and integration tests. |
| Performance | 4 | **5** | Kestrel is faster on CPU-bound work. This workload is I/O-bound (MySQL, file uploads, HTTP integrations) at SME traffic levels; Node's event loop is not the bottleneck. |
| Built-in security | 3 | **5** | ASP.NET Identity, data protection and antiforgery are built in. On Node we assemble well-maintained pieces: `argon2`, `helmet`, `express-rate-limit`, JWT, parameterised queries via knex. More wiring, but each piece is standard and is tested in this repo. |
| MySQL integration | 4 | 4 | `mysql2` + `knex` (migrations, seeds, transactions, `SELECT … FOR UPDATE`) vs EF Core + Pomelo (the MySQL provider is community-maintained). Equivalent for our needs. |
| Library ecosystem for our integrations | **5** | 4 | Nodemailer, Stripe/Flutterwave/M-Pesa SDKs, AnyDesk signing (HMAC-SHA1, trivial in both). Payment providers in emerging markets typically ship Node examples first. |
| Mobile compatibility | **5** | 4 | Both expose REST + bearer tokens. Node wins on shared code with RN (row 2). |
| Deployment | 4 | 4 | Both ship as one container or one systemd service behind a reverse proxy. |
| Team capability | **5** | 3 | The frontend must be React + TypeScript (fixed requirement). One language lets one developer work across the whole stack. A second language means either two specialists or a slower generalist. |
| **Total** | **44** | 40 | |

## 3. Decision

**Node.js + TypeScript + Express**, organised as a **modular monolith**:

```
apps/api       Express 5 REST API (/api/v1), knex migrations + seeds, module-per-domain
apps/web       React 19 + TypeScript + Tailwind 4 + Vite, feature folders, PWA
packages/shared  zod schemas, enums, permission codes, request state machine, money helpers
```

The deciding factors were rows 1, 2 and 10: the frontend and the future mobile app are TypeScript, and one
validated contract shared by all three clients removes a whole class of drift bugs. ASP.NET Core's real
advantages (raw throughput, built-in identity) do not change the outcome at this platform's scale. The
security gap is closed by explicit, tested middleware.

## 4. Consequences and the guard-rails we commit to

- **Strict TypeScript** (`strict: true`) in every package; no `any` in service signatures.
- **Layering per module**: `*.routes.ts` (HTTP + validation) → `*.service.ts` (business rules, transactions)
  → knex queries. Controllers never touch another module's tables directly. Cross-module calls go through
  that module's service (e.g. repairs → `inventoryService.reserve`).
- **All writes that span tables run in one DB transaction.** Stock changes always lock the inventory row
  (`FOR UPDATE`) and record an `inventory_movements` row.
- **Security middleware is tested**: auth, permission checks, organisation scoping and rate limiting all have
  integration tests (`apps/api/tests`).
- **No microservices.** Modules can be extracted later along their service boundaries if load demands it.
- **Revisit trigger**: if the business needs heavy CPU-bound processing (for example large report
  generation or image processing at volume), move that one job to a worker process (Node or .NET). The API
  itself stays as it is.

## 5. Environment facts recorded during discovery

- The repository was **empty** at start (no existing code to preserve).
- Available here: Node 22.23, npm 10.9, MySQL 8.0.46 (installed from Ubuntu packages), Chromium for E2E.
- **.NET SDK was not installed, and its download hosts are blocked by this build environment's network
  policy.** That would have made ASP.NET Core impossible to build and test *here*, so it is recorded. It was
  **not** the reason for the decision: the scoring in §2 favours Node on project grounds alone.

## 6. Supporting library choices

| Concern | Choice | Why |
|---|---|---|
| HTTP | Express 5 | async error propagation built in; minimal |
| DB access | knex + mysql2 | migrations/seeds CLI, transactions, row locks, parameterised SQL (no string concatenation) |
| Validation & API contract | zod (shared) → OpenAPI 3 via `@asteasolutions/zod-to-openapi` | one schema, three uses |
| Passwords | argon2id | current OWASP recommendation |
| Auth tokens | short-lived JWT access token (bearer) + rotating opaque refresh token (hashed in DB) | works for web and native mobile alike |
| Uploads | multer (memory, size-capped) + magic-byte sniffing (`file-type`) + private storage | no executable/HTML uploads, no public bucket |
| Email | nodemailer (SMTP) with a `log` transport for development | core workflow never depends on it |
| Tests | Vitest + Supertest against a real MySQL test database; Playwright for UI smoke | real SQL, real transactions |
| Web | React 19, React Router, TanStack Query, react-hook-form + zod resolver, Tailwind 4, vite-plugin-pwa | |
