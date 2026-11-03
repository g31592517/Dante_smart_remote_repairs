import { PAYMENT_METHOD_LABELS, PERMISSIONS, type PayableType, type PaymentMethod } from '@dante/shared';
import type { AuthContext } from '../../core/auth.js';
import { audit } from '../../core/audit.js';
import { AppError, badRequest, forbidden, integrationUnavailable, invalidState, notFound } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { nextReference } from '../../core/references.js';
import { env } from '../../config/env.js';
import { db, type Db } from '../../db/knex.js';
import { notify } from '../notifications/notifications.service.js';
import { getSettings } from '../settings/settings.service.js';
import { addActivity } from '../support/support.workflow.js';
import { orderBalance, requestBalance } from './balance.js';
import { activeGateway } from './gateway.js';

type ClientInfo = { ip?: string; userAgent?: string };
const OFFLINE: PaymentMethod[] = ['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CARD_ON_SITE'];

export function mapPayment(p: Record<string, any>, customerView = false) {
  return {
    id: p.id, reference: p.reference, payableType: p.payable_type, payableId: p.payable_id, method: p.method, status: p.status,
    currency: p.currency, amountMinor: p.amount_minor, provider: p.provider, providerReference: p.provider_reference,
    checkoutUrl: p.status === 'PENDING' ? p.checkout_url : null, createdAt: p.created_at, succeededAt: p.succeeded_at, refundedAt: p.refunded_at,
    ...(customerView ? {} : { note: p.note, verifiedAt: p.verified_at, customerUserId: p.customer_user_id }),
  };
}

interface Payable {
  type: PayableType;
  id: number;
  reference: string;
  customerUserId: number;
  organizationId: number | null;
  outstandingMinor: number;
}

async function loadPayable(type: PayableType, id: number, conn: Db): Promise<Payable> {
  if (type === 'SALES_ORDER') {
    const o = await conn('sales_orders').where({ id }).forUpdate().first('id', 'reference', 'customer_user_id', 'organization_id', 'status');
    if (!o) throw notFound('Order');
    if (o.status === 'CANCELLED') throw invalidState('This order is cancelled');
    return { type, id, reference: o.reference, customerUserId: o.customer_user_id, organizationId: o.organization_id, outstandingMinor: (await orderBalance(id, conn)).outstandingMinor };
  }
  const r = await conn('support_requests').where({ id }).forUpdate().first('id', 'reference', 'customer_user_id', 'organization_id', 'status');
  if (!r) throw notFound('Support request');
  if (r.status === 'CANCELLED') throw invalidState('This request is cancelled');
  return { type, id, reference: r.reference, customerUserId: r.customer_user_id, organizationId: r.organization_id, outstandingMinor: (await requestBalance(id, conn)).outstandingMinor };
}

function assertCustomerOwns(auth: AuthContext, p: Payable) {
  const own = p.customerUserId === auth.userId;
  const orgAdmin = !!auth.org && auth.org.role === 'ORG_ADMIN' && p.organizationId === auth.org.id;
  if (!own && !orgAdmin) throw notFound(p.type === 'SALES_ORDER' ? 'Order' : 'Support request');
}

/** Effects of money arriving: order → PAID when fully paid; timeline + confirmation for requests. */
async function onPaymentSucceeded(trx: Db, paymentId: number) {
  const p = await trx('payments').where({ id: paymentId }).first();
  if (p.payable_type === 'SALES_ORDER') {
    const order = await trx('sales_orders').where({ id: p.payable_id }).forUpdate().first();
    const bal = await orderBalance(order.id, trx);
    if (bal.outstandingMinor === 0) {
      await trx('sales_orders').where({ id: order.id }).update({ paid_at: trx.fn.now(3), ...(order.status === 'PENDING_PAYMENT' ? { status: 'PAID' } : {}) });
      if (order.status === 'PENDING_PAYMENT') {
        await trx('order_status_history').insert({ sales_order_id: order.id, from_status: 'PENDING_PAYMENT', to_status: 'PAID', note: `Payment ${p.reference}` });
      }
    }
    await notify({ userIds: [p.customer_user_id], type: 'PAYMENT_RECEIVED', title: `Payment received for ${order.reference}`,
      body: `We received your payment (${p.reference}). ${bal.outstandingMinor === 0 ? 'Your order is fully paid.' : 'A balance remains on this order.'}`,
      link: `/account/orders/${order.id}` }, trx);
  } else {
    const r = await trx('support_requests').where({ id: p.payable_id }).first('id', 'reference', 'assigned_technician_id');
    await addActivity(trx, r.id, 'PAYMENT_RECEIVED', `Payment ${p.reference} received (${PAYMENT_METHOD_LABELS[p.method as PaymentMethod]})`, { metadata: { amountMinor: p.amount_minor, currency: p.currency } });
    await notify({ userIds: [p.customer_user_id], type: 'PAYMENT_RECEIVED', title: `Payment received for ${r.reference}`,
      body: `Thank you — payment ${p.reference} has been recorded against your request.`, link: `/account/requests/${r.id}` }, trx);
    if (r.assigned_technician_id) {
      await notify({ userIds: [r.assigned_technician_id], type: 'PAYMENT_RECEIVED', title: `${r.reference}: payment received`, body: p.reference, link: `/staff/requests/${r.id}`, email: false }, trx);
    }
  }
}

/** Staff record an offline payment they have received and verified (cash, transfer, mobile money, card terminal). */
export async function recordOfflinePayment(auth: AuthContext, input: { payableType: PayableType; payableId: number; method: PaymentMethod; amountMinor: number; reference: string; note?: string }, client: ClientInfo) {
  if (!auth.permissions.has(PERMISSIONS.PAYMENTS_RECORD)) throw forbidden();
  if (!OFFLINE.includes(input.method)) throw badRequest('Only offline payment methods can be recorded manually');
  return db.transaction(async (trx) => {
    const payable = await loadPayable(input.payableType, input.payableId, trx);
    if (payable.outstandingMinor <= 0) throw invalidState('Nothing is outstanding on this item');
    if (input.amountMinor > payable.outstandingMinor) throw badRequest(`Amount exceeds the outstanding balance (${payable.outstandingMinor})`, { outstandingMinor: payable.outstandingMinor });
    const settings = await getSettings(trx);
    const reference = await nextReference(trx, 'PAY');
    const [id] = await trx('payments').insert({
      reference, payable_type: input.payableType, payable_id: input.payableId, customer_user_id: payable.customerUserId, organization_id: payable.organizationId,
      method: input.method, status: 'SUCCEEDED', currency: settings.currencyCode, amount_minor: input.amountMinor, provider: 'OFFLINE',
      provider_reference: `${input.method}:${input.reference}`, recorded_by: auth.userId, verified_by: auth.userId, verified_at: trx.fn.now(3),
      succeeded_at: trx.fn.now(3), note: input.note ?? null,
    });
    await trx('payment_transactions').insert({ payment_id: id, event_type: 'RECORDED', status_after: 'SUCCEEDED', amount_minor: input.amountMinor, actor_user_id: auth.userId, payload: JSON.stringify({ externalReference: input.reference }) });
    await onPaymentSucceeded(trx, id as number);
    await audit({ actorUserId: auth.userId, action: 'payment.recorded', entityType: 'payment', entityId: id as number, metadata: { ...input }, ...client }, trx);
    return id as number;
  });
}

/** Customer tells us they paid by transfer/mobile money; finance verifies it against the bank statement. */
export async function submitPaymentClaim(auth: AuthContext, input: { payableType: PayableType; payableId: number; method: PaymentMethod; amountMinor: number; reference: string }, client: ClientInfo) {
  if (!['BANK_TRANSFER', 'MOBILE_MONEY'].includes(input.method)) throw badRequest('Only bank-transfer and mobile-money payments can be reported online');
  return db.transaction(async (trx) => {
    const payable = await loadPayable(input.payableType, input.payableId, trx);
    assertCustomerOwns(auth, payable);
    if (input.amountMinor > payable.outstandingMinor) throw badRequest('Amount exceeds the outstanding balance');
    const settings = await getSettings(trx);
    const reference = await nextReference(trx, 'PAY');
    const [id] = await trx('payments').insert({
      reference, payable_type: input.payableType, payable_id: input.payableId, customer_user_id: payable.customerUserId, organization_id: payable.organizationId,
      method: input.method, status: 'PENDING', currency: settings.currencyCode, amount_minor: input.amountMinor, provider: 'OFFLINE',
      provider_reference: `${input.method}:${input.reference}`, recorded_by: auth.userId,
    });
    await trx('payment_transactions').insert({ payment_id: id, event_type: 'CLAIMED', status_after: 'PENDING', amount_minor: input.amountMinor, actor_user_id: auth.userId });
    const finance = await trx('users as u').join('user_roles as ur', 'ur.user_id', 'u.id').join('role_permissions as rp', 'rp.role_id', 'ur.role_id')
      .join('permissions as pm', 'pm.id', 'rp.permission_id').where({ 'pm.code': PERMISSIONS.PAYMENTS_RECORD, 'u.is_active': true }).distinct().pluck('u.id');
    await notify({ userIds: finance, type: 'PAYMENT_TO_VERIFY', title: `Verify payment ${reference}`, body: `${payable.reference}: ${input.method} ref ${input.reference}`, link: '/staff/payments?status=PENDING', email: false }, trx);
    await audit({ actorUserId: auth.userId, action: 'payment.claimed', entityType: 'payment', entityId: id as number, ...client }, trx);
    return id as number;
  });
}

export async function verifyPaymentClaim(auth: AuthContext, paymentId: number, approve: boolean, note: string | undefined, client: ClientInfo) {
  if (!auth.permissions.has(PERMISSIONS.PAYMENTS_RECORD)) throw forbidden();
  await db.transaction(async (trx) => {
    const p = await trx('payments').where({ id: paymentId }).forUpdate().first();
    if (!p) throw notFound('Payment');
    if (p.provider !== 'OFFLINE' || p.status !== 'PENDING') throw invalidState('Only pending offline payments can be verified');
    if (approve) {
      const payable = await loadPayable(p.payable_type, p.payable_id, trx);
      if (p.amount_minor > payable.outstandingMinor) throw invalidState('This payment exceeds the current outstanding balance');
    }
    const status = approve ? 'SUCCEEDED' : 'FAILED';
    await trx('payments').where({ id: paymentId }).update({ status, verified_by: auth.userId, verified_at: trx.fn.now(3), note: note ?? p.note, ...(approve ? { succeeded_at: trx.fn.now(3) } : {}) });
    await trx('payment_transactions').insert({ payment_id: paymentId, event_type: approve ? 'VERIFIED' : 'REJECTED', status_after: status, amount_minor: p.amount_minor, actor_user_id: auth.userId, payload: note ? JSON.stringify({ note }) : null });
    if (approve) await onPaymentSucceeded(trx, paymentId);
    else await notify({ userIds: [p.customer_user_id], type: 'PAYMENT_REJECTED', title: `Payment ${p.reference} could not be verified`, body: note ?? 'Please contact us with your proof of payment.', link: '/account' }, trx);
    await audit({ actorUserId: auth.userId, action: approve ? 'payment.verified' : 'payment.rejected', entityType: 'payment', entityId: paymentId, metadata: { note }, ...client }, trx);
  });
}

/** Creates a PENDING gateway payment and a hosted checkout. Success arrives only via the verified webhook. */
export async function startGatewayCheckout(auth: AuthContext, payableType: PayableType, payableId: number, client: ClientInfo) {
  const gateway = activeGateway();
  if (!gateway) throw integrationUnavailable('Online payment is not available. Please choose another payment method.');
  const settings = await getSettings();
  const created = await db.transaction(async (trx) => {
    const payable = await loadPayable(payableType, payableId, trx);
    assertCustomerOwns(auth, payable);
    if (payable.outstandingMinor <= 0) throw invalidState('Nothing is outstanding');
    // one open checkout at a time: cancel earlier pending attempts
    await trx('payments').where({ payable_type: payableType, payable_id: payableId, method: 'GATEWAY', status: 'PENDING' }).update({ status: 'CANCELLED' });
    const reference = await nextReference(trx, 'PAY');
    const [id] = await trx('payments').insert({
      reference, payable_type: payableType, payable_id: payableId, customer_user_id: payable.customerUserId, organization_id: payable.organizationId,
      method: 'GATEWAY', status: 'PENDING', currency: settings.currencyCode, amount_minor: payable.outstandingMinor, provider: gateway.name,
    });
    await trx('payment_transactions').insert({ payment_id: id, event_type: 'CREATED', status_after: 'PENDING', amount_minor: payable.outstandingMinor, actor_user_id: auth.userId });
    await audit({ actorUserId: auth.userId, action: 'payment.checkout_started', entityType: 'payment', entityId: id as number, ...client }, trx);
    return { id: id as number, reference, amountMinor: payable.outstandingMinor, payable };
  });
  const back = created.payable.type === 'SALES_ORDER' ? `/account/orders/${payableId}` : `/account/requests/${payableId}`;
  try {
    const checkout = await gateway.createCheckout({
      paymentId: created.id, paymentReference: created.reference, amountMinor: created.amountMinor, currency: settings.currencyCode,
      description: `${settings.businessName} — ${created.payable.reference}`, customerEmail: auth.email,
      successUrl: `${env.APP_URL}${back}?payment=success`, cancelUrl: `${env.APP_URL}${back}?payment=cancelled`,
    });
    await db('payments').where({ id: created.id }).update({ provider_reference: checkout.providerReference, checkout_url: checkout.checkoutUrl });
    return { paymentId: created.id, checkoutUrl: checkout.checkoutUrl };
  } catch (err) {
    await db('payments').where({ id: created.id }).update({ status: 'FAILED', note: 'Could not create gateway checkout' });
    logger.error({ err }, 'gateway checkout failed');
    throw integrationUnavailable('The payment provider is not responding. Please try again later or choose another method.');
  }
}

/** Verified, idempotent webhook processing. Re-delivered events are acknowledged without effect. */
export async function handleGatewayWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
  const gateway = activeGateway();
  if (!gateway) throw integrationUnavailable('No payment gateway configured');
  let event;
  try {
    event = await gateway.parseWebhook(rawBody, headers);
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid webhook signature');
  }
  if (event.outcome === 'IGNORED' || !event.providerReference) return { handled: false };
  return db.transaction(async (trx) => {
    const p = await trx('payments').where({ provider: gateway.name, provider_reference: event.providerReference }).forUpdate().first();
    if (!p) {
      logger.warn({ ref: event.providerReference }, 'webhook for unknown payment');
      return { handled: false };
    }
    const dup = await trx('payment_transactions').where({ provider_event_id: event.eventId }).first('id');
    if (dup) return { handled: false, duplicate: true };
    let status = p.status;
    if (p.status === 'PENDING' || (p.status === 'CANCELLED' && event.outcome === 'SUCCEEDED')) {
      if (event.outcome === 'SUCCEEDED') {
        const mismatch = event.amountMinor !== Number(p.amount_minor) || (event.currency && event.currency !== p.currency);
        status = mismatch ? 'FAILED' : 'SUCCEEDED';
        if (mismatch) logger.error({ paymentId: p.id, event }, 'gateway amount/currency mismatch — payment NOT accepted');
      } else status = 'FAILED';
      await trx('payments').where({ id: p.id }).update({ status, ...(status === 'SUCCEEDED' ? { succeeded_at: trx.fn.now(3) } : {}) });
    }
    await trx('payment_transactions').insert({
      payment_id: p.id, event_type: 'GATEWAY_EVENT', provider_event_id: event.eventId, status_after: status, amount_minor: event.amountMinor, payload: JSON.stringify(event.raw),
    });
    if (status === 'SUCCEEDED' && p.status !== 'SUCCEEDED') await onPaymentSucceeded(trx, p.id);
    await audit({ action: 'payment.gateway_event', entityType: 'payment', entityId: p.id, metadata: { outcome: event.outcome, status } }, trx);
    return { handled: true, status };
  });
}

export async function refundPayment(auth: AuthContext, paymentId: number, reason: string, client: ClientInfo) {
  if (!auth.permissions.has(PERMISSIONS.PAYMENTS_REFUND)) throw forbidden();
  const p0 = await db('payments').where({ id: paymentId }).first();
  if (!p0) throw notFound('Payment');
  if (p0.status !== 'SUCCEEDED') throw invalidState('Only successful payments can be refunded');
  let refundId: string | null = null;
  if (p0.method === 'GATEWAY') {
    const gateway = activeGateway();
    if (!gateway || gateway.name !== p0.provider) throw integrationUnavailable('The gateway that took this payment is not configured');
    refundId = (await gateway.refund(p0.provider_reference, p0.amount_minor)).refundId;
  }
  await db.transaction(async (trx) => {
    const p = await trx('payments').where({ id: paymentId }).forUpdate().first();
    if (p.status !== 'SUCCEEDED') throw invalidState('Payment already refunded');
    await trx('payments').where({ id: paymentId }).update({ status: 'REFUNDED', refunded_at: trx.fn.now(3), note: reason });
    await trx('payment_transactions').insert({ payment_id: paymentId, event_type: 'REFUNDED', status_after: 'REFUNDED', amount_minor: p.amount_minor, actor_user_id: auth.userId, payload: JSON.stringify({ reason, refundId }) });
    await notify({ userIds: [p.customer_user_id], type: 'PAYMENT_REFUNDED', title: `Refund for payment ${p.reference}`, body: reason, link: '/account' }, trx);
    await audit({ actorUserId: auth.userId, action: 'payment.refunded', entityType: 'payment', entityId: paymentId, metadata: { reason, refundId, method: p.method }, ...client }, trx);
  });
}

export async function listPayments(auth: AuthContext, filters: { status?: string; payableType?: string; page: number; pageSize: number }) {
  const staff = auth.permissions.has(PERMISSIONS.PAYMENTS_VIEW);
  const base = db('payments as p').join('users as u', 'u.id', 'p.customer_user_id').modify((q) => {
    if (!staff) q.where((w) => {
      w.where('p.customer_user_id', auth.userId);
      if (auth.org?.role === 'ORG_ADMIN') w.orWhere('p.organization_id', auth.org.id);
    });
    if (filters.status) q.where('p.status', filters.status);
    if (filters.payableType) q.where('p.payable_type', filters.payableType);
  });
  const total = await base.clone().count({ n: '*' }).first();
  const rows = await base.clone().orderBy('p.id', 'desc').limit(filters.pageSize).offset((filters.page - 1) * filters.pageSize)
    .select('p.*', db.raw("CONCAT(u.first_name, ' ', u.last_name) as customer_name"),
      db.raw("CASE p.payable_type WHEN 'SALES_ORDER' THEN (SELECT reference FROM sales_orders WHERE id = p.payable_id) ELSE (SELECT reference FROM support_requests WHERE id = p.payable_id) END as payable_reference"));
  return {
    items: rows.map((p: Record<string, any>) => ({ ...mapPayment(p, !staff), customerName: p.customer_name, payableReference: p.payable_reference })),
    total: Number(total?.n ?? 0),
  };
}
