import Stripe from 'stripe';
import { env } from '../../config/env.js';

/**
 * Payment-gateway port. The platform never trusts the browser about payment success: a payment becomes
 * SUCCEEDED only through `parseWebhook`, which must verify the provider's signature, plus an amount and
 * currency check in payments.service. Offline methods (cash, bank transfer, mobile money, card at the
 * counter) do not use a gateway — staff record and verify them.
 *
 * To add the business's actual provider (e.g. a mobile-money aggregator or a local card acquirer), implement
 * this interface in a new file and select it in `activeGateway()`; nothing else changes.
 */
export interface CheckoutRequest {
  paymentId: number;
  paymentReference: string;
  amountMinor: number;
  currency: string;
  description: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}
export interface CheckoutResult {
  providerReference: string; // provider's id for this checkout, stored in payments.provider_reference
  checkoutUrl: string; // where to send the customer
}
export interface GatewayEvent {
  eventId: string; // unique per delivery, for idempotency
  providerReference: string; // matches payments.provider_reference
  outcome: 'SUCCEEDED' | 'FAILED' | 'IGNORED';
  amountMinor: number | null;
  currency: string | null;
  raw: unknown;
}
export interface PaymentGateway {
  name: string;
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  /** Throws if the signature is invalid. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<GatewayEvent>;
  refund(providerReference: string, amountMinor: number): Promise<{ refundId: string }>;
}

/* ---------------- Stripe (reference implementation) ---------------- */

export class StripeGateway implements PaymentGateway {
  name = 'STRIPE';
  private stripe: Stripe;
  constructor(secretKey: string, private webhookSecret: string) {
    this.stripe = new Stripe(secretKey);
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: req.paymentReference,
      customer_email: req.customerEmail,
      metadata: { paymentId: String(req.paymentId), paymentReference: req.paymentReference },
      line_items: [{ quantity: 1, price_data: { currency: req.currency.toLowerCase(), unit_amount: req.amountMinor, product_data: { name: req.description } } }],
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
    });
    if (!session.url) throw new Error('Stripe did not return a checkout URL');
    return { providerReference: session.id, checkoutUrl: session.url };
  }

  async parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<GatewayEvent> {
    const sig = headers['stripe-signature'];
    const event = this.stripe.webhooks.constructEvent(rawBody, Array.isArray(sig) ? sig[0]! : sig ?? '', this.webhookSecret);
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded' ||
        event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired') {
      const s = event.data.object as Stripe.Checkout.Session;
      const paid = s.payment_status === 'paid' && event.type !== 'checkout.session.async_payment_failed';
      const failed = event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed';
      return {
        eventId: event.id, providerReference: s.id, outcome: paid ? 'SUCCEEDED' : failed ? 'FAILED' : 'IGNORED',
        amountMinor: s.amount_total ?? null, currency: s.currency?.toUpperCase() ?? null, raw: { type: event.type, id: s.id, payment_status: s.payment_status },
      };
    }
    return { eventId: event.id, providerReference: '', outcome: 'IGNORED', amountMinor: null, currency: null, raw: { type: event.type } };
  }

  async refund(providerReference: string, amountMinor: number) {
    const session = await this.stripe.checkout.sessions.retrieve(providerReference);
    const intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!intent) throw new Error('No payment intent on this checkout session');
    const refund = await this.stripe.refunds.create({ payment_intent: intent, amount: amountMinor });
    return { refundId: refund.id };
  }
}

let override: PaymentGateway | null | undefined;
let instance: PaymentGateway | null | undefined;
export function setGatewayForTests(g: PaymentGateway | null | undefined) {
  override = g;
}
export function activeGateway(): PaymentGateway | null {
  if (override !== undefined) return override;
  if (instance !== undefined) return instance;
  instance = env.PAYMENT_GATEWAY === 'stripe' && env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET
    ? new StripeGateway(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET)
    : null;
  return instance;
}
