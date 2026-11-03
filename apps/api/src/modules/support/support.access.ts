import type { Knex } from 'knex';
import { PERMISSIONS } from '@dante/shared';
import type { AuthContext } from '../../core/auth.js';
import { forbidden, notFound } from '../../core/errors.js';
import { db, type Db } from '../../db/knex.js';

export type Viewer = 'CUSTOMER' | 'TECHNICIAN' | 'MANAGER';

/**
 * How the caller relates to support requests:
 *  MANAGER    staff with requests.view_all — every request
 *  TECHNICIAN staff with requests.work only — requests currently assigned to them
 *  CUSTOMER   own requests; organisation admins also see all of their organisation's requests
 * Staff without either permission (store, finance) have no access to support records.
 */
export function viewerOf(auth: AuthContext): Viewer | null {
  if (auth.permissions.has(PERMISSIONS.REQUESTS_VIEW_ALL)) return 'MANAGER';
  if (auth.permissions.has(PERMISSIONS.REQUESTS_WORK)) return 'TECHNICIAN';
  if (auth.roles.includes('CUSTOMER')) return 'CUSTOMER';
  return null;
}

/** Restricts a query on `support_requests as sr` to rows the caller may see. */
export function scopeRequests(qb: Knex.QueryBuilder, auth: AuthContext): Knex.QueryBuilder {
  const viewer = viewerOf(auth);
  if (viewer === 'MANAGER') return qb;
  if (viewer === 'TECHNICIAN') return qb.where('sr.assigned_technician_id', auth.userId);
  if (viewer === 'CUSTOMER') {
    return qb.where((w) => {
      w.where('sr.customer_user_id', auth.userId);
      if (auth.org?.role === 'ORG_ADMIN') w.orWhere('sr.organization_id', auth.org.id);
    });
  }
  return qb.whereRaw('1 = 0');
}

export interface RequestAccess {
  request: Record<string, any>;
  viewer: Viewer;
  isCustomerView: boolean;
}

/**
 * Loads a request the caller may see. Inaccessible requests are reported as NOT FOUND (not 403) so
 * that reference numbers of other customers cannot be probed.
 */
export async function loadRequestFor(auth: AuthContext, id: number, conn: Db = db, opts: { forUpdate?: boolean } = {}): Promise<RequestAccess> {
  const viewer = viewerOf(auth);
  if (!viewer) throw forbidden();
  const q = scopeRequests(conn('support_requests as sr').where('sr.id', id), auth).select('sr.*').first();
  if (opts.forUpdate) q.forUpdate();
  const request = await q;
  if (!request) throw notFound('Support request');
  return { request, viewer, isCustomerView: viewer === 'CUSTOMER' };
}

export function assertStaff(access: RequestAccess) {
  if (access.isCustomerView) throw forbidden();
}
