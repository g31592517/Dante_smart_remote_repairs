import { describe, expect, it } from 'vitest';
import { acceptedAndAssigned, anon, capturedEmails, categoryId, db, registerCustomer, staff, supportRequestBody } from './helpers.js';
import { dispatchPendingDeliveries } from '../src/modules/notifications/notifications.service.js';

/**
 * ACCEPTANCE TEST 1 — Remote software support.
 * A customer registers, submits an e-mail configuration problem, receives a reference, gets a technician,
 * provides their AnyDesk ID, authorises the session, and receives a completion report.
 */
describe('Acceptance 1: remote software support with AnyDesk', () => {
  it('runs the full remote support journey', async () => {
    const customer = await registerCustomer();
    const tech = await staff.tech1();
    const manager = await staff.manager();

    // submit
    const created = await customer.post('/requests', supportRequestBody({ categoryId: await categoryId('Email configuration') }));
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data.reference).toMatch(/^SR-\d{4}-\d{6}$/);
    expect(created.body.data.status).toBe('SUBMITTED');
    const mine = await customer.get('/requests');
    expect(mine.body.data.map((r: { id: number }) => r.id)).toContain(id);

    // confirmation notification + e-mail
    await dispatchPendingDeliveries();
    const notes = await customer.get('/notifications');
    expect(notes.body.data.items.some((n: { type: string }) => n.type === 'REQUEST_SUBMITTED')).toBe(true);
    expect(capturedEmails.some((e) => e.to === customer.email && e.subject.includes(created.body.data.reference))).toBe(true);

    // review + assign
    expect((await manager.post(`/requests/${id}/review`, { decision: 'ACCEPT' })).body.data.status).toBe('ACCEPTED');
    const assigned = await manager.post(`/requests/${id}/assign`, { technicianUserId: tech.userId });
    expect(assigned.body.data.status).toBe('ASSIGNED');
    expect(assigned.body.data.technician.id).toBe(tech.userId);

    // technician asks for a remote session
    const session = await tech.post('/remote-sessions', { supportRequestId: id, instructions: 'Please open AnyDesk' });
    expect(session.status).toBe(201);
    expect(session.body.data.status).toBe('REQUESTED');
    expect(session.body.data.anydeskUrl).toBeUndefined();
    const sid = session.body.data.id;

    // the technician cannot connect before the customer authorises
    const early = await tech.post(`/remote-sessions/${sid}/initiate`);
    expect(early.status).toBe(409);

    // customer sees instructions, the configurable download URL and the consent text
    const view = await customer.get(`/requests/${id}`);
    expect(view.body.data.status).toBe('AWAITING_CUSTOMER');
    expect(view.body.data.anydeskDownloadUrl).toBe('https://anydesk.com/en/downloads');
    expect(view.body.data.remoteConsent.text.length).toBeGreaterThan(50);

    // passwords are rejected; consent is mandatory
    expect((await customer.post(`/remote-sessions/${sid}/authorize`, { anydeskAddress: 'MyPassw0rd!', consent: true, consentVersion: 'remote-v1' })).status).toBe(400);
    expect((await customer.post(`/remote-sessions/${sid}/authorize`, { anydeskAddress: '123 456 789', consent: false, consentVersion: 'remote-v1' })).status).toBe(400);
    // staff cannot authorise on the customer's behalf
    expect((await tech.post(`/remote-sessions/${sid}/authorize`, { anydeskAddress: '123456789', consent: true, consentVersion: 'remote-v1' })).status).toBe(403);

    const auth = await customer.post(`/remote-sessions/${sid}/authorize`, { anydeskAddress: '123 456 789', consent: true, consentVersion: 'remote-v1' });
    expect(auth.status).toBe(200);
    expect(auth.body.data.status).toBe('AUTHORIZED');
    expect(auth.body.data.anydeskUrl).toBeUndefined(); // customer view never carries the launch link

    // consent stored with timestamp and the exact text shown
    const consent = await db('customer_consents').where({ user_id: customer.userId, consent_type: 'REMOTE_ACCESS', subject_id: sid }).first();
    expect(consent.granted_at).toBeTruthy();
    expect(consent.consent_text).toContain('AnyDesk');

    // technician launches AnyDesk with the documented URL handler
    const init = await tech.post(`/remote-sessions/${sid}/initiate`);
    expect(init.status).toBe(200);
    expect(init.body.data.anydeskUrl).toBe('anydesk:123456789');
    const afterInit = await tech.get(`/requests/${id}`);
    expect(afterInit.body.data.status).toBe('DIAGNOSIS_IN_PROGRESS');
    expect(afterInit.body.data.remoteSessions[0].status).toBe('INITIATED');

    // customer accepted in AnyDesk → technician marks active, then completes with manual evidence (no API licence)
    expect((await tech.post(`/remote-sessions/${sid}/status`, { status: 'ACTIVE' })).body.data.status).toBe('ACTIVE');
    const start = new Date(Date.now() - 25 * 60_000).toISOString();
    const end = new Date().toISOString();
    const done = await tech.post(`/remote-sessions/${sid}/complete`, {
      outcome: 'RESOLVED', workPerformed: 'Removed corrupted Outlook profile, re-added the mailbox with modern auth, verified send/receive.',
      anydeskSessionId: '987654321', startedAt: start, endedAt: end,
    });
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('COMPLETED');
    expect(done.body.data.evidence.source).toBe('MANUAL');
    expect(done.body.data.evidence.durationSeconds).toBeGreaterThanOrEqual(25 * 60 - 2);

    // cannot complete the request without a report
    expect((await tech.post(`/requests/${id}/status`, { status: 'COMPLETED' })).status).toBe(409);
    const report = await tech.put(`/repairs/${id}/report`, {
      originalProblem: 'Outlook password prompts', diagnosis: 'Corrupted profile after password change', actionsPerformed: 'Recreated profile',
      testingResults: 'Send/receive OK, no prompts for 10 minutes', recommendations: 'Use the authenticator app', outcome: 'RESOLVED',
    });
    expect(report.status).toBe(200);
    expect(report.body.data.report.remoteSessions).toHaveLength(1);
    expect(report.body.data.report.remoteSessions[0].anydeskSessionId).toBe('987654321');

    const completed = await tech.post(`/requests/${id}/status`, { status: 'COMPLETED', note: 'Resolved remotely' });
    expect(completed.status).toBe(200);
    expect(completed.body.data.status).toBe('COMPLETED');

    // customer receives the completion report in their history
    const final = await customer.get(`/requests/${id}`);
    expect(final.body.data.report.outcome).toBe('RESOLVED');
    expect(final.body.data.timeline.map((t: { type: string }) => t.type)).toEqual(
      expect.arrayContaining(['SUBMITTED', 'TECHNICIAN_ASSIGNED', 'REMOTE_REQUESTED', 'REMOTE_AUTHORIZED', 'REMOTE_COMPLETED', 'REPORT_SUBMITTED']),
    );
    // the remote access trail is audited
    const trail = await db('audit_logs').where({ entity_type: 'remote_session', entity_id: sid }).pluck('action');
    expect(trail).toEqual(expect.arrayContaining(['remote.requested', 'remote.authorized', 'remote.initiated', 'remote.active', 'remote.completed']));
  });

  it('lets the customer withdraw authorisation, which blocks the connection', async () => {
    const customer = await registerCustomer();
    const tech = await staff.tech1();
    const { id } = await acceptedAndAssigned(customer, supportRequestBody({ categoryId: await categoryId('Software installation') }), tech.userId);
    const sid = (await tech.post('/remote-sessions', { supportRequestId: id })).body.data.id;
    await customer.post(`/remote-sessions/${sid}/authorize`, { anydeskAddress: 'office-pc@ad', consent: true, consentVersion: 'remote-v1' });
    const revoked = await customer.post(`/remote-sessions/${sid}/revoke`, { reason: 'Not a good time' });
    expect(revoked.body.data.status).toBe('REVOKED');
    expect((await tech.post(`/remote-sessions/${sid}/initiate`)).status).toBe(409);
    const consent = await db('customer_consents').where({ subject_type: 'REMOTE_SESSION', subject_id: sid }).first();
    expect(consent.revoked_at).toBeTruthy();
    // a new session can be requested afterwards
    expect((await tech.post('/remote-sessions', { supportRequestId: id })).status).toBe(201);
  });

  it('refuses remote sessions for requests that have not been accepted and assigned', async () => {
    const customer = await registerCustomer();
    const manager = await staff.manager();
    const id = (await customer.post('/requests', supportRequestBody({ categoryId: await categoryId('Email configuration') }))).body.data.id;
    expect((await manager.post('/remote-sessions', { supportRequestId: id })).status).toBe(409);
    expect((await anon.post('/remote-sessions', { supportRequestId: id })).status).toBe(401);
  });
});
