import { ACTIVE_WORK_STATUSES, PERMISSIONS } from '@dante/shared';
import type { AuthContext } from '../../core/auth.js';
import { db } from '../../db/knex.js';

export interface Range {
  from: Date;
  to: Date; // exclusive
}

export function rangeFrom(q: { from?: string; to?: string }): Range {
  const to = q.to ? new Date(`${q.to}T00:00:00Z`) : new Date();
  if (q.to) to.setUTCDate(to.getUTCDate() + 1); // make the end date inclusive
  const from = q.from ? new Date(`${q.from}T00:00:00Z`) : new Date(to.getTime() - 30 * 86_400_000);
  return { from, to };
}

const n = (v: unknown) => Number(v ?? 0);
const placeholders = (arr: readonly unknown[]) => arr.map(() => '?').join(',');

/** Operational indicators. Each block is included only if the caller may see it. */
export async function dashboard(auth: AuthContext) {
  const has = (p: string) => auth.permissions.has(p as never);
  const out: Record<string, unknown> = {};
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));

  if (has(PERMISSIONS.REQUESTS_VIEW_ALL)) {
    const r = await db('support_requests').select(
      db.raw('COUNT(*) as total'),
      db.raw("SUM(status IN ('SUBMITTED','UNDER_REVIEW')) as awaiting_review"),
      db.raw(`SUM(service_type IN ('HARDWARE_REPAIR','ONSITE_SUPPORT') AND status IN (${placeholders(ACTIVE_WORK_STATUSES)})) as active_repairs`, ACTIVE_WORK_STATUSES),
      db.raw(`SUM(service_type = 'REMOTE_SUPPORT' AND status IN (${placeholders(ACTIVE_WORK_STATUSES)})) as active_remote`, ACTIVE_WORK_STATUSES),
      db.raw("SUM(status = 'AWAITING_QUOTATION_APPROVAL') as awaiting_approval"),
      db.raw("SUM(status = 'AWAITING_PARTS') as awaiting_parts"),
      db.raw("SUM(status = 'AWAITING_PAYMENT') as awaiting_payment"),
      db.raw('SUM(completed_at >= ?) as completed_this_month', [monthStart]),
      db.raw("SUM(assigned_technician_id IS NULL AND status = 'ACCEPTED') as unassigned"),
    ).first();
    const sessions = await db('remote_sessions').select(
      db.raw("SUM(status IN ('REQUESTED','AUTHORIZED','INITIATED','ACTIVE')) as open"),
      db.raw("SUM(status = 'COMPLETED' AND completed_at >= ?) as completed_this_month", [monthStart]),
    ).first();
    const quotes = await db('quotations').where('status', 'SENT').count({ c: '*' }).first();
    out.support = {
      totalRequests: n(r?.total), awaitingReview: n(r?.awaiting_review), unassigned: n(r?.unassigned), activeRepairJobs: n(r?.active_repairs),
      activeRemoteJobs: n(r?.active_remote), awaitingQuotationApproval: n(r?.awaiting_approval), awaitingParts: n(r?.awaiting_parts),
      awaitingPayment: n(r?.awaiting_payment), completedThisMonth: n(r?.completed_this_month), pendingQuotations: n(quotes?.c),
      openRemoteSessions: n(sessions?.open), remoteSessionsCompletedThisMonth: n(sessions?.completed_this_month),
    };
  }
  if (has(PERMISSIONS.REQUESTS_WORK) && !has(PERMISSIONS.REQUESTS_VIEW_ALL)) {
    const mine = await db('support_requests').where('assigned_technician_id', auth.userId).whereIn('status', ACTIVE_WORK_STATUSES)
      .select('status').count({ c: '*' }).groupBy('status');
    out.myJobs = Object.fromEntries((mine as Record<string, any>[]).map((m) => [m.status, n(m.c)]));
  }
  if (has(PERMISSIONS.PAYMENTS_VIEW) || has(PERMISSIONS.REPORTS_FINANCIAL)) {
    const outstandingRequests = await db.raw(`
      SELECT COALESCE(SUM(GREATEST(q.total_minor - COALESCE(p.paid, 0), 0)), 0) AS outstanding
      FROM quotations q
      JOIN support_requests sr ON sr.id = q.support_request_id AND sr.status <> 'CANCELLED'
      LEFT JOIN (SELECT payable_id, SUM(amount_minor) AS paid FROM payments WHERE payable_type = 'SUPPORT_REQUEST' AND status = 'SUCCEEDED' GROUP BY payable_id) p
        ON p.payable_id = q.support_request_id
      WHERE q.status = 'APPROVED'`);
    const unpaidOrders = await db('sales_orders').where('status', 'PENDING_PAYMENT').sum({ s: 'total_minor' }).count({ c: '*' }).first();
    const sales = await db('payments').where({ status: 'SUCCEEDED' }).where('succeeded_at', '>=', monthStart)
      .select(db.raw("SUM(CASE WHEN payable_type = 'SALES_ORDER' THEN amount_minor ELSE 0 END) as product_sales"),
        db.raw("SUM(CASE WHEN payable_type = 'SUPPORT_REQUEST' THEN amount_minor ELSE 0 END) as service_revenue")).first();
    const toVerify = await db('payments').where({ status: 'PENDING', provider: 'OFFLINE' }).count({ c: '*' }).first();
    out.finance = {
      outstandingServiceMinor: n((outstandingRequests as any)[0]?.[0]?.outstanding),
      unpaidOrders: n(unpaidOrders?.c), unpaidOrdersMinor: n(unpaidOrders?.s),
      productSalesThisMonthMinor: n(sales?.product_sales), serviceRevenueThisMonthMinor: n(sales?.service_revenue),
      paymentsAwaitingVerification: n(toVerify?.c),
    };
  }
  if (has(PERMISSIONS.INVENTORY_VIEW) || has(PERMISSIONS.ORDERS_VIEW_ALL)) {
    const low = await db('inventory as i').join('products as p', 'p.id', 'i.product_id').where('p.is_active', true)
      .whereRaw('(i.quantity_on_hand - i.quantity_reserved) <= i.reorder_level').count({ c: '*' }).first();
    const orders = await db('sales_orders').select(
      db.raw("SUM(status IN ('PAID','PROCESSING')) as to_fulfil"),
      db.raw("SUM(status IN ('READY_FOR_COLLECTION','OUT_FOR_DELIVERY')) as in_transit"),
      db.raw('SUM(placed_at >= ?) as placed_this_month', [monthStart]),
    ).first();
    out.store = { lowStockProducts: n(low?.c), ordersToFulfil: n(orders?.to_fulfil), ordersAwaitingHandover: n(orders?.in_transit), ordersThisMonth: n(orders?.placed_this_month) };
  }
  return out;
}

export async function requestsByCategory(r: Range) {
  const rows = await db('support_requests as sr').join('service_categories as c', 'c.id', 'sr.category_id')
    .whereBetween('sr.submitted_at', [r.from, r.to]).groupBy('c.id', 'c.name').orderBy('total', 'desc')
    .select('c.name as category', db.raw('COUNT(*) as total'), db.raw("SUM(sr.status IN ('COMPLETED','CLOSED')) as completed"), db.raw("SUM(sr.status = 'CANCELLED') as cancelled"));
  return rows.map((x) => ({ category: x.category, total: n(x.total), completed: n(x.completed), cancelled: n(x.cancelled) }));
}

export async function requestsByPeriod(r: Range, granularity: 'day' | 'week' | 'month') {
  const fmt = { day: '%Y-%m-%d', week: '%x-W%v', month: '%Y-%m' }[granularity];
  const rows = await db('support_requests').whereBetween('submitted_at', [r.from, r.to])
    .select(db.raw('DATE_FORMAT(submitted_at, ?) as period', [fmt]), db.raw('COUNT(*) as total'),
      db.raw("SUM(service_type = 'REMOTE_SUPPORT') as remote"), db.raw("SUM(service_type = 'HARDWARE_REPAIR') as hardware"),
      db.raw("SUM(service_type = 'ONSITE_SUPPORT') as onsite"), db.raw("SUM(service_type = 'CONSULTATION') as consultation"))
    .groupBy('period').orderBy('period');
  return rows.map((x) => ({ period: x.period, total: n(x.total), remote: n(x.remote), hardware: n(x.hardware), onsite: n(x.onsite), consultation: n(x.consultation) }));
}

/** Response = submission → first staff response. Resolution = submission → completion. */
export async function responseAndResolution(r: Range) {
  const rows = await db('support_requests').whereBetween('submitted_at', [r.from, r.to]).groupBy('service_type')
    .select('service_type', db.raw('COUNT(*) as total'),
      db.raw('AVG(TIMESTAMPDIFF(MINUTE, submitted_at, first_response_at)) as avg_response_minutes'),
      db.raw('AVG(TIMESTAMPDIFF(MINUTE, submitted_at, completed_at)) / 60 as avg_resolution_hours'),
      db.raw('SUM(completed_at IS NOT NULL) as completed'));
  return rows.map((x) => ({
    serviceType: x.service_type, total: n(x.total), completed: n(x.completed),
    avgResponseMinutes: x.avg_response_minutes === null ? null : Math.round(n(x.avg_response_minutes)),
    avgResolutionHours: x.avg_resolution_hours === null ? null : Math.round(n(x.avg_resolution_hours) * 10) / 10,
  }));
}

export async function technicianPerformance(r: Range) {
  const rows = await db.raw(`
    SELECT u.id, CONCAT(u.first_name, ' ', u.last_name) AS technician,
      (SELECT COUNT(*) FROM technician_assignments ta WHERE ta.technician_user_id = u.id AND ta.assigned_at >= ? AND ta.assigned_at < ?) AS assigned,
      (SELECT COUNT(*) FROM support_requests s WHERE s.assigned_technician_id = u.id AND s.completed_at >= ? AND s.completed_at < ?) AS completed,
      (SELECT COUNT(*) FROM support_requests s WHERE s.assigned_technician_id = u.id AND s.status IN (${placeholders(ACTIVE_WORK_STATUSES)})) AS open_jobs,
      (SELECT AVG(TIMESTAMPDIFF(MINUTE, s.assigned_at, s.completed_at)) / 60 FROM support_requests s WHERE s.assigned_technician_id = u.id AND s.completed_at >= ? AND s.completed_at < ?) AS avg_hours_to_complete,
      (SELECT AVG(f.rating) FROM customer_feedback f WHERE f.technician_user_id = u.id AND f.created_at >= ? AND f.created_at < ?) AS avg_rating,
      (SELECT COUNT(*) FROM customer_feedback f WHERE f.technician_user_id = u.id AND f.created_at >= ? AND f.created_at < ?) AS ratings,
      (SELECT COALESCE(SUM(w.minutes_spent), 0) FROM repair_work_logs w WHERE w.technician_user_id = u.id AND w.created_at >= ? AND w.created_at < ?) AS minutes_logged
    FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles ro ON ro.id = ur.role_id AND ro.code = 'TECHNICIAN'
    ORDER BY completed DESC`,
    [r.from, r.to, r.from, r.to, ...ACTIVE_WORK_STATUSES, r.from, r.to, r.from, r.to, r.from, r.to, r.from, r.to]);
  return (rows[0] as any[]).map((x) => ({
    technicianId: x.id, technician: x.technician, assigned: n(x.assigned), completed: n(x.completed), openJobs: n(x.open_jobs),
    avgHoursToComplete: x.avg_hours_to_complete === null ? null : Math.round(n(x.avg_hours_to_complete) * 10) / 10,
    avgRating: x.avg_rating === null ? null : Math.round(n(x.avg_rating) * 100) / 100, ratings: n(x.ratings), minutesLogged: n(x.minutes_logged),
  }));
}

export async function serviceTypeSplit(r: Range) {
  const rows = await db('support_requests').whereBetween('submitted_at', [r.from, r.to]).groupBy('service_type').select('service_type', db.raw('COUNT(*) as total'));
  const sessions = await db('remote_sessions').whereBetween('requested_at', [r.from, r.to]).groupBy('status').select('status', db.raw('COUNT(*) as total'));
  return { requests: rows.map((x) => ({ serviceType: x.service_type, total: n(x.total) })), remoteSessions: sessions.map((s) => ({ status: s.status, total: n(s.total) })) };
}

export async function revenue(r: Range) {
  const rows = await db('payments').where('status', 'SUCCEEDED').whereBetween('succeeded_at', [r.from, r.to])
    .select(db.raw("DATE_FORMAT(succeeded_at, '%Y-%m') as month"), 'payable_type', 'method', db.raw('SUM(amount_minor) as amount_minor'), db.raw('COUNT(*) as payments'))
    .groupBy('month', 'payable_type', 'method').orderBy('month');
  const refunds = await db('payments').where('status', 'REFUNDED').whereBetween('refunded_at', [r.from, r.to]).sum({ s: 'amount_minor' }).first();
  return {
    rows: rows.map((x) => ({ month: x.month, source: x.payable_type === 'SALES_ORDER' ? 'PRODUCT_SALES' : 'SERVICES_AND_REPAIRS', method: x.method, amountMinor: n(x.amount_minor), payments: n(x.payments) })),
    refundedMinor: n(refunds?.s),
  };
}

export async function productSales(r: Range) {
  const rows = await db('sales_order_items as i').join('sales_orders as o', 'o.id', 'i.sales_order_id')
    .whereNotNull('o.paid_at').whereNot('o.status', 'CANCELLED').whereBetween('o.paid_at', [r.from, r.to])
    .groupBy('i.product_id', 'i.sku', 'i.product_name').orderBy('revenue_minor', 'desc')
    .select('i.sku', 'i.product_name as product', db.raw('SUM(i.quantity) as units'), db.raw('SUM(i.line_total_minor) as revenue_minor'), db.raw('COUNT(DISTINCT o.id) as orders'));
  return rows.map((x) => ({ sku: x.sku, product: x.product, units: n(x.units), revenueMinor: n(x.revenue_minor), orders: n(x.orders) }));
}

export async function inventoryMovementSummary(r: Range) {
  const rows = await db('inventory_movements as m').join('products as p', 'p.id', 'm.product_id').whereBetween('m.created_at', [r.from, r.to])
    .groupBy('p.id', 'p.sku', 'p.name', 'm.movement_type').orderBy(['p.name', 'm.movement_type'])
    .select('p.sku', 'p.name as product', 'm.movement_type', db.raw('SUM(m.on_hand_delta) as on_hand_change'), db.raw('SUM(m.reserved_delta) as reserved_change'), db.raw('COUNT(*) as movements'));
  return rows.map((x) => ({ sku: x.sku, product: x.product, movementType: x.movement_type, onHandChange: n(x.on_hand_change), reservedChange: n(x.reserved_change), movements: n(x.movements) }));
}

export async function satisfaction(r: Range) {
  const s = await db('customer_feedback').whereBetween('created_at', [r.from, r.to]).select(
    db.raw('COUNT(*) as responses'), db.raw('AVG(rating) as avg_rating'), db.raw('AVG(issue_resolved) as resolved_ratio'),
    db.raw('AVG(timeliness_rating) as timeliness'), db.raw('AVG(communication_rating) as communication'), db.raw('AVG(professionalism_rating) as professionalism'),
  ).first();
  const dist = await db('customer_feedback').whereBetween('created_at', [r.from, r.to]).groupBy('rating').select('rating', db.raw('COUNT(*) as c'));
  const completed = await db('support_requests').whereBetween('completed_at', [r.from, r.to]).count({ c: '*' }).first();
  const recent = await db('customer_feedback as f').join('support_requests as sr', 'sr.id', 'f.support_request_id').whereBetween('f.created_at', [r.from, r.to])
    .whereNotNull('f.comment').orderBy('f.created_at', 'desc').limit(20).select('sr.reference', 'f.rating', 'f.issue_resolved', 'f.comment', 'f.created_at');
  const round = (v: unknown) => (v === null || v === undefined ? null : Math.round(n(v) * 100) / 100);
  return {
    responses: n(s?.responses), completedJobs: n(completed?.c),
    responseRate: n(completed?.c) ? Math.round((n(s?.responses) / n(completed?.c)) * 100) : null,
    avgRating: round(s?.avg_rating), resolvedPercent: s?.resolved_ratio === null ? null : Math.round(n(s?.resolved_ratio) * 100),
    avgTimeliness: round(s?.timeliness), avgCommunication: round(s?.communication), avgProfessionalism: round(s?.professionalism),
    distribution: [1, 2, 3, 4, 5].map((k) => ({ rating: k, count: n(dist.find((d) => d.rating === k)?.c) })),
    recentComments: recent.map((c) => ({ reference: c.reference, rating: c.rating, issueResolved: !!c.issue_resolved, comment: c.comment, createdAt: c.created_at })),
  };
}

export async function outstandingItems() {
  const requests = await db.raw(`
    SELECT sr.id, sr.reference, sr.status, CONCAT(u.first_name, ' ', u.last_name) AS customer, q.total_minor AS due_minor,
      COALESCE((SELECT SUM(amount_minor) FROM payments p WHERE p.payable_type = 'SUPPORT_REQUEST' AND p.payable_id = sr.id AND p.status = 'SUCCEEDED'), 0) AS paid_minor
    FROM support_requests sr JOIN quotations q ON q.support_request_id = sr.id AND q.status = 'APPROVED' JOIN users u ON u.id = sr.customer_user_id
    WHERE sr.status <> 'CANCELLED' HAVING due_minor > paid_minor ORDER BY sr.id`);
  const orders = await db('sales_orders as o').join('users as u', 'u.id', 'o.customer_user_id').where('o.status', 'PENDING_PAYMENT')
    .select('o.id', 'o.reference', 'o.status', 'o.total_minor', 'o.placed_at', db.raw("CONCAT(u.first_name, ' ', u.last_name) as customer"));
  return [
    ...(requests[0] as any[]).map((x) => ({ type: 'SUPPORT_REQUEST', id: x.id, reference: x.reference, status: x.status, customer: x.customer, outstandingMinor: n(x.due_minor) - n(x.paid_minor) })),
    ...orders.map((o) => ({ type: 'SALES_ORDER', id: o.id, reference: o.reference, status: o.status, customer: o.customer, outstandingMinor: n(o.total_minor) })),
  ];
}
