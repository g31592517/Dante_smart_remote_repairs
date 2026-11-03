import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, createHmac } from 'node:crypto';
import { acceptedAndAssigned, categoryId, db, registerCustomer, staff, supportRequestBody } from './helpers.js';
import { AnyDeskClient, setAnyDeskClientForTests, signAnyDeskRequest } from '../src/modules/remote/anydesk.client.js';

const LICENSE = '99999';
const PASSWORD = 'test-api-password';

describe('AnyDesk REST signing', () => {
  // Expected values computed independently with Python's hmac/hashlib using the algorithm in
  // AnyDesk's official client (github.com/anydesk/rest-api, anydesk/api.py :: API.auth).
  it('matches the reference implementation for a PATCH with a body', () => {
    expect(signAnyDeskRequest({
      method: 'PATCH', resource: '/sessions/1234567', body: '{"comment":"Support request SR-2026-000001"}', licenseId: LICENSE, apiPassword: PASSWORD, timestamp: 1700000000,
    })).toBe('AD 99999:1700000000:xSpKqDhDOYYvOaWZQ2acF45TY7o=');
  });
  it('signs the query string as part of the resource for GETs', () => {
    expect(signAnyDeskRequest({
      method: 'GET', resource: '/sessions?from=1700000000&sort=start-time', licenseId: LICENSE, apiPassword: PASSWORD, timestamp: 1700000000,
    })).toBe('AD 99999:1700000000:j0UcQlmpWnV+CEARRdXytt3Fjq0=');
  });
});

/**
 * A local stand-in for the AnyDesk API that VERIFIES signatures the way AnyDesk does and returns
 * payloads with the field names used by the official client library.
 */
function mockAnyDesk() {
  const sessions: Record<string, unknown>[] = [];
  const comments: Record<string, string> = {};
  const closed: string[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const [, lic, ts, token] = /^AD (\d+):(\d+):(.+)$/.exec(req.headers.authorization ?? '') ?? [];
      const contentHash = createHash('sha1').update(body).digest('base64');
      const expected = createHmac('sha1', PASSWORD).update(`${req.method}\n${req.url}\n${ts}\n${contentHash}`).digest('base64');
      if (lic !== LICENSE || token !== expected) {
        res.writeHead(401).end(JSON.stringify({ error: 'bad signature' }));
        return;
      }
      const send = (o: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o));
      if (req.url === '/sysinfo') return send({ name: 'Test licence', 'api-ver': '1.4', license: { name: 'Advanced', expires: 1900000000, 'max-sessions': 3 } });
      if (req.method === 'GET' && req.url!.startsWith('/sessions?')) return send({ count: sessions.length, list: sessions });
      const m = /^\/sessions\/([^/]+)(\/action)?$/.exec(req.url!);
      if (m && req.method === 'PATCH') { comments[m[1]!] = JSON.parse(body).comment; return send({}); }
      if (m && req.method === 'POST' && m[2]) { closed.push(m[1]!); return send({}); }
      if (m && req.method === 'GET') return send(sessions.find((s) => s.sid === m[1]) ?? {});
      res.writeHead(404).end('{}');
    });
  });
  return { server, sessions, comments, closed };
}

describe('AnyDesk REST integration (mock AnyDesk server)', () => {
  const mock = mockAnyDesk();
  let base = '';
  beforeAll(async () => {
    await new Promise<void>((r) => mock.server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => mock.server.close(() => r())));
  afterEach(() => setAnyDeskClientForTests(null));

  it('reports connectivity and rejects wrong credentials', async () => {
    setAnyDeskClientForTests(new AnyDeskClient(base, LICENSE, PASSWORD));
    const admin = await staff.admin();
    const status = await admin.get('/remote-sessions/anydesk/status');
    expect(status.body.data).toMatchObject({ connected: true, name: 'Test licence', apiVersion: '1.4', license: 'Advanced' });
    setAnyDeskClientForTests(new AnyDeskClient(base, LICENSE, 'wrong-password'));
    const bad = await admin.get('/remote-sessions/anydesk/status');
    expect(bad.status).toBe(503);
    expect(bad.body.error.code).toBe('INTEGRATION_UNAVAILABLE');
  });

  it('syncs the real session, marks it active, records API evidence on completion and labels it in AnyDesk', async () => {
    setAnyDeskClientForTests(new AnyDeskClient(base, LICENSE, PASSWORD));
    const customer = await registerCustomer();
    const tech = await staff.tech1();
    const { id, reference } = await acceptedAndAssigned(customer, supportRequestBody({ categoryId: await categoryId('Printer configuration') }), tech.userId);
    const sid = (await tech.post('/remote-sessions', { supportRequestId: id })).body.data.id;
    await customer.post(`/remote-sessions/${sid}/authorize`, { anydeskAddress: '555 666 777', consent: true, consentVersion: 'remote-v1' });
    await tech.post(`/remote-sessions/${sid}/initiate`);

    const now = Math.floor(Date.now() / 1000);
    // an unrelated session and the real one (outgoing from the technician's licensed client to the customer)
    mock.sessions.push(
      { sid: 'AAA', from: { cid: '111222333', alias: null }, to: { cid: '999888777', alias: null }, active: true, 'start-time': now, 'end-time': null, duration: null, comment: null },
      { sid: 'S-42', from: { cid: '111222333', alias: 'tech@ad' }, to: { cid: '555666777', alias: null }, active: true, 'start-time': now + 5, 'end-time': null, duration: null, comment: null },
    );
    const synced = await tech.post(`/remote-sessions/${sid}/sync`);
    expect(synced.body.data.matched).toBe(true);
    expect(synced.body.data.remoteSession.status).toBe('ACTIVE'); // API confirmed the customer accepted
    expect(synced.body.data.remoteSession.evidence).toMatchObject({ source: 'ANYDESK_API', anydeskSessionId: 'S-42' });

    Object.assign(mock.sessions[1]!, { active: false, 'end-time': now + 905, duration: 900 });
    const done = await tech.post(`/remote-sessions/${sid}/complete`, { outcome: 'RESOLVED', workPerformed: 'Reinstalled the printer driver and set the default tray' });
    expect(done.body.data.evidence).toMatchObject({ source: 'ANYDESK_API', anydeskSessionId: 'S-42', durationSeconds: 900 });
    expect(mock.comments['S-42']).toBe(`Support request ${reference}`);
  });

  it('closes the AnyDesk session when the customer withdraws consent', async () => {
    setAnyDeskClientForTests(new AnyDeskClient(base, LICENSE, PASSWORD));
    const customer = await registerCustomer();
    const tech = await staff.tech1();
    const { id } = await acceptedAndAssigned(customer, supportRequestBody({ categoryId: await categoryId('Printer configuration') }), tech.userId);
    const sid = (await tech.post('/remote-sessions', { supportRequestId: id })).body.data.id;
    await customer.post(`/remote-sessions/${sid}/authorize`, { anydeskAddress: '444555666', consent: true, consentVersion: 'remote-v1' });
    await tech.post(`/remote-sessions/${sid}/initiate`);
    mock.sessions.push({ sid: 'S-77', from: { cid: '111222333', alias: null }, to: { cid: '444555666', alias: null }, active: true, 'start-time': Math.floor(Date.now() / 1000), 'end-time': null, duration: null, comment: null });
    await customer.post(`/remote-sessions/${sid}/revoke`, { reason: 'Stop please' });
    expect(mock.closed).toContain('S-77');
  });

  it('falls back to the manual workflow when the API is not configured', async () => {
    setAnyDeskClientForTests(null);
    const customer = await registerCustomer();
    const tech = await staff.tech1();
    const { id } = await acceptedAndAssigned(customer, supportRequestBody({ categoryId: await categoryId('Printer configuration') }), tech.userId);
    const sid = (await tech.post('/remote-sessions', { supportRequestId: id })).body.data.id;
    await customer.post(`/remote-sessions/${sid}/authorize`, { anydeskAddress: '123123123', consent: true, consentVersion: 'remote-v1' });
    expect((await tech.post(`/remote-sessions/${sid}/initiate`)).body.data.anydeskUrl).toBe('anydesk:123123123');
    const sync = await tech.post(`/remote-sessions/${sid}/sync`);
    expect(sync.status).toBe(503);
    const done = await tech.post(`/remote-sessions/${sid}/complete`, { outcome: 'FOLLOW_UP_REQUIRED', workPerformed: 'Partial fix; follow-up booked' });
    expect(done.body.data.evidence.source).toBe('NONE');
    const row = await db('remote_sessions').where({ id: sid }).first('status', 'initiated_by');
    expect(row).toEqual({ status: 'COMPLETED', initiated_by: tech.userId });
  });
});

describe('quotation validity', () => {
  it('refuses to approve an expired quotation', async () => {
    const customer = await registerCustomer();
    const tech = await staff.tech2();
    const { id } = await acceptedAndAssigned(customer, supportRequestBody({ categoryId: await categoryId('Software installation') }), tech.userId);
    await tech.post(`/requests/${id}/status`, { status: 'DIAGNOSIS_IN_PROGRESS' });
    const q = (await tech.post(`/repairs/${id}/quotations`, { items: [{ itemType: 'SERVICE', description: 'Licensed install', quantity: 1, unitPriceMinor: 2000 }] })).body.data.quotations[0];
    expect(q.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await db('quotations').where({ id: q.id }).update({ valid_until: '2020-01-01' });
    const r = await customer.post(`/repairs/quotations/${q.id}/decision`, { decision: 'APPROVE' });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/expired/);
  });
});
