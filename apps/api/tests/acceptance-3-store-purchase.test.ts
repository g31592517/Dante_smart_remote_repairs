import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';
import { anon, app, createProduct, db, registerCustomer, staff, stockOf } from './helpers.js';
import { setGatewayForTests, StripeGateway, type PaymentGateway } from '../src/modules/payments/gateway.js';
import { expireUnpaidOrders } from '../src/modules/orders/orders.service.js';

async function addressFor(customer: Awaited<ReturnType<typeof registerCustomer>>) {
  const a = await customer.post('/account/addresses', { label: 'Office', line1: '1 Main St', city: 'Nairobi', country: 'Kenya' });
  return a.body.data.id as number;
}

/** ACCEPTANCE TEST 3 — IT product purchase with correct inventory updates. */
describe('Acceptance 3: IT product purchase', () => {
  afterEach(() => setGatewayForTests(undefined));

  it('browse → cart → checkout → pay → fulfil, with stock reserved then consumed exactly once', async () => {
    const store = await staff.store();
    const finance = await staff.finance();
    const customer = await registerCustomer();
    const product = await createProduct(store, 5, 2500, { isFeatured: true });

    // browse anonymously, search and filter
    const browse = await anon.get(`/catalog/products?q=${product.sku}&inStock=true`);
    expect(browse.status).toBe(200);
    expect(browse.body.data[0]).toMatchObject({ id: product.id, priceMinor: 2500, stock: { status: 'IN_STOCK', available: 5 } });
    expect(browse.body.data[0].stock.onHand).toBeUndefined(); // exact on-hand/reserved figures are staff-only

    // cart uses server prices
    const cart = await customer.post('/cart/items', { productId: product.id, quantity: 2, unitPriceMinor: 1 });
    expect(cart.body.data).toMatchObject({ subtotalMinor: 5000, itemCount: 2, canCheckout: true });

    const checkout = await customer.post('/orders/checkout', { fulfilmentMethod: 'DELIVERY', addressId: await addressFor(customer), paymentMethod: 'BANK_TRANSFER' });
    expect(checkout.status).toBe(201);
    const order = checkout.body.data;
    expect(order.reference).toMatch(/^ORD-\d{4}-\d{6}$/);
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.totalMinor).toBe(5000);
    expect(order.paymentInstructions).toBeTruthy();
    expect(await stockOf(product.id)).toEqual({ onHand: 5, reserved: 2, available: 3 }); // reserved at checkout
    expect((await customer.get('/cart')).body.data.items).toHaveLength(0);

    // customer reports a transfer; finance verifies it
    const claim = await customer.post('/payments/claims', { payableType: 'SALES_ORDER', payableId: order.id, method: 'BANK_TRANSFER', amountMinor: 5000, reference: 'TRX-778899' });
    expect(claim.status).toBe(201);
    expect(claim.body.data.status).toBe('PENDING');
    expect((await customer.get(`/orders/${order.id}`)).body.data.status).toBe('PENDING_PAYMENT');
    const verified = await finance.post(`/payments/${claim.body.data.id}/verify`, { approve: true });
    expect(verified.body.data.status).toBe('SUCCEEDED');
    expect((await customer.get(`/orders/${order.id}`)).body.data.status).toBe('PAID');

    // fulfilment by the store; stock leaves when dispatched
    expect((await store.post(`/orders/${order.id}/status`, { status: 'PROCESSING' })).status).toBe(200);
    expect((await store.post(`/orders/${order.id}/status`, { status: 'READY_FOR_COLLECTION' })).status).toBe(409); // delivery order
    expect((await store.post(`/orders/${order.id}/status`, { status: 'OUT_FOR_DELIVERY' })).status).toBe(200);
    expect(await stockOf(product.id)).toEqual({ onHand: 3, reserved: 0, available: 3 });
    const done = await store.post(`/orders/${order.id}/status`, { status: 'COMPLETED' });
    expect(done.status).toBe(200);
    expect(await stockOf(product.id)).toEqual({ onHand: 3, reserved: 0, available: 3 }); // not deducted twice

    // customer tracks the order
    const tracked = (await customer.get(`/orders/${order.id}`)).body.data;
    expect(tracked.history.map((h: { to: string }) => h.to)).toEqual(['PENDING_PAYMENT', 'PAID', 'PROCESSING', 'OUT_FOR_DELIVERY', 'COMPLETED']);
    expect((await customer.get('/orders')).body.data[0].id).toBe(order.id);
    const moves = await db('inventory_movements').where({ product_id: product.id, reference_type: 'SALES_ORDER_ITEM' }).pluck('movement_type');
    expect(moves).toEqual(['RESERVATION', 'SALE']);
  });

  it('rolls back the whole checkout when any line is short, and never oversells under concurrency', async () => {
    const store = await staff.store();
    const scarce = await createProduct(store, 1, 1000);
    const plenty = await createProduct(store, 10, 1000);
    const a = await registerCustomer();
    await a.post('/cart/items', { productId: plenty.id, quantity: 1 });
    await a.post('/cart/items', { productId: scarce.id, quantity: 2 });
    const short = await a.post('/orders/checkout', { fulfilmentMethod: 'COLLECTION', paymentMethod: 'CASH' });
    expect(short.status).toBe(409);
    expect(short.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await stockOf(plenty.id)).reserved).toBe(0); // the line that fitted was rolled back too

    // two customers race for the last unit
    const b = await registerCustomer();
    const c = await registerCustomer();
    await b.post('/cart/items', { productId: scarce.id, quantity: 1 });
    await c.post('/cart/items', { productId: scarce.id, quantity: 1 });
    const results = await Promise.all([b, c].map((x) => x.post('/orders/checkout', { fulfilmentMethod: 'COLLECTION', paymentMethod: 'CASH' })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await stockOf(scarce.id)).toEqual({ onHand: 1, reserved: 1, available: 0 });
  });

  it('releases stock when an unpaid order is cancelled or expires', async () => {
    const store = await staff.store();
    const product = await createProduct(store, 4);
    const customer = await registerCustomer();
    await customer.post('/cart/items', { productId: product.id, quantity: 3 });
    const order = (await customer.post('/orders/checkout', { fulfilmentMethod: 'COLLECTION', paymentMethod: 'MOBILE_MONEY' })).body.data;
    expect((await stockOf(product.id)).reserved).toBe(3);
    const cancelled = await customer.post(`/orders/${order.id}/cancel`, { reason: 'Changed my mind' });
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(await stockOf(product.id)).toEqual({ onHand: 4, reserved: 0, available: 4 });

    await customer.post('/cart/items', { productId: product.id, quantity: 2 });
    const order2 = (await customer.post('/orders/checkout', { fulfilmentMethod: 'COLLECTION', paymentMethod: 'BANK_TRANSFER' })).body.data;
    await db('sales_orders').where({ id: order2.id }).update({ placed_at: new Date(Date.now() - 100 * 3_600_000) });
    expect(await expireUnpaidOrders()).toBeGreaterThanOrEqual(1);
    expect((await customer.get(`/orders/${order2.id}`)).body.data.status).toBe('CANCELLED');
    expect(await stockOf(product.id)).toEqual({ onHand: 4, reserved: 0, available: 4 });
  });

  it('settles gateway payments only through a verified, idempotent webhook with matching amount', async () => {
    let lastRef = '';
    const fake: PaymentGateway = {
      name: 'FAKE',
      async createCheckout(req) { lastRef = `cs_test_${req.paymentId}`; return { providerReference: lastRef, checkoutUrl: `https://pay.example/${lastRef}` }; },
      async parseWebhook(raw, headers) {
        if (headers['x-fake-signature'] !== 'valid') throw new Error('bad signature');
        const e = JSON.parse(raw.toString());
        return { eventId: e.id, providerReference: e.ref, outcome: e.outcome, amountMinor: e.amount, currency: e.currency, raw: e };
      },
      async refund() { return { refundId: 're_1' }; },
    };
    setGatewayForTests(fake);
    const store = await staff.store();
    const product = await createProduct(store, 3, 4200);
    const customer = await registerCustomer();
    await customer.post('/cart/items', { productId: product.id, quantity: 1 });
    const order = (await customer.post('/orders/checkout', { fulfilmentMethod: 'COLLECTION', paymentMethod: 'GATEWAY' })).body.data;
    const start = await customer.post('/payments/checkout', { payableType: 'SALES_ORDER', payableId: order.id });
    expect(start.status).toBe(201);
    expect(start.body.data.checkoutUrl).toContain(lastRef);

    const hook = (body: object, sig = 'valid') =>
      request(app).post('/api/v1/payments/webhooks/gateway').set('x-fake-signature', sig).set('content-type', 'application/json').send(JSON.stringify(body));
    expect((await hook({ id: 'evt_bad', ref: lastRef, outcome: 'SUCCEEDED', amount: 4200, currency: 'USD' }, 'forged')).status).toBe(400);
    expect((await customer.get(`/orders/${order.id}`)).body.data.status).toBe('PENDING_PAYMENT');

    const ok1 = await hook({ id: 'evt_1', ref: lastRef, outcome: 'SUCCEEDED', amount: 4200, currency: 'USD' });
    expect(ok1.body.data).toMatchObject({ handled: true, status: 'SUCCEEDED' });
    const dup = await hook({ id: 'evt_1', ref: lastRef, outcome: 'SUCCEEDED', amount: 4200, currency: 'USD' });
    expect(dup.body.data.duplicate).toBe(true);
    const detail = (await customer.get(`/orders/${order.id}`)).body.data;
    expect(detail.status).toBe('PAID');
    expect(detail.payments.filter((p: { status: string }) => p.status === 'SUCCEEDED')).toHaveLength(1);

    // an amount that does not match is never accepted
    await customer.post('/cart/items', { productId: product.id, quantity: 1 });
    const order2 = (await customer.post('/orders/checkout', { fulfilmentMethod: 'COLLECTION', paymentMethod: 'GATEWAY' })).body.data;
    await customer.post('/payments/checkout', { payableType: 'SALES_ORDER', payableId: order2.id });
    const tampered = await hook({ id: 'evt_2', ref: lastRef, outcome: 'SUCCEEDED', amount: 1, currency: 'USD' });
    expect(tampered.body.data.status).toBe('FAILED');
    expect((await customer.get(`/orders/${order2.id}`)).body.data.status).toBe('PENDING_PAYMENT');
  });

  it('verifies real Stripe webhook signatures', async () => {
    const secret = 'whsec_test_secret';
    const gateway = new StripeGateway('sk_test_dummy', secret);
    const payload = JSON.stringify({
      id: 'evt_test_1', object: 'event', type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_123', object: 'checkout.session', payment_status: 'paid', amount_total: 4200, currency: 'usd' } },
    });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    const event = await gateway.parseWebhook(Buffer.from(payload), { 'stripe-signature': header });
    expect(event).toMatchObject({ eventId: 'evt_test_1', providerReference: 'cs_test_123', outcome: 'SUCCEEDED', amountMinor: 4200, currency: 'USD' });
    await expect(gateway.parseWebhook(Buffer.from(payload), { 'stripe-signature': 't=1,v1=deadbeef' })).rejects.toThrow();
  });
});
