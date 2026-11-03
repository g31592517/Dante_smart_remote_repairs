import { describe, expect, it } from 'vitest';
import { anon, capturedEmails, categoryId, db, registerCustomer, staff, supportRequestBody, uid } from './helpers.js';
import { dispatchPendingDeliveries } from '../src/modules/notifications/notifications.service.js';

/** ACCEPTANCE TEST 5 — Corporate account with employees, devices and isolated organisation history. */
describe('Acceptance 5: corporate account', () => {
  it('org admin onboards employees; members raise requests; the org sees its own history only', async () => {
    const orgAdmin = await registerCustomer({ accountType: 'CORPORATE', organizationName: `Globex ${uid()}`, department: 'IT' });
    const me = (await orgAdmin.get('/auth/me')).body.data;
    expect(me.organization.orgRole).toBe('ORG_ADMIN');

    // invite two employees; they set their own passwords through one-time links
    const invites: { email: string; token: string }[] = [];
    for (const dept of ['Finance', 'Sales']) {
      const email = `emp-${uid()}@globex.example`;
      const r = await orgAdmin.post('/organizations/mine/members', { email, firstName: dept, lastName: 'Employee', department: dept, orgRole: 'ORG_MEMBER' });
      expect(r.status).toBe(201);
      expect(r.body.data.invitePending).toBe(true);
      await dispatchPendingDeliveries();
      const mail = capturedEmails.filter((e) => e.to === email).at(-1)!;
      const token = decodeURIComponent(/token=([^\s&]+)/.exec(mail.text)![1]!);
      invites.push({ email, token });
    }
    // the invite link works once
    const accept = await anon.post('/auth/accept-invite', { token: invites[0]!.token, password: 'EmployeePass123' });
    expect(accept.status).toBe(200);
    expect(accept.body.data.user.organization.orgRole).toBe('ORG_MEMBER');
    expect((await anon.post('/auth/accept-invite', { token: invites[0]!.token, password: 'EmployeePass123' })).status).toBe(400);
    await anon.post('/auth/accept-invite', { token: invites[1]!.token, password: 'EmployeePass456' });

    const { login } = await import('./helpers.js');
    const empA = await login(invites[0]!.email, 'EmployeePass123');
    const empB = await login(invites[1]!.email, 'EmployeePass456');

    // shared organisation devices
    const dev = await orgAdmin.post('/account/devices', { deviceType: 'PRINTER', manufacturer: 'HP', model: 'LaserJet M404', department: 'Finance', assetTag: 'GLX-PR-1' });
    expect(dev.body.data.organizationId).toBe(me.organization.id);
    expect((await empA.get('/account/devices')).body.data.map((d: { id: number }) => d.id)).toContain(dev.body.data.id);
    // members cannot edit shared assets
    expect((await empA.patch(`/account/devices/${dev.body.data.id}`, { location: 'Basement' })).status).toBe(403);

    // authorised employees submit requests against org devices
    const rA = await empA.post('/requests', supportRequestBody({ serviceType: 'ONSITE_SUPPORT', categoryId: await categoryId('Printer configuration'), title: 'Printer offline', siteAddress: 'HQ floor 2', deviceId: dev.body.data.id, department: 'Finance' }));
    expect(rA.status).toBe(201);
    const rB = await empB.post('/requests', supportRequestBody({ categoryId: await categoryId('Email configuration'), title: 'Shared mailbox missing' }));
    expect(rB.status).toBe(201);

    // org admin sees the whole organisation's requests; members see only their own
    const adminList = (await orgAdmin.get('/requests')).body.data.map((r: { id: number }) => r.id);
    expect(adminList).toEqual(expect.arrayContaining([rA.body.data.id, rB.body.data.id]));
    expect((await empA.get('/requests')).body.data.map((r: { id: number }) => r.id)).toEqual([rA.body.data.id]);
    expect((await empA.get(`/requests/${rB.body.data.id}`)).status).toBe(404);
    expect((await orgAdmin.get(`/requests/${rB.body.data.id}`)).status).toBe(200);
    expect((await orgAdmin.get(`/account/devices/${dev.body.data.id}/history`)).body.data[0].id).toBe(rA.body.data.id);

    // another customer (and another organisation) sees nothing of it
    const outsider = await registerCustomer({ accountType: 'CORPORATE', organizationName: `Initech ${uid()}` });
    expect((await outsider.get('/requests')).body.data).toHaveLength(0);
    expect((await outsider.get(`/requests/${rA.body.data.id}`)).status).toBe(404);
    expect((await outsider.get(`/account/devices/${dev.body.data.id}/history`)).status).toBe(404);

    // staff see the organisation with its members and open requests
    const manager = await staff.manager();
    const orgs = (await manager.get(`/organizations?q=Globex`)).body.data;
    const org = orgs.find((o: { id: number }) => o.id === me.organization.id);
    expect(org.memberCount).toBe(3);
    expect(org.openRequests).toBe(2);

    // an organisation always keeps an administrator
    const myMembership = (await orgAdmin.get('/organizations/mine')).body.data.members.find((m: { email: string }) => m.email === orgAdmin.email);
    expect((await orgAdmin.patch(`/organizations/mine/members/${myMembership.id}`, { orgRole: 'ORG_MEMBER' })).status).toBe(409);

    // deactivated members lose access to organisation data immediately
    const memberA = (await orgAdmin.get('/organizations/mine')).body.data.members.find((m: { email: string }) => m.email === invites[0]!.email);
    await orgAdmin.patch(`/organizations/mine/members/${memberA.id}`, { active: false });
    expect((await empA.get('/account/devices')).body.data.map((d: { id: number }) => d.id)).not.toContain(dev.body.data.id);
    const rows = await db('organization_members').where({ id: memberA.id }).first('is_active');
    expect(rows.is_active).toBe(0);
  });
});
