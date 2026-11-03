import { Router, type Request, type Response } from 'express';
import { PERMISSIONS, reportRangeQuery } from '@dante/shared';
import { authenticate, requireAuth, requirePermission, requireStaff } from '../../core/auth.js';
import { ok, pageMeta, parse } from '../../core/http.js';
import { db } from '../../db/knex.js';
import { sendCsv } from './csv.js';
import * as rep from './reports.service.js';

const P = PERMISSIONS;

/** JSON by default; `?format=csv` downloads the same rows as CSV. */
function report(load: (r: rep.Range, req: Request) => Promise<unknown>, csvRows?: (data: any) => Record<string, unknown>[]) {
  return async (req: Request, res: Response) => {
    const q = parse(reportRangeQuery, req.query);
    const range = rep.rangeFrom(q);
    const data = await load(range, req);
    if (q.format === 'csv') {
      const name = req.path.replace(/^\//, '').replace(/[^a-z0-9-]/gi, '-');
      return sendCsv(res, `${name}_${range.from.toISOString().slice(0, 10)}_${new Date(range.to.getTime() - 1).toISOString().slice(0, 10)}.csv`,
        csvRows ? csvRows(data) : (data as Record<string, unknown>[]));
    }
    ok(res, { range: { from: range.from, to: range.to }, data });
  };
}

export function reportRoutes() {
  const r = Router();
  r.use(authenticate);

  r.get('/dashboard', requireStaff, async (req, res) => ok(res, await rep.dashboard(requireAuth(req))));

  r.get('/requests-by-category', requirePermission(P.REPORTS_OPERATIONAL), report((x) => rep.requestsByCategory(x)));
  r.get('/requests-by-period', requirePermission(P.REPORTS_OPERATIONAL),
    report((x, req) => rep.requestsByPeriod(x, (['day', 'week', 'month'].includes(String(req.query.granularity)) ? req.query.granularity : 'day') as 'day')));
  r.get('/response-times', requirePermission(P.REPORTS_OPERATIONAL), report((x) => rep.responseAndResolution(x)));
  r.get('/technician-performance', requirePermission(P.REPORTS_OPERATIONAL, P.TECHNICIANS_PERFORMANCE), report((x) => rep.technicianPerformance(x)));
  r.get('/service-types', requirePermission(P.REPORTS_OPERATIONAL), report((x) => rep.serviceTypeSplit(x), (d) => d.requests));
  r.get('/satisfaction', requirePermission(P.REPORTS_OPERATIONAL, P.TECHNICIANS_PERFORMANCE), report((x) => rep.satisfaction(x), (d) => d.recentComments));
  r.get('/revenue', requirePermission(P.REPORTS_FINANCIAL), report((x) => rep.revenue(x), (d) => d.rows));
  r.get('/product-sales', requirePermission(P.REPORTS_FINANCIAL, P.REPORTS_INVENTORY), report((x) => rep.productSales(x)));
  r.get('/inventory-movements', requirePermission(P.REPORTS_INVENTORY), report((x) => rep.inventoryMovementSummary(x)));
  r.get('/outstanding', requirePermission(P.REPORTS_FINANCIAL, P.PAYMENTS_VIEW), report(() => rep.outstandingItems()));

  r.get('/audit', requirePermission(P.AUDIT_VIEW), async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const base = db('audit_logs as a').leftJoin('users as u', 'u.id', 'a.actor_user_id').modify((q) => {
      if (req.query.action) q.where('a.action', 'like', `${String(req.query.action)}%`);
      if (req.query.entityType) q.where('a.entity_type', String(req.query.entityType));
      if (req.query.entityId) q.where('a.entity_id', Number(req.query.entityId));
      if (req.query.actorUserId) q.where('a.actor_user_id', Number(req.query.actorUserId));
    });
    const total = await base.clone().count({ c: '*' }).first();
    const rows = await base.clone().orderBy('a.id', 'desc').limit(pageSize).offset((page - 1) * pageSize)
      .select('a.*', 'u.email as actor_email');
    ok(res, rows.map((a: Record<string, any>) => ({
      id: a.id, action: a.action, entityType: a.entity_type, entityId: a.entity_id, actorEmail: a.actor_email, ip: a.ip,
      metadata: typeof a.metadata === 'string' ? JSON.parse(a.metadata) : a.metadata, createdAt: a.created_at,
    })), pageMeta(page, pageSize, Number(total?.c ?? 0)));
  });

  return r;
}
