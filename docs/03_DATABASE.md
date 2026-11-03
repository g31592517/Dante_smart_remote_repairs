# 03 — Database (MySQL 8)

51 tables in five migrations (`apps/api/src/db/migrations`, registered in order in `migration-source.ts`).
Conventions: `BIGINT UNSIGNED` surrogate keys, foreign keys on every relation, `DATETIME(3)` in **UTC**, `DATE`
columns returned as `YYYY-MM-DD` strings, money as **integer minor units** (`*_minor`), `utf8mb4`, strict SQL mode.
Human-readable references (`SR-2026-000042`, `QT-…`, `ORD-…`, `PAY-…`, `PO-…`) are gap-free per year via
`reference_sequences`, allocated inside the creating transaction.

## Identity & administration (`001_identity`)

| Table | Purpose / key constraints |
|---|---|
| `roles`, `permissions`, `role_permissions` | RBAC; seeded from `@dante/shared` (`code` unique) |
| `users` | e-mail unique; `account_type` INDIVIDUAL/CORPORATE/STAFF; argon2 `password_hash` (NULL until an invite is accepted); lockout counters; terms version accepted |
| `user_roles` | user ↔ role, who granted it |
| `refresh_tokens` | SHA-256 of the token only; `family_id` for rotation and reuse detection; revoked/used timestamps |
| `user_tokens` | one-time INVITE / PASSWORD_RESET tokens (hashed, expiring) |
| `organizations`, `organization_members` | corporate accounts; a user belongs to at most one organisation (`UNIQUE(user_id)`); `org_role` ORG_ADMIN/ORG_MEMBER |
| `customer_addresses` | delivery addresses |
| `system_settings` | key → JSON value (currency, tax, consent texts, …) |
| `audit_logs` | append-only record of sensitive operations (actor, action, entity, metadata, IP) |
| `reference_sequences` | `(name, year)` counters |

## Support desk (`002_support`)

| Table | Purpose / key constraints |
|---|---|
| `service_categories` | configurable categories with a default service type |
| `technicians` | technician profile: specialities, availability, capacity (`UNIQUE(user_id)`) |
| `devices` | owned by a user **or** an organisation; repair history = requests by `device_id` |
| `support_requests` | the request; `reference` unique; `status` enum; milestone timestamps (`first_response_at`, `accepted_at`, `assigned_at`, `completed_at`, …) for SLA reporting; indexes per customer/org/technician + status |
| `technician_assignments` | assignment history (`is_current`) |
| `request_status_history` | every status transition with actor and note |
| `request_activities` | timeline; `visible_to_customer` flag |
| `service_messages` | customer ↔ staff conversation |
| `internal_notes` | staff-only notes (never returned to customers) |
| `attachments` | private files: request scope, context, visibility, SHA-256, detected MIME type |
| `customer_consents` | REMOTE_ACCESS / REPAIR_INTAKE / TERMS consents with the exact text, version, time, IP, revocation |
| `remote_sessions` | lifecycle timestamps, customer AnyDesk address, consent link, outcome, evidence (`MANUAL` / `ANYDESK_API`) |
| `notifications`, `notification_deliveries` | in-app notifications; per-channel delivery attempts with retry state |

## Store & inventory (`003_store`)

| Table | Purpose / key constraints |
|---|---|
| `product_categories` | tree (`parent_id`), unique `slug` |
| `products` | `sku` and `slug` unique; specs JSON; condition, warranty, compatibility; FULLTEXT(name, description) |
| `product_images` | public catalogue images |
| `inventory` | one row per product: `quantity_on_hand`, `quantity_reserved`, `reorder_level`; **CHECK 0 ≤ reserved ≤ on_hand** |
| `inventory_movements` | ledger of every change with deltas, resulting levels, reference and actor |
| `suppliers`, `purchase_orders`, `purchase_order_items` | restocking with partial receipt |
| `shopping_carts`, `cart_items` | one cart per user, `UNIQUE(cart_id, product_id)` |
| `sales_orders`, `sales_order_items` | price/name/SKU snapshots, tax rate snapshot, delivery address snapshot; line `stock_state` |
| `order_status_history` | fulfilment trail |

## Repairs (`004_repairs`)

| Table | Purpose / key constraints |
|---|---|
| `repair_jobs` | intake/on-site record per request (`UNIQUE(support_request_id)`): condition, accessories, acknowledgment, return |
| `repair_diagnostics`, `repair_work_logs` | findings and work performed, each with customer visibility |
| `quotations`, `quotation_items` | revisions (`UNIQUE(support_request_id, revision)`), status DRAFT/SENT/APPROVED/DECLINED/SUPERSEDED/EXPIRED, tax snapshot, validity |
| `repair_parts` | parts linked to approved quotation lines (or no-charge), `stock_state`, awaiting-stock flag, installer |
| `service_reports` | final report (`UNIQUE(support_request_id)`) with snapshots of installed parts and remote-session evidence |
| `repair_warranties` | warranty period per job |
| `customer_feedback` | one per request; CHECK rating 1–5; sub-ratings; technician snapshot for performance reporting |

## Payments (`005_payments`)

| Table | Purpose / key constraints |
|---|---|
| `payments` | payable (order or request), method, status PENDING/SUCCEEDED/FAILED/REFUNDED/CANCELLED, amount, currency; **`UNIQUE(provider, provider_reference)`** prevents recording the same receipt or gateway checkout twice |
| `payment_transactions` | append-only event log; **`UNIQUE(provider_event_id)`** makes webhook redelivery harmless |

## Transactions you can rely on

* Creating a request, quotation decision, checkout, payment recording, PO receipt, cancellation: each runs in a
  single transaction with row locks on the rows it changes.
* Stock-changing code always locks `inventory` rows in ascending `product_id` order.
* External calls (gateway checkout, AnyDesk API, e-mail) happen **outside** database transactions; e-mail is sent after
  commit (`afterCommit`) so a rolled-back operation never e-mails anyone.
