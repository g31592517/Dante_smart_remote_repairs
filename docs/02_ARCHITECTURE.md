# 02 — Architecture

## 1. Shape of the system

```
 Browser (React PWA)            Future Android/iOS (React Native)
        │  HTTPS, JSON, Bearer JWT            │ same API, X-Client: mobile
        ▼                                     ▼
 ┌──────────────────────── nginx (TLS, static web, /api proxy) ───────────────────────┐
 │                       Express 5 API  /api/v1   (modular monolith)                   │
 │  auth · users/organisations · settings · support · remote (AnyDesk) · attachments  │
 │  repairs/quotations · catalogue · inventory · cart/orders · payments · notifications│
 │  reports · OpenAPI docs                                                             │
 └───────┬───────────────────────┬───────────────────────┬───────────────────────────┘
         ▼                       ▼                       ▼
     MySQL 8               Private file storage     External (optional): SMTP, AnyDesk REST,
  (single schema)          (uploads; public/ for     payment gateway, SMS/WhatsApp providers
                            catalogue images)
```

* **API-first.** The web app never touches the database; every feature goes through `/api/v1`. The same
  endpoints serve future mobile apps.
* **Modular monolith, not microservices.** One deployable unit; modules are separated by folder and only call each
  other's *services* (never each other's tables). Inventory changes in particular go only through
  `inventory.service.ts`.
* **Shared contract.** `packages/shared` holds request-validation schemas (zod), roles/permissions, the request state
  machine, status labels and money helpers. The API validates with the same schemas the web forms use.

### Module layout (API)

| Module | Responsibility |
|---|---|
| `core/` | config, errors and response envelope, authentication middleware, permission checks, audit, storage, references |
| `auth` | registration (individual/corporate), login with lockout, refresh-token rotation, password reset, invitations |
| `users`, `organizations` | profile, addresses, devices + repair history, organisation members, staff accounts and roles |
| `settings` | business settings, currency/tax, consent and legal texts, service categories, integration status |
| `support` | requests, access scoping, workflow transitions, timeline, messages, internal notes |
| `remote` | remote-session lifecycle, consent, AnyDesk URL handler, AnyDesk REST client |
| `repairs` | intake, diagnostics, work logs, quotations and revisions, parts, service reports, warranties, feedback |
| `catalog`, `inventory` | products, categories, images; stock, movements, reservations, suppliers, purchase orders |
| `orders`, `payments` | cart, checkout, fulfilment, expiry; offline/claimed/gateway payments, webhooks, refunds |
| `notifications` | in-app notifications, e-mail delivery with retry, SMS/WhatsApp extension points |
| `reports` | dashboard indicators, operational/financial/inventory reports, CSV export, audit log |

Inside a module: `*.routes.ts` (HTTP, validation, response) → `*.service.ts` (rules, transactions) → knex.

## 2. Roles and access

| Role | Can |
|---|---|
| Customer | own requests, devices, orders, payments; **org admin** additionally sees the whole organisation |
| Technician | only requests assigned to them; remote sessions; quotations; parts; reports; internal notes |
| Support manager | all requests; review, assign, statuses; quotations; customers/organisations; operational reports; monitors payments |
| Inventory manager | products, stock, suppliers, purchasing, order fulfilment, inventory reports — **no** support records |
| Finance officer | payments (record, verify, refund), financial reports — **no** stock changes or support records |
| Administrator | everything, including settings, staff accounts and the audit log |

Enforcement is server-side in three layers:
1. **Authentication**: a short-lived JWT (15 min) per request; roles and permissions are re-read from the database on
   every request, so revoking a role or deactivating a user takes effect immediately.
2. **Permissions** (`requirePermission(...)`) on staff endpoints.
3. **Record scoping**: `support.access.ts` restricts every request query by viewer type. A record the caller may not
   see is reported as **404**, not 403, so reference numbers cannot be probed. The customer view of a request is
   produced by one function (`support.detail.ts`) that strips internal notes, internal activities, internal
   attachments and private diagnostics/work logs.

## 3. Request lifecycle

Statuses: Submitted · Under review · Accepted · Assigned · Awaiting customer · Diagnosis in progress · Awaiting
quotation approval · Approved · Awaiting parts · Repair in progress · Testing & QC · Awaiting payment · Ready for
collection/delivery · Completed · Closed · Cancelled.

```
SUBMITTED → UNDER_REVIEW → ACCEPTED → ASSIGNED → DIAGNOSIS_IN_PROGRESS ─────────────► COMPLETED → CLOSED
                 │            ▲           │  ▲            │                               ▲
                 ▼            │           ▼  │            ▼                               │
          AWAITING_CUSTOMER ──┘     AWAITING_CUSTOMER   AWAITING_QUOTATION_APPROVAL ─► APPROVED
                                                             ▲                          │
                                                             │                          ▼
  (hardware / on-site only)                     REPAIR_IN_PROGRESS ◄──── AWAITING_PARTS
                                                      │      ▲
                                                      ▼      │
                                                  TESTING_QC ─► AWAITING_PAYMENT ─► READY_FOR_COLLECTION ─► COMPLETED
```

* The allowed transitions per **service type** live in `packages/shared/src/workflow.ts`. Remote support and
  consultations never enter workshop stages; on-site jobs have no "ready for collection".
* Some statuses are set only as side effects (assignment → *Assigned*; sending a quotation → *Awaiting quotation
  approval*; customer approval → *Approved*).
* Guards: **Completed** requires a final service report, no open remote session and a settled balance (a manager may
  override with a reason, which is audited). **Repair in progress** for hardware/on-site work requires an approved
  quotation, unless a manager records a reason (e.g. warranty work). Cancelling releases reserved parts.
* Every change writes `request_status_history` and a timeline entry, and notifies the customer if visible.

## 4. Remote support (AnyDesk)

```
REQUESTED ──customer gives AnyDesk ID + explicit consent──► AUTHORIZED ──technician clicks Connect──► INITIATED
    │                                                          │                                          │
    └──────────── customer may withdraw at any time ──► REVOKED ◄──────────────────────────────────────── │
                                                                                                           ▼
                                                         COMPLETED ◄── outcome recorded ── ACTIVE ◄── customer accepted
```

* The technician's **Connect using AnyDesk** button calls `POST /remote-sessions/:id/initiate`. The server checks the
  customer's consent (present and not revoked), records the initiation, and only then returns
  `anydesk:<id-or-alias>`, which the browser opens to launch the technician's AnyDesk client. The customer still has to
  accept the connection inside AnyDesk.
* Consent is stored in `customer_consents` with the exact text shown, its version, a timestamp, IP and user agent.
  Changing the consent text requires a new version.
* AnyDesk IDs are validated (9–10 digits or `alias@namespace`). Anything resembling a password is rejected, and the
  UI warns never to share passwords.
* Session evidence comes from the AnyDesk REST API when licensed, or from the technician's manual entry. See
  [05_ANYDESK_INTEGRATION.md](05_ANYDESK_INTEGRATION.md).

## 5. One inventory for the shop and the workshop

`inventory(product_id, quantity_on_hand, quantity_reserved)`; **available = on hand − reserved**.

| Event | on hand | reserved | Movement |
|---|---|---|---|
| Purchase order received / positive adjustment | + | | RECEIPT / ADJUSTMENT |
| Checkout (each order line) | | + | RESERVATION |
| Customer approves a quotation (each PART line) | | + | RESERVATION |
| Order dispatched / completed | − | − | SALE |
| Technician marks a part installed | − | − | REPAIR_CONSUMPTION |
| Order cancelled/expired, request cancelled, part dropped by a revision | | − | RESERVATION_RELEASE |

Rules that make this safe:
* All stock changes go through `inventory.service.ts` **inside a transaction**, lock the row with
  `SELECT … FOR UPDATE`, and write an `inventory_movements` row. A database `CHECK` keeps
  `0 ≤ reserved ≤ on_hand`.
* Order lines and repair parts carry a `stock_state` (NONE → RESERVED → CONSUMED, or RELEASED). Every transition is
  idempotent, so **stock is never deducted twice** (e.g. dispatched then completed, or "install" clicked twice).
* Checkout reserves every line in one transaction, locked in product order to avoid deadlocks. One short line rolls
  back the whole order. Two customers racing for the last unit cannot both succeed (tested).
* A revised quotation carries parts over from the superseded one rather than reserving again, and releases parts it
  no longer contains. Parts that are out of stock leave the job in *Awaiting parts*; receiving a purchase order
  notifies the technician, who allocates them.
* Unpaid online/transfer orders expire after `ORDER_PAYMENT_TIMEOUT_HOURS`, releasing their stock.

## 6. Money

All amounts are integer **minor units**; currency, decimals, tax rate (basis points, inclusive or exclusive) and
delivery fee are settings. Quotations and orders snapshot the tax rate in force when they were issued. Payments are
never marked successful by the browser: offline payments are recorded or verified by staff, and gateway payments
settle only through a **signature-verified, idempotent webhook** whose amount and currency must match.

## 7. Security summary

argon2id passwords · JWT access + rotating refresh tokens with reuse detection (an httpOnly SameSite=Strict cookie for
browsers, the response body for mobile) · account lockout and auth rate limiting · global API rate limit · Helmet
security headers · CORS allow-list · parameterised SQL only (knex) · zod validation on every input · uploads checked
by **content** (magic bytes) against an allow-list, stored privately and streamed only after an access check with
`nosniff` and a sandboxing CSP · CSV export neutralises spreadsheet formulas · secrets only in the server environment
(never in the web bundle) · audit log of sensitive operations · organisation-level data isolation.

## 8. Mobile readiness

* Business logic lives entirely in the API, not in React components.
* Token authentication works without cookies (`X-Client: mobile` returns the refresh token in the body).
* One response envelope: `{ data, meta? }` / `{ error: { code, message, details } }`.
* `@dante/shared` (schemas, enums, state machine, money) can be imported unchanged by a React Native app.
* No essential operation depends on browser-only features. Launching AnyDesk uses the OS URL handler, which mobile
  apps can open with `Linking.openURL('anydesk:…')`.
