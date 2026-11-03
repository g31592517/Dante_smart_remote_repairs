import type { NextFunction, Request, Response } from 'express';
import { STAFF_ROLES, type OrgRole, type PermissionCode, type RoleCode } from '@dante/shared';
import { db } from '../db/knex.js';
import { forbidden, unauthenticated } from './errors.js';
import { verifyAccessToken } from './tokens.js';

export interface AuthContext {
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  accountType: 'INDIVIDUAL' | 'CORPORATE' | 'STAFF';
  roles: RoleCode[];
  permissions: Set<PermissionCode>;
  isStaff: boolean;
  org: { id: number; name: string; role: OrgRole } | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * Loads roles, permissions and organisation membership fresh from the database on every request,
 * so deactivating a user or revoking a role takes effect immediately (not at token expiry).
 */
export async function loadAuthContext(userId: number): Promise<AuthContext | null> {
  const user = await db('users').where({ id: userId, is_active: true }).first('id', 'email', 'first_name', 'last_name', 'account_type');
  if (!user) return null;
  const roles = (await db('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where('ur.user_id', userId).pluck('r.code')) as RoleCode[];
  const permissions = (await db('user_roles as ur')
    .join('role_permissions as rp', 'rp.role_id', 'ur.role_id')
    .join('permissions as p', 'p.id', 'rp.permission_id')
    .where('ur.user_id', userId)
    .distinct()
    .pluck('p.code')) as PermissionCode[];
  const membership = await db('organization_members as m')
    .join('organizations as o', 'o.id', 'm.organization_id')
    .where({ 'm.user_id': userId, 'm.is_active': true, 'o.is_active': true })
    .first('o.id', 'o.name', 'm.org_role');
  return {
    userId: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    accountType: user.account_type,
    roles,
    permissions: new Set(permissions),
    isStaff: roles.some((r) => STAFF_ROLES.includes(r)),
    org: membership ? { id: membership.id, name: membership.name, role: membership.org_role } : null,
  };
}

function bearer(req: Request): string | null {
  const h = req.get('authorization');
  if (!h) return null;
  const [scheme, token] = h.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) throw unauthenticated();
  const userId = await verifyAccessToken(token);
  if (!userId) throw unauthenticated('Your session has expired. Please sign in again.');
  const ctx = await loadAuthContext(userId);
  if (!ctx) throw unauthenticated('This account is not active');
  req.auth = ctx;
  next();
}

/** Attaches the user if a valid token is present; never rejects. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = bearer(req);
  if (token) {
    const userId = await verifyAccessToken(token);
    if (userId) req.auth = (await loadAuthContext(userId)) ?? undefined;
  }
  next();
}

/** Passes if the caller holds ANY of the listed permissions. */
export function requirePermission(...codes: PermissionCode[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const auth = requireAuth(req);
    if (!codes.some((c) => auth.permissions.has(c))) throw forbidden();
    next();
  };
}

export function requireStaff(req: Request, _res: Response, next: NextFunction) {
  if (!requireAuth(req).isStaff) throw forbidden();
  next();
}

export function requireCustomer(req: Request, _res: Response, next: NextFunction) {
  if (!requireAuth(req).roles.includes('CUSTOMER')) throw forbidden('This action is available to customer accounts');
  next();
}

export function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}

export const can = (auth: AuthContext, code: PermissionCode) => auth.permissions.has(code);
