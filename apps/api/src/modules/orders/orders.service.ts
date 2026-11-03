import type { z } from 'zod';
import {
  computeTotals, ORDER_STATUS_LABELS, ORDER_TRANSITIONS, PAY_ON_COLLECTION_METHODS, PERMISSIONS,
  type checkoutSchema, type OrderStatus, type PaymentMethod,
} from '@dante/shared';
import type { AuthContext } from '../../core/auth.js';
import { audit } from '../../core/audit.js';
import { badRequest, forbidden, invalidState, notFound } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { nextReference } from '../../core/references.js';
import { env, isTest } from '../../config/env.js';
import { db, type Db } from '../../db/knex.js';
import { consumeLine, releaseLine, reserveLine, sortByProduct } from '../inventory/inventory.service.js';
import { notify } from '../notifications/notifications.service.js';
import { getSettings } from '../settings/settings.service.js';
import { activeGateway } from '../payments/gateway.js';
import { orderBalance } from '../payments/balance.js';
import { mapPayment } from '../payments/payments.service.js';
import { usersWithPermission } from '../support/support.service.js';

type ClientInfo = { ip?: string; userAgent?: string };

/**
 * Checkout: re-prices from the database, reserves every line in ONE transaction (all-or-nothing, rows
 * locked in product order) and empties the cart. Stock is consumed when the goods leave the shop
 * (OUT_FOR_DELIVERY or COMPLETED) and released if the order is cancelled.
 */
export async function checkout(auth: AuthContext, input: z.infer<typeof checkoutSchema>, client: ClientInfo) {
  const settings = await getSettings();
  const method = input.paymentMethod as PaymentMethod;
  if (method === 'GATEWAY' ? !activeGateway() : !settings.enabledPaymentMethods.includes(method)) throw badRequest('This payment method is not available');
  if ((PAY_ON_COLLECTION_METHODS as readonly string[]).includes(method) && input.fulfilmentMethod !== 'COLLECTION') {
    throw badRequest('Cash or card at the counter is only available when you collect your order');
  }

  return db.transaction(async (trx) => {
    const cart = await trx('shopping_carts').where({ user_id: auth.userId }).first('id');
    const items = cart
      ? await trx('cart_items as ci').join('products as p', 'p.id', 'ci.product_id').where('ci.cart_id', cart.id)
          .select('ci.product_id', 'ci.quantity', 'p.name', 'p.sku', 'p.price_minor', 'p.is_active')
      : [];
    if (!items.length) throw badRequest('Your cart is empty');
    const inactive = items.find((i) => !i.is_active);
    if (inactive) throw invalidState(`${inactive.name} is no longer available. Remove it from your cart.`);

    let addressSnapshot = null;
    if (input.fulfilmentMethod === 'DELIVERY') {
      const a = await trx('customer_addresses').where({ id: input.addressId, user_id: auth.userId }).first();
      if (!a) throw badRequest('Choose one of your saved addresses');
      addressSnapshot = { label: a.label, line1: a.line1, line2: a.line2, city: a.city, region: a.region, postalCode: a.postal_code, country: a.country, phone: a.phone };
    }
    const deliveryFee = input.fulfilmentMethod === 'DELIVERY' ? settings.deliveryFeeMinor : 0;
    const totals = computeTotals(items.map((i) => i.price_minor * i.quantity), settings.taxRateBasisPoints, settings.taxInclusive, deliveryFee);
    const reference = await nextReference(trx, 'ORD');
    const [orderId] = await trx('sales_orders').insert({
      reference, customer_user_id: auth.userId, organization_id: auth.org?.id ?? null, status: 'PENDING_PAYMENT',
      fulfilment_method: input.fulfilmentMethod, payment_method: method, delivery_address: addressSnapshot ? JSON.stringify(addressSnapshot) : null,
      currency: settings.currencyCode, subtotal_minor: totals.subtotalMinor - deliveryFee, delivery_fee_minor: deliveryFee, tax_minor: totals.taxMinor,
      tax_rate_bp: settings.taxRateBasisPoints, tax_inclusive: settings.taxInclusive, total_minor: totals.totalMinor, customer_note: input.customerNote ?? null,
    });
    for (const i of sortByProduct(items)) {
      const [lineId] = await trx('sales_order_items').insert({
        sales_order_id: orderId, product_id: i.product_id, product_name: i.name, sku: i.sku, quantity: i.quantity,
        unit_price_minor: i.price_minor, line_total_minor: i.price_minor * i.quantity, stock_state: 'NONE',
      });
      await reserveLine(trx, 'sales_order_items', lineId as number, auth.userId); // throws INSUFFICIENT_STOCK → whole checkout rolls back
    }
    await trx('order_status_history').insert({ sales_order_id: orderId, from_status: null, to_status: 'PENDING_PAYMENT', changed_by: auth.userId });
    await trx('cart_items').where({ cart_id: cart!.id }).del();
    await notify({ userIds: [auth.userId], type: 'ORDER_PLACED', title: `Order ${reference} confirmed`,
      body: `Thank you for your order. ${method === 'GATEWAY' ? 'Complete the online payment to confirm it.' : 'Follow the payment instructions on the order page.'}`,
      link: `/account/orders/${orderId}` }, trx);
    await notify({ userIds: await usersWithPermission(PERMISSIONS.ORDERS_MANAGE, trx), type: 'NEW_ORDER', title: `New order ${reference}`,
      body: `${items.length} line(s), ${input.fulfilmentMethod.toLowerCase()}`, link: `/staff/orders/${orderId}`, email: false }, trx);
    await audit({ actorUserId: auth.userId, action: 'order.placed', entityType: 'sales_order', entityId: orderId as number, metadata: { totalMinor: totals.totalMinor }, ...client }, trx);
    return orderId as number;
  });
}

function canSeeAll(auth: AuthContext) {
  return auth.permissions.has(PERMISSIONS.ORDERS_VIEW_ALL);
}

function scope(q: ReturnType<typeof db>, auth: AuthContext) {
  if (canSeeAll(auth)) return q;
  return q.where((w) => {
    w.where('o.customer_user_id', auth.userId);
    if (auth.org?.role === 'ORG_ADMIN') w.orWhere('o.organization_id', auth.org.id);
  });
}

export async function listOrders(auth: AuthContext, filters: { status?: string; page: number; pageSize: number; q?: string }) {
  const base = scope(db('sales_orders as o').join('users as u', 'u.id', 'o.customer_user_id'), auth).modify((qb) => {
    if (filters.status) qb.where('o.status', filters.status);
    if (filters.q) qb.where((w) => w.where('o.reference', 'like', `%${filters.q}%`).orWhere('u.email', 'like', `%${filters.q}%`));
  });
  const total = await base.clone().count({ n: '*' }).first();
  const rows = await base.clone().orderBy('o.placed_at', 'desc').limit(filters.pageSize).offset((filters.page - 1) * filters.pageSize)
    .select('o.id', 'o.reference', 'o.status', 'o.fulfilment_method', 'o.payment_method', 'o.total_minor', 'o.currency', 'o.placed_at', 'o.paid_at',
      db.raw("CONCAT(u.first_name, ' ', u.last_name) as customer_name"),
      db.raw('(SELECT SUM(quantity) FROM sales_order_items i WHERE i.sales_order_id = o.id) as item_count'));
  return {
    items: rows.map((o: Record<string, any>) => ({
      id: o.id, reference: o.reference, status: o.status, fulfilmentMethod: o.fulfilment_method, paymentMethod: o.payment_method,
      totalMinor: o.total_minor, currency: o.currency, placedAt: o.placed_at, paidAt: o.paid_at, customerName: o.customer_name, itemCount: Number(o.item_count ?? 0),
    })),
    total: Number(total?.n ?? 0),
  };
}

export async function orderDetail(auth: AuthContext, id: number) {
  const o = await scope(db('sales_orders as o'), auth).where('o.id', id).first('o.*');
  if (!o) throw notFound('Order');
  const staff = canSeeAll(auth);
  const [items, history, payments, customer, settings] = await Promise.all([
    db('sales_order_items').where({ sales_order_id: id }).orderBy('id'),
    db('order_status_history').where({ sales_order_id: id }).orderBy('id'),
    db('payments').where({ payable_type: 'SALES_ORDER', payable_id: id }).orderBy('id'),
    db('users').where({ id: o.customer_user_id }).first('first_name', 'last_name', 'email', 'phone'),
    getSettings(),
  ]);
  const status = o.status as OrderStatus;
  return {
    id: o.id, reference: o.reference, status, fulfilmentMethod: o.fulfilment_method, paymentMethod: o.payment_method,
    deliveryAddress: typeof o.delivery_address === 'string' ? JSON.parse(o.delivery_address) : o.delivery_address,
    currency: o.currency, subtotalMinor: o.subtotal_minor, deliveryFeeMinor: o.delivery_fee_minor, taxMinor: o.tax_minor,
    taxRateBasisPoints: o.tax_rate_bp, taxInclusive: !!o.tax_inclusive, totalMinor: o.total_minor, customerNote: o.customer_note,
    placedAt: o.placed_at, paidAt: o.paid_at, fulfilledAt: o.fulfilled_at, cancelledAt: o.cancelled_at, cancelReason: o.cancel_reason,
    customer: customer ? { name: `${customer.first_name} ${customer.last_name}`, email: customer.email, phone: customer.phone } : null,
    items: items.map((i) => ({ id: i.id, productId: i.product_id, name: i.product_name, sku: i.sku, quantity: i.quantity, unitPriceMinor: i.unit_price_minor, lineTotalMinor: i.line_total_minor, ...(staff ? { stockState: i.stock_state } : {}) })),
    history: history.map((h) => ({ from: h.from_status, to: h.to_status, note: h.note, at: h.created_at })),
    payments: payments.map((p) => mapPayment(p, !staff)),
    balance: await orderBalance(id),
    paymentInstructions: o.payment_method === 'BANK_TRANSFER' ? settings.bankTransferInstructions : o.payment_method === 'MOBILE_MONEY' ? settings.mobileMoneyInstructions : null,
    nextStatuses: staff && auth.permissions.has(PERMISSIONS.ORDERS_MANAGE) ? ORDER_TRANSITIONS[status].filter((s) => s !== 'PAID') : [],
    canCancel: status === 'PENDING_PAYMENT' || (staff && ['PAID', 'PROCESSING'].includes(status)),
  };
}

async function releaseOrderStock(trx: Db, orderId: number, actorUserId: number | null, reason: string) {
  const lines = await trx('sales_order_items').where({ sales_order_id: orderId, stock_state: 'RESERVED' }).select('id', 'product_id');
  for (const l of sortByProduct(lines)) await releaseLine(trx, 'sales_order_items', l.id, actorUserId, reason);
}

/** Staff fulfilment flow. PAID is reached only through payments. */
export async function changeOrderStatus(auth: AuthContext, id: number, to: OrderStatus, note: string | undefined, client: ClientInfo) {
  if (!auth.permissions.has(PERMISSIONS.ORDERS_MANAGE)) throw forbidden();
  if (to === 'PAID') throw invalidState('Orders become paid when a payment is recorded');
  await db.transaction(async (trx) => {
    const o = await trx('sales_orders').where({ id }).forUpdate().first();
    if (!o) throw notFound('Order');
    const from = o.status as OrderStatus;
    if (!ORDER_TRANSITIONS[from].includes(to)) throw invalidState(`Order cannot move from ${ORDER_STATUS_LABELS[from]} to ${ORDER_STATUS_LABELS[to]}`);
    const balance = await orderBalance(id, trx);
    if (from === 'PENDING_PAYMENT' && to === 'PROCESSING' && !(PAY_ON_COLLECTION_METHODS as readonly string[]).includes(o.payment_method)) {
      throw invalidState('Wait for payment before preparing this order');
    }
    if (to === 'COMPLETED' && balance.outstandingMinor > 0) throw invalidState('Record the payment before handing over the order', balance);
    if (to === 'OUT_FOR_DELIVERY' && o.fulfilment_method !== 'DELIVERY') throw invalidState('This order is for collection');
    if (to === 'READY_FOR_COLLECTION' && o.fulfilment_method !== 'COLLECTION') throw invalidState('This order is for delivery');
    if (to === 'CANCELLED') {
      if (balance.paidMinor > 0) throw invalidState('Refund the payments on this order before cancelling it');
      await releaseOrderStock(trx, id, auth.userId, `Order ${o.reference} cancelled`);
    }
    if (to === 'OUT_FOR_DELIVERY' || to === 'COMPLETED') {
      // goods leave the shop: consume reservations exactly once (idempotent per line)
      const lines = await trx('sales_order_items').where({ sales_order_id: id }).whereIn('stock_state', ['RESERVED', 'NONE']).select('id', 'product_id');
      for (const l of sortByProduct(lines)) await consumeLine(trx, 'sales_order_items', l.id, auth.userId);
    }
    await trx('sales_orders').where({ id }).update({
      status: to,
      ...(to === 'COMPLETED' ? { fulfilled_at: trx.fn.now(3) } : {}),
      ...(to === 'CANCELLED' ? { cancelled_at: trx.fn.now(3), cancel_reason: note ?? 'Cancelled by staff' } : {}),
    });
    await trx('order_status_history').insert({ sales_order_id: id, from_status: from, to_status: to, changed_by: auth.userId, note: note ?? null });
    await notify({ userIds: [o.customer_user_id], type: 'ORDER_STATUS', title: `Order ${o.reference}: ${ORDER_STATUS_LABELS[to]}`,
      body: note ?? `Your order is now "${ORDER_STATUS_LABELS[to]}".`, link: `/account/orders/${id}` }, trx);
    await audit({ actorUserId: auth.userId, action: 'order.status_changed', entityType: 'sales_order', entityId: id, metadata: { from, to }, ...client }, trx);
  });
}

export async function cancelByCustomer(auth: AuthContext, id: number, reason: string, client: ClientInfo) {
  await db.transaction(async (trx) => {
    const o = await trx('sales_orders').where({ id, customer_user_id: auth.userId }).forUpdate().first();
    if (!o) throw notFound('Order');
    if (o.status !== 'PENDING_PAYMENT') throw invalidState('This order is already being processed. Contact us to cancel it.');
    if ((await orderBalance(id, trx)).paidMinor > 0) throw invalidState('A payment was received for this order. Contact us to cancel it.');
    await releaseOrderStock(trx, id, auth.userId, `Order ${o.reference} cancelled by customer`);
    await trx('payments').where({ payable_type: 'SALES_ORDER', payable_id: id, status: 'PENDING' }).update({ status: 'CANCELLED' });
    await trx('sales_orders').where({ id }).update({ status: 'CANCELLED', cancelled_at: trx.fn.now(3), cancel_reason: reason });
    await trx('order_status_history').insert({ sales_order_id: id, from_status: o.status, to_status: 'CANCELLED', changed_by: auth.userId, note: reason });
    await audit({ actorUserId: auth.userId, action: 'order.cancelled_by_customer', entityType: 'sales_order', entityId: id, ...client }, trx);
  });
}

/** Cancels unpaid orders after ORDER_PAYMENT_TIMEOUT_HOURS so their reserved stock returns to sale. */
export async function expireUnpaidOrders(now = new Date()) {
  const cutoff = new Date(now.getTime() - env.ORDER_PAYMENT_TIMEOUT_HOURS * 3_600_000);
  const stale = await db('sales_orders').where({ status: 'PENDING_PAYMENT' }).where('placed_at', '<', cutoff)
    .whereNotIn('payment_method', PAY_ON_COLLECTION_METHODS as unknown as string[]).pluck('id');
  let expired = 0;
  for (const id of stale) {
    await db.transaction(async (trx) => {
      const o = await trx('sales_orders').where({ id }).forUpdate().first();
      if (o.status !== 'PENDING_PAYMENT' || (await orderBalance(id, trx)).paidMinor > 0) return;
      // a pending online payment may still settle: leave those alone until the gateway reports failure
      if (await trx('payments').where({ payable_type: 'SALES_ORDER', payable_id: id, status: 'PENDING', method: 'GATEWAY' }).first('id')) return;
      await releaseOrderStock(trx, id, null, `Order ${o.reference} expired unpaid`);
      await trx('payments').where({ payable_type: 'SALES_ORDER', payable_id: id, status: 'PENDING' }).update({ status: 'CANCELLED' });
      await trx('sales_orders').where({ id }).update({ status: 'CANCELLED', cancelled_at: trx.fn.now(3), cancel_reason: 'Payment not received in time' });
      await trx('order_status_history').insert({ sales_order_id: id, from_status: 'PENDING_PAYMENT', to_status: 'CANCELLED', note: 'Expired unpaid' });
      await notify({ userIds: [o.customer_user_id], type: 'ORDER_EXPIRED', title: `Order ${o.reference} cancelled`,
        body: 'We did not receive payment in time, so the reserved items were released. You are welcome to order again.', link: `/account/orders/${id}` }, trx);
      expired++;
    });
  }
  return expired;
}

let timer: NodeJS.Timeout | undefined;
export function startOrderExpiryWorker(intervalMs = 15 * 60_000) {
  if (isTest || timer) return;
  timer = setInterval(() => void expireUnpaidOrders().catch((err) => logger.error({ err }, 'order expiry failed')), intervalMs);
  timer.unref();
}
