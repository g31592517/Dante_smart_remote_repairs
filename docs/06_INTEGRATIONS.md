# 06 — External integrations

All credentials live in `apps/api/.env` on the server. None are exposed to the browser.
Admin → Settings → *Integrations status* shows what is configured, without revealing secrets.
**The core workflow never depends on an external service**: requests, quotations, repairs, orders and offline payments
all work with every integration switched off.

## E-mail (notifications)

Every notification is stored in-app (bell icon) *and* queued per channel in `notification_deliveries`. E-mails are
sent **after the database transaction commits**. Failures are retried with back-off (1, 2, 4, 8 min; up to 5
attempts) by a background worker, and the failed count appears in Settings.

```bash
EMAIL_TRANSPORT=smtp                 # or "log" to print e-mails to the server log (development)
EMAIL_FROM="Dante Smart Remote Repairs <no-reply@yourdomain>"
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_SECURE=false                    # true for port 465
SMTP_USER=…
SMTP_PASSWORD=…
```

Notified events: registration welcome, request received, new request (managers), technician assigned, new job
(technician), status changes, progress updates, messages, remote session requested/authorised/connecting/completed/
withdrawn, quotation sent/approved/declined, report available, payment received/rejected/refunded, order placed/status/
expired, low stock, parts arrived, low customer rating, invitations, password reset.

## SMS and WhatsApp (extension points)

`apps/api/src/modules/notifications/channels.ts` defines a `Channel` interface (`send({ to, subject, text })`). SMS and
WhatsApp are present but **unconfigured**: no provider has been chosen, so no SDK is bundled and no credentials are
assumed. To enable one:
1. Choose a provider (e.g. Africa's Talking, Twilio, or Meta WhatsApp Cloud API) and implement `send` for it in
   `channels.ts`.
2. Set `SMS_PROVIDER` / `SMS_API_KEY` or `WHATSAPP_PROVIDER` / `WHATSAPP_API_TOKEN`, and mark the channel `configured`.
3. Queue deliveries for the channel in `notify()` for users whose preferred contact method matches (the request
   already stores `preferred_contact`).

## Payments

| Method | How it is settled |
|---|---|
| Cash, card at the counter | staff **record** the payment (receipt reference) on the order/request page |
| Bank transfer, mobile money | staff record it, **or** the customer reports the transaction reference and finance **verifies** it (Payments → To verify) |
| Online (gateway) | hosted checkout; the payment succeeds only when the gateway's **signed webhook** arrives with a matching amount and currency |

Common guarantees: one receipt/transaction reference can be recorded only once (`UNIQUE(provider, provider_reference)`);
webhook redelivery is ignored (`UNIQUE(provider_event_id)`); every step is logged in `payment_transactions` and the
audit log; refunds are recorded with a reason (and sent to the gateway for gateway payments).

### Enabling the included Stripe adapter

```bash
PAYMENT_GATEWAY=stripe
STRIPE_SECRET_KEY=sk_live_…
STRIPE_WEBHOOK_SECRET=whsec_…
```
Create a webhook endpoint in Stripe for `https://<your-domain>/api/v1/payments/webhooks/gateway` with events
`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and
`checkout.session.expired`. Stripe expects amounts in the currency's minor unit, so check that the platform's
*decimal places* setting matches Stripe's for your currency.

### Adding your own provider (e.g. a mobile-money aggregator)

Implement `PaymentGateway` in `apps/api/src/modules/payments/gateway.ts`:
`createCheckout()` returns the provider's reference and a URL to send the customer to; `parseWebhook()` **must verify
the provider's signature** and return `{ eventId, providerReference, outcome, amountMinor, currency }`; `refund()`.
Register it in `activeGateway()`. Order/payment logic, idempotency and amount checks need no changes.

## Currency and tax

Configured in Admin → Settings: ISO currency code, decimal places, tax rate (%), label, inclusive or exclusive pricing,
and delivery fee. The defaults are deliberately neutral (USD, 0 % tax) **until the operating market is confirmed**.
Quotations and orders keep the rate in force when they were issued.

## AnyDesk

See [05_ANYDESK_INTEGRATION.md](05_ANYDESK_INTEGRATION.md).
