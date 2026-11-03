import type { z } from 'zod';
import { computeTotals, PERMISSIONS, TERMINAL_STATUSES, type createQuotationSchema } from '@dante/shared';
import type { AuthContext } from '../../core/auth.js';
import { audit } from '../../core/audit.js';
import { badRequest, forbidden, invalidState, notFound } from '../../core/errors.js';
import { nextReference } from '../../core/references.js';
import { db, type Db } from '../../db/knex.js';
import { notify } from '../notifications/notifications.service.js';
import { getSettings } from '../settings/settings.service.js';
import { loadRequestFor } from '../support/support.access.js';
import { addActivity, transitionStatus } from '../support/support.workflow.js';
import { releaseLine } from '../inventory/inventory.service.js';
import { tryReserve } from './parts.service.js';

type ClientInfo = { ip?: string; userAgent?: string };

export async function loadQuotations(requestId: number, customerView: boolean, conn: Db = db) {
  const qs = await conn('quotations as q').join('users as u', 'u.id', 'q.prepared_by').where('q.support_request_id', requestId)
    .modify((qb) => (customerView ? qb.whereNot('q.status', 'DRAFT') : qb))
    .orderBy('q.revision', 'desc').select('q.*', 'u.first_name', 'u.last_name');
  const items = qs.length ? await conn('quotation_items').whereIn('quotation_id', qs.map((q: Record<string, any>) => q.id)).orderBy(['quotation_id', 'sort_order']) : [];
  return qs.map((q: Record<string, any>) => ({
    id: q.id, reference: q.reference, revision: q.revision, status: q.status, currency: q.currency,
    subtotalMinor: q.subtotal_minor, taxRateBasisPoints: q.tax_rate_bp, taxInclusive: !!q.tax_inclusive, taxMinor: q.tax_minor, totalMinor: q.total_minor,
    expectedDurationDays: q.expected_duration_days, validUntil: q.valid_until, notes: q.notes, sentAt: q.sent_at, decidedAt: q.decided_at,
    decisionComment: q.decision_comment, preparedBy: `${q.first_name} ${q.last_name}`, supersedesId: q.supersedes_id,
    items: items.filter((i) => i.quotation_id === q.id).map((i) => ({
      id: i.id, itemType: i.item_type, description: i.description, productId: i.product_id, quantity: i.quantity,
      unitPriceMinor: i.unit_price_minor, lineTotalMinor: i.line_total_minor,
    })),
  }));
}

async function assertCanQuote(auth: AuthContext, requestId: number, trx: Db) {
  if (!auth.permissions.has(PERMISSIONS.QUOTATIONS_PREPARE)) throw forbidden();
  const access = await loadRequestFor(auth, requestId, trx, { forUpdate: true });
  if (access.isCustomerView) throw forbidden();
  if (access.request.assigned_technician_id !== auth.userId && !auth.permissions.has(PERMISSIONS.QUOTATIONS_REVIEW)) {
    throw forbidden('Only the assigned technician or a manager can quote this job');
  }
  return access.request;
}

const QUOTABLE = ['ASSIGNED', 'AWAITING_CUSTOMER', 'DIAGNOSIS_IN_PROGRESS', 'APPROVED', 'AWAITING_PARTS', 'REPAIR_IN_PROGRESS', 'TESTING_QC'];

export async function createQuotation(auth: AuthContext, requestId: number, input: z.infer<typeof createQuotationSchema>, client: ClientInfo) {
  return db.transaction(async (trx) => {
    const request = await assertCanQuote(auth, requestId, trx);
    if (!QUOTABLE.includes(request.status)) throw invalidState('A quotation cannot be issued at this stage of the request');
    const settings = await getSettings(trx);

    const productIds = input.items.filter((i) => i.productId).map((i) => i.productId!);
    const products = productIds.length ? await trx('products').whereIn('id', productIds).select('id', 'name') : [];
    for (const pid of productIds) if (!products.find((p) => p.id === pid)) throw badRequest(`Unknown product ${pid}`);

    const lines = input.items.map((i, idx) => ({ ...i, lineTotal: i.quantity * i.unitPriceMinor, sort: idx }));
    const totals = computeTotals(lines.map((l) => l.lineTotal), settings.taxRateBasisPoints, settings.taxInclusive);
    const prev = await trx('quotations').where({ support_request_id: requestId }).max({ r: 'revision' }).first();
    const revision = Number(prev?.r ?? 0) + 1;
    const approvedPrev = await trx('quotations').where({ support_request_id: requestId, status: 'APPROVED' }).first('id');
    // an unanswered earlier quotation can no longer be accepted once a new one exists
    await trx('quotations').where({ support_request_id: requestId }).whereIn('status', ['DRAFT', 'SENT']).update({ status: 'SUPERSEDED' });

    const validUntil = new Date(Date.now() + input.validDays * 86_400_000).toISOString().slice(0, 10);
    const reference = await nextReference(trx, 'QT');
    const [quotationId] = await trx('quotations').insert({
      reference, support_request_id: requestId, revision, supersedes_id: approvedPrev?.id ?? null, status: 'DRAFT', prepared_by: auth.userId,
      currency: settings.currencyCode, subtotal_minor: totals.subtotalMinor, tax_rate_bp: settings.taxRateBasisPoints,
      tax_inclusive: settings.taxInclusive, tax_minor: totals.taxMinor, total_minor: totals.totalMinor,
      expected_duration_days: input.expectedDurationDays ?? null, valid_until: validUntil, notes: input.notes ?? null,
    });
    await trx('quotation_items').insert(lines.map((l) => ({
      quotation_id: quotationId, item_type: l.itemType, description: l.description, product_id: l.productId ?? null, quantity: l.quantity,
      unit_price_minor: l.unitPriceMinor, line_total_minor: l.lineTotal, sort_order: l.sort,
    })));
    await addActivity(trx, requestId, 'QUOTATION_PREPARED', `Quotation ${reference} (revision ${revision}) prepared`, { visible: false, actorUserId: auth.userId });
    await audit({ actorUserId: auth.userId, action: 'quotation.created', entityType: 'quotation', entityId: quotationId as number, metadata: { requestId, totalMinor: totals.totalMinor, revision }, ...client }, trx);
    if (input.send) await sendInTrx(trx, auth, quotationId as number, request, client);
    return quotationId as number;
  });
}

export async function sendQuotation(auth: AuthContext, quotationId: number, client: ClientInfo) {
  await db.transaction(async (trx) => {
    const q = await trx('quotations').where({ id: quotationId }).first('support_request_id');
    if (!q) throw notFound('Quotation');
    const request = await assertCanQuote(auth, q.support_request_id, trx);
    await sendInTrx(trx, auth, quotationId, request, client);
  });
}

async function sendInTrx(trx: Db, auth: AuthContext, quotationId: number, request: Record<string, any>, client: ClientInfo) {
  const q = await trx('quotations').where({ id: quotationId }).forUpdate().first();
  if (q.status !== 'DRAFT') throw invalidState('Only draft quotations can be sent');
  await trx('quotations').where({ id: quotationId }).update({ status: 'SENT', sent_at: trx.fn.now(3) });
  await transitionStatus(trx, request as any, 'AWAITING_QUOTATION_APPROVAL', { actorUserId: auth.userId, notifyCustomer: false });
  await addActivity(trx, request.id, 'QUOTATION_SENT', `${q.revision > 1 ? 'Revised quotation' : 'Quotation'} ${q.reference} sent for your approval`, { actorUserId: auth.userId });
  await notify({
    userIds: [request.customer_user_id], type: 'QUOTATION_SENT', title: `${request.reference}: quotation ready for approval`,
    body: `${q.revision > 1 ? 'A revised quotation' : 'A quotation'} (${q.reference}) is waiting for your decision. No chargeable work will be done until you approve it.`,
    link: `/account/requests/${request.id}`,
  }, trx);
  await audit({ actorUserId: auth.userId, action: 'quotation.sent', entityType: 'quotation', entityId: quotationId, ...client }, trx);
}

/**
 * Customer decision. Approval reserves the quoted parts in the shared inventory. When this is a revision
 * of an approved quotation, the previous one is superseded: its parts are carried over to matching new
 * lines (so nothing is reserved twice) and parts no longer needed are released.
 */
export async function decideQuotation(auth: AuthContext, quotationId: number, decision: 'APPROVE' | 'DECLINE', comment: string | undefined, client: ClientInfo) {
  return db.transaction(async (trx) => {
    const q0 = await trx('quotations').where({ id: quotationId }).first('support_request_id');
    if (!q0) throw notFound('Quotation');
    const access = await loadRequestFor(auth, q0.support_request_id, trx, { forUpdate: true });
    const request = access.request;
    const isOwner = request.customer_user_id === auth.userId;
    const isOrgAdmin = auth.org?.role === 'ORG_ADMIN' && auth.org.id === request.organization_id;
    if (!access.isCustomerView || !(isOwner || isOrgAdmin)) throw forbidden('Only the customer can approve or decline a quotation');
    if (TERMINAL_STATUSES.includes(request.status)) throw invalidState('This request is closed');

    const q = await trx('quotations').where({ id: quotationId }).forUpdate().first();
    if (q.status !== 'SENT') throw invalidState(`This quotation is ${q.status.toLowerCase()} and can no longer be ${decision === 'APPROVE' ? 'approved' : 'declined'}`);
    // validity is derived from valid_until (no write here: it would be rolled back by the throw)
    if (decision === 'APPROVE' && new Date(`${String(q.valid_until).slice(0, 10)}T23:59:59Z`) < new Date()) {
      throw invalidState('This quotation has expired. Ask your technician for an updated quotation.');
    }
    const previousApproved = await trx('quotations').where({ support_request_id: request.id, status: 'APPROVED' }).first('id');

    if (decision === 'DECLINE') {
      await trx('quotations').where({ id: quotationId }).update({ status: 'DECLINED', decided_at: trx.fn.now(3), decided_by: auth.userId, decision_comment: comment ?? null });
      await transitionStatus(trx, request as any, previousApproved ? 'APPROVED' : 'DIAGNOSIS_IN_PROGRESS', {
        actorUserId: auth.userId, note: previousApproved ? 'Revised quotation declined — the previously approved scope still applies' : 'Quotation declined', notifyCustomer: false,
      });
      await addActivity(trx, request.id, 'QUOTATION_DECLINED', `Quotation ${q.reference} declined${comment ? `: ${comment}` : ''}`, { actorUserId: auth.userId });
    } else {
      await trx('quotations').where({ id: quotationId }).update({ status: 'APPROVED', decided_at: trx.fn.now(3), decided_by: auth.userId, decision_comment: comment ?? null });
      if (previousApproved) await trx('quotations').where({ id: previousApproved.id }).update({ status: 'SUPERSEDED' });
      const allReserved = await allocatePartsForApproval(trx, request.id, quotationId, previousApproved?.id ?? null, auth.userId);
      await transitionStatus(trx, request as any, 'APPROVED', { actorUserId: auth.userId, note: `Quotation ${q.reference} approved`, notifyCustomer: false });
      if (!allReserved && request.service_type !== 'REMOTE_SUPPORT' && request.service_type !== 'CONSULTATION') {
        await transitionStatus(trx, request as any, 'AWAITING_PARTS', { actorUserId: null, note: 'Some parts must be ordered before the repair can continue' });
      }
      await addActivity(trx, request.id, 'QUOTATION_APPROVED', `Quotation ${q.reference} approved`, { actorUserId: auth.userId });
    }
    if (request.assigned_technician_id) {
      await notify({
        userIds: [request.assigned_technician_id], type: decision === 'APPROVE' ? 'QUOTATION_APPROVED' : 'QUOTATION_DECLINED',
        title: `${request.reference}: quotation ${decision === 'APPROVE' ? 'approved' : 'declined'}`,
        body: comment ? `Customer comment: ${comment}` : `The customer ${decision === 'APPROVE' ? 'approved' : 'declined'} ${q.reference}.`,
        link: `/staff/requests/${request.id}`,
      }, trx);
    }
    await audit({ actorUserId: auth.userId, action: decision === 'APPROVE' ? 'quotation.approved' : 'quotation.declined', entityType: 'quotation', entityId: quotationId, metadata: { requestId: request.id, totalMinor: q.total_minor, comment }, ...client }, trx);
    return { status: decision === 'APPROVE' ? 'APPROVED' : 'DECLINED' };
  });
}

async function allocatePartsForApproval(trx: Db, requestId: number, quotationId: number, previousQuotationId: number | null, actorUserId: number) {
  const newLines = await trx('quotation_items').where({ quotation_id: quotationId, item_type: 'PART' }).whereNotNull('product_id').orderBy('product_id');
  // parts held under the superseded quotation, still in play
  const carried = previousQuotationId
    ? await trx('repair_parts as p').join('quotation_items as qi', 'qi.id', 'p.quotation_item_id')
        .where({ 'qi.quotation_id': previousQuotationId }).whereIn('p.stock_state', ['NONE', 'RESERVED', 'CONSUMED'])
        .orderBy('p.product_id').select('p.id', 'p.product_id', 'p.quantity', 'p.stock_state')
    : [];
  const used = new Set<number>();
  let allReserved = true;
  for (const line of newLines) {
    let remaining = line.quantity as number;
    for (const old of carried) {
      if (remaining <= 0) break;
      if (used.has(old.id) || old.product_id !== line.product_id || old.quantity > remaining) continue;
      await trx('repair_parts').where({ id: old.id }).update({ quotation_item_id: line.id });
      used.add(old.id);
      remaining -= old.quantity;
      if (old.stock_state === 'NONE') allReserved &&= await tryReserve(trx, old.id, actorUserId);
    }
    if (remaining > 0) {
      const [partId] = await trx('repair_parts').insert({
        support_request_id: requestId, quotation_item_id: line.id, product_id: line.product_id, quantity: remaining, chargeable: true, stock_state: 'NONE',
      });
      allReserved &&= await tryReserve(trx, partId as number, actorUserId);
    }
  }
  // parts from the old scope that the revision no longer includes
  for (const old of carried) {
    if (used.has(old.id)) continue;
    if (old.stock_state === 'RESERVED') await releaseLine(trx, 'repair_parts', old.id, actorUserId, 'Removed by revised quotation');
    else if (old.stock_state === 'NONE') await trx('repair_parts').where({ id: old.id }).update({ stock_state: 'RELEASED', released_at: trx.fn.now(3), awaiting_stock: false });
    // CONSUMED parts stay recorded against the request (already installed)
  }
  return allReserved;
}
