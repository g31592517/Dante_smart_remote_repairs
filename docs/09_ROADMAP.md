# 09 — Phase status, limitations and next steps

## Delivery against the implementation phases

| Phase | Scope | Status |
|---|---|---|
| 1. Discovery & architecture | environment inspection, Express vs ASP.NET Core evaluation, architecture, schema, workflows | ✅ docs 01–03 |
| 2. Core platform | auth, RBAC, personal & corporate accounts, dashboard, support requests, review/assignment, tracking, notifications, AnyDesk URL handler, manual session recording | ✅ |
| 3. Hardware repair | intake, diagnostics, assignments, quotations & revisions, approval, parts, progress, final reports, warranties, feedback | ✅ |
| 4. Marketplace & inventory | catalogue, categories, product management, stock control, cart, checkout, orders, payments, repair-stock integration, suppliers & purchasing | ✅ |
| 5. Advanced integration & QA | AnyDesk REST client (tested against a mock), e-mail, reports + CSV, audit trail, PWA, responsive checks, security tests | ✅ code complete. Real AnyDesk/gateway credentials still needed for live verification |

## Known limitations (honest list)

* **AnyDesk REST API** is implemented and tested against a signature-verifying mock, but not yet against AnyDesk's
  servers (no licence credentials were available). Follow the checklist in doc 05 when credentials are issued.
* **Payment gateway**: the gateway port is provider-neutral; the included adapter is Stripe. If the business uses a
  local mobile-money/card provider, an adapter must be written for it (≈ one file, see doc 06). Offline methods work
  today.
* **SMS/WhatsApp** are extension points only; no provider is wired.
* **Tax** is a single configurable rate (inclusive or exclusive). Multiple rates per product category, invoices with
  legal numbering, and e-invoicing requirements depend on the operating market and are not implemented.
* **Notifications** are pulled every 60 s by the web app (no WebSocket push).
* **File storage** is local disk (`STORAGE_DIR`), behind a small storage interface ready for S3-compatible storage.
* **Single-language UI** (English).
* **Docker images** are not included; the tested deployment is nginx + systemd (doc 07).
* A dependency audit reports moderate findings in the **build-time** PWA tool chain (workbox → ejs/jake). It is not
  part of the shipped bundle; update `vite-plugin-pwa` when a fixed release is available.

## Recommended next steps

1. Confirm the operating market → set currency/tax, write the gateway adapter for the chosen provider, connect SMTP.
2. Obtain AnyDesk API credentials and run the verification checklist (doc 05).
3. Replace the placeholder legal texts (terms, privacy, handover, remote consent).
4. Accessibility audit (screen reader, keyboard-only pass) and a load test of checkout under concurrency.
5. Mobile app: React Native (Expo) client using `@dante/shared` and the same API (`X-Client: mobile`), push
   notifications via a `PUSH` channel in `notifications/channels.ts`.
6. Optional: PDF export of quotations and service reports; SLA targets per category with breach alerts; customer
   self-service knowledge base.
