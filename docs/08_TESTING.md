# 08 — Testing

## Test layers

| Layer | Tool | Where | What it proves |
|---|---|---|---|
| Unit | Vitest | `packages/shared/src/*.test.ts` | state machine per service type, AnyDesk ID validation & URL handler, money/tax maths, form schemas |
| API integration | Vitest + Supertest against a **real MySQL** database | `apps/api/tests/` | the seven acceptance workflows end to end through HTTP, with real SQL, transactions and row locks |
| Browser end-to-end | Playwright (Chromium) | `apps/web/e2e/` | the same journeys through the actual UI, role routing, mobile layout |
| Static | TypeScript strict | all packages | `npm run typecheck` |

## Running

```bash
# unit + API integration (needs the dante_test database from docs/04; rebuilt automatically on each run)
npm test

# browser journeys against a running stack
npm run db:reset -w @dante/api && npm run dev -w @dante/api          # API with demo data on :4000
npm run build -w @dante/web && npm run preview -w @dante/web          # web on :4173
npm run test:e2e -w @dante/web         # PW_CHROMIUM_PATH=/path/to/chrome to use an installed Chromium
```

The API's `CORS_ORIGINS` must include the preview origin (e.g. `http://127.0.0.1:4173`), and for repeated E2E runs
raise `AUTH_RATE_LIMIT` (each run signs in many times).

## Acceptance criteria → tests

| # | Criterion | API integration test | Browser test |
|---|---|---|---|
| 1 | Remote software support: register, e-mail problem, reference, technician, AnyDesk ID, authorise, completion report | `acceptance-1-remote-support` — full journey incl. confirmation e-mail, consent stored with text and time, `anydesk:123456789` returned only after consent, manual session evidence, report required before completion, audit trail; withdrawal blocks connection; no session before acceptance | `Test 1 (UI)` — three roles in three browsers, including a reload that restores the session from the httpOnly cookie |
| 2 | Hardware repair: diagnose, quote, approve, parts, repair, report | `acceptance-2-4` — intake with acknowledgment, diagnosis, quotation 104.00, approval by customer only, repair blocked before approval, parts, testing, report with warranty, payment gate on completion, device history | — |
| 3 | IT product purchase with correct stock | `acceptance-3-store-purchase` — server-side prices, reservation at checkout, transfer claim verified by finance, consumption on dispatch exactly once, tracking history; all-or-nothing checkout; **two concurrent buyers for the last unit → one 201, one 409**; release on cancel and expiry; gateway webhook verified/idempotent/amount-checked; real Stripe signature check | `Test 3 (UI)` |
| 4 | Repair ↔ inventory integration | `acceptance-2-4` — availability lookup, reservation on approval, consumption on install, double-install refused, revised quotation carries parts over (2 reserved, not 3) and releases removed ones, awaiting-parts → PO receipt → notification → allocation, release on cancellation, declined quotation reserves nothing | — |
| 5 | Corporate account | `acceptance-5-corporate` — org admin invites employees (one-time links), shared devices, members see own requests, org admin sees all, outsiders see nothing (404), staff see org stats, last admin protected, deactivation immediate | — |
| 6 | Access control | `acceptance-6-access-control` — cross-customer isolation (requests, messages, attachments, orders, payments → 404), internal notes/diagnostics/files hidden from customers, technicians limited to own jobs and no admin functions, store/finance confined, deactivation kills existing tokens, refresh rotation + reuse detection, cookie flags + origin check, lockout + rate limit, uploads checked by content | `Test 6 (UI)` — customers redirected out of `/staff`; staff menus follow permissions |
| 7 | Feedback & reporting | `acceptance-7-feedback-reporting` — feedback only after completion and once, by the customer only; satisfaction, technician performance, response times, category report, CSV export, role-specific dashboards, low-rating alert; CSV formula neutralisation | — |
| — | AnyDesk REST | `anydesk-integration` — signer equals values computed independently with Python `hmac`/`hashlib`; client against a mock that verifies signatures; sync marks ACTIVE and records API evidence; comment written; remote close on revocation; manual fallback | — |
| — | Responsive | — | no horizontal scrolling at 375 px on home, shop, support, login, register |

## Latest results (2026-11-03)

```
packages/shared   Test Files 1 passed   Tests 10 passed
apps/api          Test Files 7 passed   Tests 33 passed   (~22 s, MySQL 8.0.46)
apps/web e2e      4 passed (Chromium, desktop + 375 px)
typecheck         shared, api, web — no errors
build             api bundle + web PWA (38 precached entries) — success
backup/restore    round trip into a scratch database — row counts identical
```

## Defects found by testing and fixed

| Defect | Found by | Fix |
|---|---|---|
| Refresh-token **reuse detection did not stick**: the family revocation was rolled back by the error thrown in the same transaction | access-control test | revocation committed first, the rejection is raised afterwards |
| JSON settings parsed twice (mysql2 already decodes JSON columns) — registration failed | acceptance 1 | settings values used as returned by the driver |
| `DATE` columns returned as JS `Date`, breaking quotation-expiry checks | expiry test | DATE columns returned as `YYYY-MM-DD` strings |
| Managers could not cancel jobs after approval | acceptance 2/4 | cancellation allowed from all open states for staff (reserved parts released) |
| An expiry write was silently rolled back by the error that followed it | code review during testing | write removed, expiry derived from `valid_until` |
| Field validation messages not shown on controls without a visible label (e.g. AnyDesk ID) | browser test 1 | errors rendered for all form controls |
| Session restore refused when the web app was served from an origin missing in `CORS_ORIGINS` | browser screenshots | documented as a required setting, example updated |
| Auth rate limit not configurable for test environments | browser test re-runs | `AUTH_RATE_LIMIT` / `API_RATE_LIMIT` settings |

Note on the AnyDesk launch in automated tests: headless Chromium stops sending input to a tab that has a pending
external-protocol prompt (a real browser shows "Open AnyDesk?"), so the E2E test continues the technician's steps in
a fresh tab. The page also provides a plain `anydesk:` link as a fallback for browsers that block the automatic launch.

## Not covered by automated tests

* Real AnyDesk REST calls and a real gateway charge: these need the business's credentials (see docs 05 and 06 for
  the verification steps). The adapters are tested against a signature-verifying mock and Stripe's official
  signature helper.
* SMTP delivery to a real mailbox (the `log` transport is used in tests; retries are exercised through the delivery
  table).
* Formal accessibility audit with assistive technology. The UI uses semantic landmarks, labelled controls, native
  `<dialog>`, focus outlines and ARIA live regions, but has not been audited with a screen reader.
* Load and performance testing.
