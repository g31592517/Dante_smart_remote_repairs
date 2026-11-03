import { Router } from 'express';
import { createStaffSchema, setUserActiveSchema, updateUserRolesSchema, PERMISSIONS, STAFF_ROLES, ACTIVE_WORK_STATUSES, type RoleCode } from '@dante/shared';
import { z } from 'zod';
import { authenticate, requireAuth, requirePermission } from '../../core/auth.js';
import { audit, requestContext } from '../../core/audit.js';
import { conflict, invalidState, notFound } from '../../core/errors.js';
import { created, idFrom, ok, pageMeta, parse } from '../../core/http.js';
import { db } from '../../db/knex.js';
import { createUserToken } from '../auth/auth.service.js';
import { notify } from '../notifications/notifications.service.js';

const P = PERMISSIONS;

async function userWithRoles(id: number) {
  const u = await db('users').where({ id }).first('id', 'email', 'first_name', 'last_name', 'phone', 'account_type', 'is_active', 'last_login_at', 'created_at',
    db.raw('password_hash IS NULL as invite_pending'));
  if (!u) return null;
  const roles = await db('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where('ur.user_id', id).pluck('r.code');
  const org = await db('organization_members as m').join('organizations as o', 'o.id', 'm.organization_id').where('m.user_id', id).first('o.id', 'o.name', 'm.org_role');
  return {
    id: u.id, email: u.email, firstName: u.first_name, lastName: u.last_name, phone: u.phone, accountType: u.account_type,
    isActive: !!u.is_active, lastLoginAt: u.last_login_at, createdAt: u.created_at, invitePending: !!u.invite_pending, roles,
    organization: org ? { id: org.id, name: org.name, orgRole: org.org_role } : null,
  };
}

/** Administration of staff accounts and lookup of customers/technicians by staff. */
export function staffRoutes() {
  const r = Router();
  r.use(authenticate);

  r.get('/users', requirePermission(P.USERS_MANAGE, P.CUSTOMERS_VIEW), async (req, res) => {
    const auth = requireAuth(req);
    const kind = req.query.kind === 'staff' ? 'staff' : 'customers';
    if (kind === 'staff' && !auth.permissions.has(P.USERS_MANAGE)) throw notFound('Users');
    const q = String(req.query.q ?? '').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
    const base = db('users as u')
      .where('u.account_type', kind === 'staff' ? '=' : '<>', 'STAFF')
      .modify((qb) => {
        if (q) qb.where((w) => w.where('u.email', 'like', `%${q}%`).orWhere('u.first_name', 'like', `%${q}%`).orWhere('u.last_name', 'like', `%${q}%`));
      });
    const total = await base.clone().count({ n: '*' }).first();
    const ids = await base.clone().orderBy('u.created_at', 'desc').limit(pageSize).offset((page - 1) * pageSize).pluck('u.id');
    const users = await Promise.all(ids.map((id: number) => userWithRoles(id)));
    ok(res, users, pageMeta(page, pageSize, Number(total?.n ?? 0)));
  });

  r.get('/users/:id', requirePermission(P.USERS_MANAGE, P.CUSTOMERS_VIEW), async (req, res) => {
    const u = await userWithRoles(idFrom(req));
    if (!u) throw notFound('User');
    const requests = await db('support_requests').where({ customer_user_id: u.id }).orderBy('submitted_at', 'desc').limit(20)
      .select('id', 'reference', 'title', 'status', 'service_type', 'submitted_at');
    const orders = await db('sales_orders').where({ customer_user_id: u.id }).orderBy('placed_at', 'desc').limit(20)
      .select('id', 'reference', 'status', 'total_minor', 'placed_at');
    ok(res, {
      ...u,
      requests: requests.map((x) => ({ id: x.id, reference: x.reference, title: x.title, status: x.status, serviceType: x.service_type, submittedAt: x.submitted_at })),
      orders: orders.map((o) => ({ id: o.id, reference: o.reference, status: o.status, totalMinor: o.total_minor, placedAt: o.placed_at })),
    });
  });

  /** Create a staff member; they receive an invitation to set their own password. */
  r.post('/users', requirePermission(P.USERS_MANAGE), async (req, res) => {
    const auth = requireAuth(req);
    const input = parse(createStaffSchema, req.body);
    if (await db('users').where({ email: input.email }).first('id')) throw conflict('A user with this e-mail address already exists');
    const userId = await db.transaction(async (trx) => {
      const [id] = await trx('users').insert({
        email: input.email, first_name: input.firstName, last_name: input.lastName, phone: input.phone ?? null, account_type: 'STAFF', password_hash: null,
      });
      const roleRows = await trx('roles').whereIn('code', input.roles).select('id');
      await trx('user_roles').insert(roleRows.map((rr) => ({ user_id: id, role_id: rr.id, granted_by: auth.userId })));
      if (input.roles.includes('TECHNICIAN')) await trx('technicians').insert({ user_id: id, specialties: input.specialties ?? null });
      const token = await createUserToken(id as number, 'INVITE', 24 * 7, trx);
      await notify({ userIds: [id as number], type: 'INVITATION', title: 'Your staff account is ready',
        body: `An administrator created a staff account for you (${input.roles.join(', ')}). Use the link below within 7 days to set your password.`,
        link: `/accept-invite?token=${encodeURIComponent(token)}` }, trx);
      await audit({ actorUserId: auth.userId, action: 'staff.created', entityType: 'user', entityId: id as number, metadata: { roles: input.roles }, ...requestContext(req) }, trx);
      return id as number;
    });
    created(res, await userWithRoles(userId));
  });

  r.put('/users/:id/roles', requirePermission(P.USERS_MANAGE), async (req, res) => {
    const auth = requireAuth(req);
    const id = idFrom(req);
    const { roles } = parse(updateUserRolesSchema, req.body);
    const target = await db('users').where({ id }).first('account_type');
    if (!target) throw notFound('User');
    const isStaffAccount = target.account_type === 'STAFF';
    const staffRolesRequested = roles.some((r) => STAFF_ROLES.includes(r as RoleCode));
    if (isStaffAccount !== staffRolesRequested || (!isStaffAccount && roles.some((r) => r !== 'CUSTOMER'))) {
      throw invalidState('Customer accounts can only hold the CUSTOMER role, and staff accounts only staff roles');
    }
    if (id === auth.userId && !roles.includes('ADMIN')) throw invalidState('You cannot remove your own administrator role');
    await db.transaction(async (trx) => {
      const before = await trx('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where('ur.user_id', id).pluck('r.code');
      await trx('user_roles').where({ user_id: id }).del();
      const roleRows = await trx('roles').whereIn('code', roles).select('id');
      await trx('user_roles').insert(roleRows.map((rr) => ({ user_id: id, role_id: rr.id, granted_by: auth.userId })));
      if (roles.includes('TECHNICIAN')) await trx('technicians').insert({ user_id: id }).onConflict('user_id').ignore();
      await audit({ actorUserId: auth.userId, action: 'staff.roles_changed', entityType: 'user', entityId: id, metadata: { before, after: roles }, ...requestContext(req) }, trx);
    });
    ok(res, await userWithRoles(id));
  });

  r.put('/users/:id/active', requirePermission(P.USERS_MANAGE, P.CUSTOMERS_MANAGE), async (req, res) => {
    const auth = requireAuth(req);
    const id = idFrom(req);
    const { active } = parse(setUserActiveSchema, req.body);
    if (id === auth.userId) throw invalidState('You cannot deactivate your own account');
    const target = await db('users').where({ id }).first('account_type');
    if (!target) throw notFound('User');
    // customer managers may (de)activate customers; only user admins may touch staff
    if (target.account_type === 'STAFF' && !auth.permissions.has(P.USERS_MANAGE)) throw notFound('User');
    await db.transaction(async (trx) => {
      await trx('users').where({ id }).update({ is_active: active });
      if (!active) await trx('refresh_tokens').where({ user_id: id }).whereNull('revoked_at').update({ revoked_at: trx.fn.now(3) });
      await audit({ actorUserId: auth.userId, action: active ? 'user.activated' : 'user.deactivated', entityType: 'user', entityId: id, ...requestContext(req) }, trx);
    });
    ok(res, await userWithRoles(id));
  });

  /** Technicians with their current workload — used by the assignment dialog. */
  r.get('/technicians', requirePermission(P.REQUESTS_ASSIGN, P.REQUESTS_VIEW_ALL, P.TECHNICIANS_PERFORMANCE), async (_req, res) => {
    const rows = await db('users as u')
      .join('user_roles as ur', 'ur.user_id', 'u.id')
      .join('roles as r', 'r.id', 'ur.role_id')
      .leftJoin('technicians as t', 't.user_id', 'u.id')
      .where({ 'r.code': 'TECHNICIAN', 'u.is_active': true })
      .select('u.id', 'u.first_name', 'u.last_name', 'u.email', 't.specialties', 't.is_available', 't.max_active_jobs')
      .select(db.raw(`(SELECT COUNT(*) FROM support_requests s WHERE s.assigned_technician_id = u.id AND s.status IN (${ACTIVE_WORK_STATUSES.map(() => '?').join(',')})) as active_jobs`, ACTIVE_WORK_STATUSES))
      .orderBy('u.first_name');
    ok(res, rows.map((t) => ({
      userId: t.id, name: `${t.first_name} ${t.last_name}`, email: t.email, specialties: t.specialties,
      isAvailable: t.is_available === null ? true : !!t.is_available, maxActiveJobs: t.max_active_jobs ?? 10, activeJobs: Number(t.active_jobs),
    })));
  });

  r.patch('/technicians/:userId', requirePermission(P.REQUESTS_ASSIGN, P.USERS_MANAGE), async (req, res) => {
    const userId = idFrom(req, 'userId');
    const input = parse(z.object({ isAvailable: z.boolean().optional(), specialties: z.string().max(300).optional(), maxActiveJobs: z.number().int().min(1).max(100).optional() }), req.body);
    const t = await db('technicians').where({ user_id: userId }).first('id');
    if (!t) throw notFound('Technician');
    await db('technicians').where({ user_id: userId }).update({
      ...(input.isAvailable !== undefined ? { is_available: input.isAvailable } : {}),
      ...(input.specialties !== undefined ? { specialties: input.specialties } : {}),
      ...(input.maxActiveJobs !== undefined ? { max_active_jobs: input.maxActiveJobs } : {}),
    });
    ok(res, { updated: true });
  });

  return r;
}
