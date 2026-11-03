import express, { Router } from 'express';
import { z } from 'zod';
import { PAYMENT_METHODS, PERMISSIONS, recordPaymentSchema, refundPaymentSchema } from '@dante/shared';
import { authenticate, requireAuth, requirePermission } from '../../core/auth.js';
import { requestContext } from '../../core/audit.js';
import { created, idFrom, ok, pageMeta, parse } from '../../core/http.js';
import { db } from '../../db/knex.js';
import * as svc from './payments.service.js';

const payableSchema = z.object({ payableType: z.enum(['SALES_ORDER', 'SUPPORT_REQUEST']), payableId: z.coerce.number().int().positive() });

export function paymentRoutes() {
  const r = Router();
  r.use(authenticate);

  r.get('/', async (req, res) => {
    const filters = parse(z.object({
      status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'CANCELLED']).optional(),
      payableType: z.enum(['SALES_ORDER', 'SUPPORT_REQUEST']).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
    }), req.query);
    const { items, total } = await svc.listPayments(requireAuth(req), filters);
    ok(res, items, pageMeta(filters.page, filters.pageSize, total));
  });

  r.get('/:id/transactions', requirePermission(PERMISSIONS.PAYMENTS_VIEW), async (req, res) => {
    const rows = await db('payment_transactions as t').leftJoin('users as u', 'u.id', 't.actor_user_id').where('t.payment_id', idFrom(req)).orderBy('t.id')
      .select('t.*', db.raw("CONCAT(u.first_name, ' ', u.last_name) as actor"));
    ok(res, rows.map((t) => ({ id: t.id, eventType: t.event_type, statusAfter: t.status_after, amountMinor: t.amount_minor, actor: t.actor, providerEventId: t.provider_event_id, createdAt: t.created_at })));
  });

  /** Staff: record an offline payment received at the counter / seen on the bank statement. */
  r.post('/record', requirePermission(PERMISSIONS.PAYMENTS_RECORD), async (req, res) => {
    const input = parse(recordPaymentSchema, req.body);
    const id = await svc.recordOfflinePayment(requireAuth(req), input, requestContext(req));
    created(res, svc.mapPayment(await db('payments').where({ id }).first()));
  });

  /** Customer: "I have paid by transfer / mobile money, reference X". */
  r.post('/claims', async (req, res) => {
    const input = parse(payableSchema.extend({
      method: z.enum(PAYMENT_METHODS), amountMinor: z.coerce.number().int().positive(), reference: z.string().trim().min(3).max(120),
    }), req.body);
    const id = await svc.submitPaymentClaim(requireAuth(req), input, requestContext(req));
    created(res, svc.mapPayment(await db('payments').where({ id }).first(), true));
  });

  r.post('/:id/verify', requirePermission(PERMISSIONS.PAYMENTS_RECORD), async (req, res) => {
    const { approve, note } = parse(z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() }), req.body);
    await svc.verifyPaymentClaim(requireAuth(req), idFrom(req), approve, note, requestContext(req));
    ok(res, svc.mapPayment(await db('payments').where({ id: idFrom(req) }).first()));
  });

  r.post('/checkout', async (req, res) => {
    const { payableType, payableId } = parse(payableSchema, req.body);
    created(res, await svc.startGatewayCheckout(requireAuth(req), payableType, payableId, requestContext(req)));
  });

  r.post('/:id/refund', requirePermission(PERMISSIONS.PAYMENTS_REFUND), async (req, res) => {
    const { reason } = parse(refundPaymentSchema, req.body);
    await svc.refundPayment(requireAuth(req), idFrom(req), reason, requestContext(req));
    ok(res, svc.mapPayment(await db('payments').where({ id: idFrom(req) }).first()));
  });

  return r;
}

/** Mounted before the JSON parser: providers sign the exact raw bytes. */
export function paymentWebhookRoutes() {
  const r = Router();
  r.post('/gateway', express.raw({ type: '*/*', limit: '512kb' }), async (req, res) => {
    const result = await svc.handleGatewayWebhook(req.body as Buffer, req.headers);
    ok(res, result);
  });
  return r;
}
