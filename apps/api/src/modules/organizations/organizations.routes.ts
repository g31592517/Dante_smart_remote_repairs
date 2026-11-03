import { Router, type Request } from 'express';
import { inviteMemberSchema, organizationUpdateSchema, updateMemberSchema, PERMISSIONS } from '@dante/shared';
import { authenticate, requireAuth, requirePermission } from '../../core/auth.js';
import { audit, requestContext } from '../../core/audit.js';
import { conflict, forbidden, invalidState, notFound } from '../../core/errors.js';
import { created, idFrom, ok, pageMeta, parse } from '../../core/http.js';
import { db } from '../../db/knex.js';
import { createUserToken } from '../auth/auth.service.js';
import { notify } from '../notifications/notifications.service.js';
import { getSettings } from '../settings/settings.service.js';

function mapOrg(o: Record<string, any>) {
  return {
    id: o.id, name: o.name, registrationNo: o.registration_no, billingEmail: o.billing_email, phone: o.phone, address: o.address,
    centralBilling: !!o.central_billing, isActive: !!o.is_active, createdAt: o.created_at,
  };
}

async function members(orgId: number) {
  const rows = await db('organization_members as m')
    .join('users as u', 'u.id', 'm.user_id')
    .where('m.organization_id', orgId)
    .orderBy('u.first_name')
    .select('m.id', 'm.user_id', 'm.org_role', 'm.department', 'm.location', 'm.is_active', 'u.email', 'u.first_name', 'u.last_name', 'u.phone',
      db.raw('u.password_hash IS NULL as invite_pending'));
  return rows.map((m) => ({
    id: m.id, userId: m.user_id, orgRole: m.org_role, department: m.department, location: m.location, isActive: !!m.is_active,
    email: m.email, firstName: m.first_name, lastName: m.last_name, phone: m.phone, invitePending: !!m.invite_pending,
  }));
}

function requireOrgAdmin(req: Request) {
  const auth = requireAuth(req);
  if (!auth.org) throw forbidden('You are not a member of an organisation');
  if (auth.org.role !== 'ORG_ADMIN') throw forbidden('Only organisation administrators can do this');
  return { auth, orgId: auth.org.id };
}

export function organizationRoutes() {
  const r = Router();
  r.use(authenticate);

  /* ----- the caller's own organisation ----- */

  r.get('/mine', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth.org) throw notFound('Organisation');
    const org = await db('organizations').where({ id: auth.org.id }).first();
    const stats = await db('support_requests').where({ organization_id: auth.org.id })
      .select(db.raw("SUM(status NOT IN ('COMPLETED','CLOSED','CANCELLED')) as open_requests"), db.raw('COUNT(*) as total_requests'))
      .first();
    ok(res, {
      ...mapOrg(org),
      myRole: auth.org.role,
      members: auth.org.role === 'ORG_ADMIN' ? await members(auth.org.id) : undefined,
      stats: { openRequests: Number(stats?.open_requests ?? 0), totalRequests: Number(stats?.total_requests ?? 0) },
    });
  });

  r.patch('/mine', async (req, res) => {
    const { auth, orgId } = requireOrgAdmin(req);
    const input = parse(organizationUpdateSchema, req.body);
    await db('organizations').where({ id: orgId }).update({
      ...(input.name ? { name: input.name } : {}),
      ...(input.registrationNo !== undefined ? { registration_no: input.registrationNo } : {}),
      ...(input.billingEmail ? { billing_email: input.billingEmail } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.centralBilling !== undefined ? { central_billing: input.centralBilling } : {}),
    });
    await audit({ actorUserId: auth.userId, action: 'organization.updated', entityType: 'organization', entityId: orgId, ...requestContext(req) });
    ok(res, mapOrg(await db('organizations').where({ id: orgId }).first()));
  });

  /** Invite an employee: creates the account without a password and e-mails a one-time set-password link. */
  r.post('/mine/members', async (req, res) => {
    const { auth, orgId } = requireOrgAdmin(req);
    const input = parse(inviteMemberSchema, req.body);
    const existing = await db('users').where({ email: input.email }).first('id');
    if (existing) throw conflict('A user with this e-mail address already exists. Ask them to contact support to be linked to your organisation.');
    const settings = await getSettings();
    const memberId = await db.transaction(async (trx) => {
      const [userId] = await trx('users').insert({
        email: input.email, first_name: input.firstName, last_name: input.lastName, account_type: 'CORPORATE', password_hash: null,
      });
      const role = await trx('roles').where({ code: 'CUSTOMER' }).first('id');
      await trx('user_roles').insert({ user_id: userId, role_id: role.id, granted_by: auth.userId });
      const [mId] = await trx('organization_members').insert({
        organization_id: orgId, user_id: userId, org_role: input.orgRole, department: input.department ?? null, location: input.location ?? null,
      });
      const token = await createUserToken(userId as number, 'INVITE', 24 * 7, trx);
      await notify({
        userIds: [userId as number], type: 'INVITATION', title: `You have been invited to ${settings.businessName}`,
        body: `${auth.firstName} ${auth.lastName} added you to ${auth.org!.name}'s ICT support account. Use the link below within 7 days to set your password.`,
        link: `/accept-invite?token=${encodeURIComponent(token)}`,
      }, trx);
      await audit({ actorUserId: auth.userId, action: 'organization.member_invited', entityType: 'organization', entityId: orgId, metadata: { email: input.email, orgRole: input.orgRole }, ...requestContext(req) }, trx);
      return mId;
    });
    created(res, (await members(orgId)).find((m) => m.id === memberId));
  });

  r.patch('/mine/members/:id', async (req, res) => {
    const { auth, orgId } = requireOrgAdmin(req);
    const input = parse(updateMemberSchema, req.body);
    const id = idFrom(req);
    await db.transaction(async (trx) => {
      const m = await trx('organization_members').where({ id, organization_id: orgId }).forUpdate().first();
      if (!m) throw notFound('Member');
      const demoting = m.org_role === 'ORG_ADMIN' && ((input.orgRole && input.orgRole !== 'ORG_ADMIN') || input.active === false);
      if (demoting) {
        const admins = await trx('organization_members').where({ organization_id: orgId, org_role: 'ORG_ADMIN', is_active: true }).count({ n: '*' }).first();
        if (Number(admins?.n) <= 1) throw invalidState('An organisation must keep at least one active administrator');
      }
      await trx('organization_members').where({ id }).update({
        ...(input.orgRole ? { org_role: input.orgRole } : {}),
        ...(input.department !== undefined ? { department: input.department } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.active !== undefined ? { is_active: input.active } : {}),
      });
      await audit({ actorUserId: auth.userId, action: 'organization.member_updated', entityType: 'organization', entityId: orgId, metadata: { memberId: id, ...input }, ...requestContext(req) }, trx);
    });
    ok(res, (await members(orgId)).find((m) => m.id === id));
  });

  /* ----- staff: all organisations ----- */

  r.get('/', requirePermission(PERMISSIONS.ORGANIZATIONS_MANAGE, PERMISSIONS.CUSTOMERS_VIEW), async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const base = db('organizations as o').modify((qb) => {
      if (q) qb.where('o.name', 'like', `%${q}%`);
    });
    const total = await base.clone().count({ n: '*' }).first();
    const rows = await base
      .clone()
      .select('o.*')
      .select(db.raw('(SELECT COUNT(*) FROM organization_members m WHERE m.organization_id = o.id AND m.is_active = 1) as member_count'))
      .select(db.raw("(SELECT COUNT(*) FROM support_requests s WHERE s.organization_id = o.id AND s.status NOT IN ('COMPLETED','CLOSED','CANCELLED')) as open_requests"))
      .orderBy('o.name')
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    ok(res, rows.map((o: Record<string, any>) => ({ ...mapOrg(o), memberCount: Number(o.member_count), openRequests: Number(o.open_requests) })), pageMeta(page, pageSize, Number(total?.n ?? 0)));
  });

  r.get('/:id', requirePermission(PERMISSIONS.ORGANIZATIONS_MANAGE, PERMISSIONS.CUSTOMERS_VIEW), async (req, res) => {
    const org = await db('organizations').where({ id: idFrom(req) }).first();
    if (!org) throw notFound('Organisation');
    const devices = await db('devices').where({ organization_id: org.id }).count({ n: '*' }).first();
    ok(res, { ...mapOrg(org), members: await members(org.id), deviceCount: Number(devices?.n ?? 0) });
  });

  r.patch('/:id', requirePermission(PERMISSIONS.ORGANIZATIONS_MANAGE), async (req, res) => {
    const input = parse(organizationUpdateSchema.extend({ isActive: updateMemberSchema.shape.active }), req.body);
    const id = idFrom(req);
    const org = await db('organizations').where({ id }).first('id');
    if (!org) throw notFound('Organisation');
    await db('organizations').where({ id }).update({
      ...(input.name ? { name: input.name } : {}),
      ...(input.centralBilling !== undefined ? { central_billing: input.centralBilling } : {}),
      ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
      ...(input.billingEmail ? { billing_email: input.billingEmail } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
    });
    await audit({ actorUserId: requireAuth(req).userId, action: 'organization.admin_updated', entityType: 'organization', entityId: id, metadata: input, ...requestContext(req) });
    ok(res, mapOrg(await db('organizations').where({ id }).first()));
  });

  return r;
}
