import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { acceptedAndAssigned, anon, app, categoryId, createProduct, db, login, registerCustomer, staff, supportRequestBody } from './helpers.js';
import { createApp } from '../src/app.js';

// smallest valid PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** ACCEPTANCE TEST 6 — Access control and data isolation. */
describe('Acceptance 6: access control', () => {
  it('customers cannot reach other customers\' requests, attachments, orders or payments', async () => {
    const alice = await registerCustomer();
    const bob = await registerCustomer();
    const tech = await staff.tech1();
    const { id } = await acceptedAndAssigned(alice, supportRequestBody({ categoryId: await categoryId('Email configuration') }), tech.userId);

    const up = await request(app).post('/api/v1/attachments').set('Authorization', `Bearer ${alice.token}`)
      .field('supportRequestId', String(id)).field('context', 'REQUEST').attach('files', PNG, 'screenshot.png');
    expect(up.status).toBe(201);
    const attId = up.body.data[0].id;

    expect((await bob.get(`/requests/${id}`)).status).toBe(404);
    expect((await bob.get(`/requests/${id}/messages`)).status).toBe(404);
    expect((await bob.post(`/requests/${id}/messages`, { body: 'hi' })).status).toBe(404);
    expect((await bob.get(`/attachments/${attId}`)).status).toBe(404);
    expect((await alice.get(`/attachments/${attId}`)).status).toBe(200);

    const store = await staff.store();
    const p = await createProduct(store, 2);
    await alice.post('/cart/items', { productId: p.id, quantity: 1 });
    const order = (await alice.post('/orders/checkout', { fulfilmentMethod: 'COLLECTION', paymentMethod: 'CASH' })).body.data;
    expect((await bob.get(`/orders/${order.id}`)).status).toBe(404);
    expect((await bob.post('/payments/claims', { payableType: 'SALES_ORDER', payableId: order.id, method: 'BANK_TRANSFER', amountMinor: 1, reference: 'x123' })).status).toBe(404);
    expect((await bob.get('/payments')).body.data).toHaveLength(0);
    // customers cannot use staff endpoints
    expect((await alice.post('/payments/record', { payableType: 'SALES_ORDER', payableId: order.id, method: 'CASH', amountMinor: 100, reference: 'r1' })).status).toBe(403);
    expect((await alice.post(`/orders/${order.id}/status`, { status: 'PROCESSING' })).status).toBe(403);
  });

  it('confidential technician notes, private diagnostics and internal files never reach the customer', async () => {
    const customer = await registerCustomer();
    const tech = await staff.tech1();
    const { id } = await acceptedAndAssigned(customer, supportRequestBody({ categoryId: await categoryId('Virus and malware') }), tech.userId);
    await tech.post(`/requests/${id}/notes`, { body: 'Customer admin password is on a sticky note — advise them' });
    await tech.post(`/repairs/${id}/diagnostics`, { findings: 'Internal suspicion: piracy-related malware', visibleToCustomer: false });
    await tech.post(`/requests/${id}/updates`, { message: 'Internal: escalate if not resolved by Friday', visibleToCustomer: false });
    const internal = await request(app).post('/api/v1/attachments').set('Authorization', `Bearer ${tech.token}`)
      .field('supportRequestId', String(id)).field('context', 'INTERNAL').attach('files', PNG, 'internal.png');
    expect(internal.status).toBe(201);

    expect((await customer.get(`/requests/${id}/notes`)).status).toBe(403);
    const view = JSON.stringify((await customer.get(`/requests/${id}`)).body.data);
    expect(view).not.toContain('sticky note');
    expect(view).not.toContain('piracy');
    expect(view).not.toContain('escalate');
    expect(view).not.toContain('internal.png');
    expect((await customer.get(`/attachments/${internal.body.data[0].id}`)).status).toBe(404);
    // customers may not upload into staff-only contexts
    const sneaky = await request(app).post('/api/v1/attachments').set('Authorization', `Bearer ${customer.token}`)
      .field('supportRequestId', String(id)).field('context', 'INTERNAL').attach('files', PNG, 'x.png');
    expect(sneaky.status).toBe(403);
    const staffView = JSON.stringify((await tech.get(`/requests/${id}`)).body.data);
    expect(staffView).toContain('piracy');
  });

  it('technicians only see their own jobs and cannot use administrative functions', async () => {
    const customer = await registerCustomer();
    const tech1 = await staff.tech1();
    const tech2 = await staff.tech2();
    const { id } = await acceptedAndAssigned(customer, supportRequestBody({ categoryId: await categoryId('Email configuration') }), tech1.userId);
    expect((await tech2.get(`/requests/${id}`)).status).toBe(404);
    expect((await tech2.get('/requests')).body.data.map((r: { id: number }) => r.id)).not.toContain(id);
    expect((await tech1.post(`/requests/${id}/assign`, { technicianUserId: tech2.userId })).status).toBe(403);
    expect((await tech1.post(`/requests/${id}/review`, { decision: 'ACCEPT' })).status).toBe(403);
    expect((await tech1.post(`/requests/${id}/status`, { status: 'CLOSED' })).status).toBe(403);
    expect((await tech1.patch('/settings', { businessName: 'Hacked' })).status).toBe(403);
    expect((await tech1.get('/staff/users?kind=staff')).status).toBe(403);
    expect((await tech1.post('/inventory/adjustments', { productId: 1, quantityDelta: 100, reason: 'x' })).status).toBe(403);
    expect((await tech1.get('/reports/revenue')).status).toBe(403);
    expect((await tech1.get('/reports/audit')).status).toBe(403);
  });

  it('inventory and finance roles are confined to their areas', async () => {
    const customer = await registerCustomer();
    const tech = await staff.tech1();
    const { id } = await acceptedAndAssigned(customer, supportRequestBody({ categoryId: await categoryId('Email configuration') }), tech.userId);
    const store = await staff.store();
    const finance = await staff.finance();
    // the store manager does not see support records or confidential notes
    expect((await store.get('/requests')).status).toBe(403);
    expect((await store.get(`/requests/${id}`)).status).toBe(403);
    expect((await store.get(`/requests/${id}/notes`)).status).toBe(403);
    expect((await store.post('/payments/record', { payableType: 'SUPPORT_REQUEST', payableId: id, method: 'CASH', amountMinor: 1, reference: 'x1' })).status).toBe(403);
    expect((await store.get('/reports/inventory-movements')).status).toBe(200);
    // finance can record payments and see financial reports but cannot touch stock or support records
    expect((await finance.post('/inventory/adjustments', { productId: 1, quantityDelta: 5, reason: 'x' })).status).toBe(403);
    expect((await finance.get(`/requests/${id}`)).status).toBe(403);
    expect((await finance.get('/reports/revenue')).status).toBe(200);
    expect((await finance.post('/catalog/products', {})).status).toBe(403);
  });

  it('requires authentication, and revoking roles or deactivating users takes effect immediately', async () => {
    expect((await anon.get('/requests')).status).toBe(401);
    expect((await request(app).get('/api/v1/requests').set('Authorization', 'Bearer not.a.token')).status).toBe(401);
    const admin = await staff.admin();
    const customer = await registerCustomer();
    expect((await customer.get('/auth/me')).status).toBe(200);
    expect((await admin.put(`/staff/users/${customer.userId}/active`, { active: false })).status).toBe(200);
    expect((await customer.get('/auth/me')).status).toBe(401); // existing access token stops working
    expect((await admin.put(`/staff/users/${admin.userId}/active`, { active: false })).status).toBe(409); // cannot lock yourself out
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const customer = await registerCustomer();
    const first = await request(app).post('/api/v1/auth/login').set('X-Client', 'mobile').send({ email: customer.email, password: 'Str0ngPassword!' });
    const rt1 = first.body.data.tokens.refreshToken;
    const second = await request(app).post('/api/v1/auth/refresh').set('X-Client', 'mobile').send({ refreshToken: rt1 });
    expect(second.status).toBe(200);
    const rt2 = second.body.data.tokens.refreshToken;
    expect(rt2).not.toBe(rt1);
    // replaying the old token revokes the whole family, including the newest token
    expect((await request(app).post('/api/v1/auth/refresh').set('X-Client', 'mobile').send({ refreshToken: rt1 })).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/refresh').set('X-Client', 'mobile').send({ refreshToken: rt2 })).status).toBe(401);
    expect(await db('audit_logs').where({ action: 'auth.refresh_reuse_detected', entity_id: customer.userId }).first()).toBeTruthy();
  });

  it('browser sessions use an httpOnly SameSite=Strict cookie, never exposing the refresh token to scripts', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'jane@example.com', password: 'DemoPass123!' });
    expect(res.status).toBe(200);
    expect(res.body.data.tokens.refreshToken).toBeUndefined();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/dante_rt=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    // cookie-based refresh from a foreign origin is refused
    const foreign = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie.split(';')[0]!).set('Origin', 'https://evil.example');
    expect(foreign.status).toBe(403);
    const same = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie.split(';')[0]!).set('Origin', 'http://localhost:5173');
    expect(same.status).toBe(200);
  });

  it('locks an account after repeated failed sign-ins and rate-limits auth endpoints', async () => {
    const customer = await registerCustomer();
    for (let i = 0; i < 5; i++) await anon.post('/auth/login', { email: customer.email, password: 'wrong-password-1' });
    const locked = await anon.post('/auth/login', { email: customer.email, password: 'Str0ngPassword!' });
    expect(locked.status).toBe(429);

    const limited = createApp({ authRateLimit: 3 });
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await request(limited).post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'x' })).status);
    expect(codes).toEqual([401, 401, 401, 429]);
    // unknown e-mails get the same answer as wrong passwords (no account enumeration)
    const unknown = await anon.post('/auth/login', { email: 'nobody-at-all@example.com', password: 'whatever' });
    expect(unknown.body.error.message).toBe('Incorrect e-mail address or password');
  });

  it('rejects dangerous uploads by content, not by name', async () => {
    const customer = await registerCustomer();
    const id = (await customer.post('/requests', supportRequestBody({ categoryId: await categoryId('Email configuration') }))).body.data.id;
    const send = (buf: Buffer, name: string) => request(app).post('/api/v1/attachments').set('Authorization', `Bearer ${customer.token}`)
      .field('supportRequestId', String(id)).attach('files', buf, name);
    expect((await send(Buffer.from('<html><script>alert(1)</script></html>'), 'error.png')).status).toBe(415);
    expect((await send(Buffer.from('<svg onload="alert(1)"></svg>'), 'logo.svg')).status).toBe(415);
    expect((await send(Buffer.from('MZ\x90\x00\x03'), 'tool.pdf')).status).toBe(415);
    expect((await send(Buffer.from('Error 0x8004010F: Outlook data file cannot be accessed'), 'outlook.log')).status).toBe(201);
    const ok = await send(PNG, 'photo.png');
    expect(ok.status).toBe(201);
    const file = await customer.get(`/attachments/${ok.body.data[0].id}`);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
  });

  it('demo staff accounts exist with the expected roles', async () => {
    const admin = await login('admin@dante.local');
    const me = (await admin.get('/auth/me')).body.data;
    expect(me.roles).toEqual(['ADMIN']);
    expect(me.permissions).toContain('settings.manage');
  });
});
