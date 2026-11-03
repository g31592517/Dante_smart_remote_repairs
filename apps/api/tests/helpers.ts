import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { createApp } from '../src/app.js';
import { db } from '../src/db/knex.js';
import { ensureStorageDirs } from '../src/core/storage.js';
import { DEMO_PASSWORD } from '../src/db/seeds/demo.js';
import { capturedEmails } from '../src/modules/notifications/channels.js';

export const app = createApp();
await ensureStorageDirs();
export { db, capturedEmails };

export const uid = () => randomBytes(4).toString('hex');

export interface Client {
  token: string;
  userId: number;
  get(path: string): request.Test;
  post(path: string, body?: unknown): request.Test;
  put(path: string, body?: unknown): request.Test;
  patch(path: string, body?: unknown): request.Test;
  del(path: string): request.Test;
}

function client(token: string, userId: number): Client {
  const auth = (t: request.Test) => t.set('Authorization', `Bearer ${token}`);
  return {
    token,
    userId,
    get: (p) => auth(request(app).get(`/api/v1${p}`)),
    post: (p, b) => auth(request(app).post(`/api/v1${p}`)).send(b as object),
    put: (p, b) => auth(request(app).put(`/api/v1${p}`)).send(b as object),
    patch: (p, b) => auth(request(app).patch(`/api/v1${p}`)).send(b as object),
    del: (p) => auth(request(app).delete(`/api/v1${p}`)),
  };
}

export const anon = {
  get: (p: string) => request(app).get(`/api/v1${p}`),
  post: (p: string, b?: unknown) => request(app).post(`/api/v1${p}`).send(b as object),
};

export async function login(email: string, password = DEMO_PASSWORD): Promise<Client> {
  const res = await request(app).post('/api/v1/auth/login').set('X-Client', 'mobile').send({ email, password });
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return client(res.body.data.tokens.accessToken, res.body.data.user.id);
}

export const staff = {
  admin: () => login('admin@dante.local'),
  manager: () => login('manager@dante.local'),
  tech1: () => login('tech1@dante.local'),
  tech2: () => login('tech2@dante.local'),
  store: () => login('store@dante.local'),
  finance: () => login('finance@dante.local'),
};

export async function registerCustomer(overrides: Record<string, unknown> = {}): Promise<Client & { email: string }> {
  const email = `cust-${uid()}@example.com`;
  const res = await request(app).post('/api/v1/auth/register').set('X-Client', 'mobile').send({
    accountType: 'INDIVIDUAL', firstName: 'Test', lastName: 'Customer', email, phone: '+254 700 123456', password: 'Str0ngPassword!', acceptTerms: true,
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...client(res.body.data.tokens.accessToken, res.body.data.user.id), email: (overrides.email as string) ?? email };
}

export async function categoryId(name: string): Promise<number> {
  const c = await db('service_categories').where('name', 'like', `${name}%`).first('id');
  return c.id;
}

export function supportRequestBody(overrides: Record<string, unknown> = {}) {
  return {
    serviceType: 'REMOTE_SUPPORT', title: 'Outlook keeps asking for my password', description: 'Since yesterday Outlook prompts for the password every few minutes and mail does not sync.',
    errorMessages: 'Need password', urgency: 'NORMAL', preferredContact: 'EMAIL', contactName: 'Test Customer', contactEmail: 'test@example.com',
    contactPhone: '+254 700 123456', ...overrides,
  };
}

/** Creates a product with a known stock level through the API (isolates tests from each other). */
export async function createProduct(store: Client, stock: number, priceMinor = 5000, extra: Record<string, unknown> = {}) {
  const sku = `TST-${uid()}`.toUpperCase();
  const cat = await db('product_categories').where({ slug: 'storage' }).first('id');
  const res = await store.post('/catalog/products', {
    sku, name: `Test product ${sku}`, categoryId: cat.id, description: 'Test product', priceMinor, condition: 'NEW', reorderLevel: 1,
    specifications: { Capacity: '512 GB' }, isSparePart: true, ...extra,
  });
  if (res.status !== 201) throw new Error(`createProduct failed: ${JSON.stringify(res.body)}`);
  if (stock > 0) {
    const adj = await store.post('/inventory/adjustments', { productId: res.body.data.id, quantityDelta: stock, reason: 'Test stock' });
    if (adj.status !== 200) throw new Error(`adjust failed: ${JSON.stringify(adj.body)}`);
  }
  return res.body.data as { id: number; sku: string; name: string; priceMinor: number };
}

export async function stockOf(productId: number) {
  const r = await db('inventory').where({ product_id: productId }).first();
  return { onHand: r.quantity_on_hand as number, reserved: r.quantity_reserved as number, available: (r.quantity_on_hand - r.quantity_reserved) as number };
}

/** Walk a fresh request through review → accept → assign (manager), returning its id. */
export async function acceptedAndAssigned(customer: Client, body: Record<string, unknown>, techUserId: number) {
  const manager = await staff.manager();
  const created = await customer.post('/requests', body);
  if (created.status !== 201) throw new Error(`create request failed: ${JSON.stringify(created.body)}`);
  const id = created.body.data.id as number;
  const rev = await manager.post(`/requests/${id}/review`, { decision: 'ACCEPT' });
  if (rev.status !== 200) throw new Error(`review failed: ${JSON.stringify(rev.body)}`);
  const asg = await manager.post(`/requests/${id}/assign`, { technicianUserId: techUserId });
  if (asg.status !== 200) throw new Error(`assign failed: ${JSON.stringify(asg.body)}`);
  return { id, reference: created.body.data.reference as string, manager };
}
