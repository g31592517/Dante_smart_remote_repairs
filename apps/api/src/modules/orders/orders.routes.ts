import { Router } from 'express';
import { z } from 'zod';
import { checkoutSchema, ORDER_STATUSES, orderStatusSchema } from '@dante/shared';
import { authenticate, requireAuth, requireCustomer } from '../../core/auth.js';
import { requestContext } from '../../core/audit.js';
import { created, idFrom, ok, pageMeta, parse } from '../../core/http.js';
import * as svc from './orders.service.js';

export function orderRoutes() {
  const r = Router();
  r.use(authenticate);

  r.post('/checkout', requireCustomer, async (req, res) => {
    const input = parse(checkoutSchema, req.body);
    const id = await svc.checkout(requireAuth(req), input, requestContext(req));
    created(res, await svc.orderDetail(requireAuth(req), id));
  });

  r.get('/', async (req, res) => {
    const f = parse(z.object({
      status: z.enum(ORDER_STATUSES).optional(), q: z.string().trim().max(100).optional(),
      page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
    }), req.query);
    const { items, total } = await svc.listOrders(requireAuth(req), f);
    ok(res, items, pageMeta(f.page, f.pageSize, total));
  });

  r.get('/:id', async (req, res) => ok(res, await svc.orderDetail(requireAuth(req), idFrom(req))));

  r.post('/:id/status', async (req, res) => {
    const { status, note } = parse(orderStatusSchema, req.body);
    await svc.changeOrderStatus(requireAuth(req), idFrom(req), status, note, requestContext(req));
    ok(res, await svc.orderDetail(requireAuth(req), idFrom(req)));
  });

  r.post('/:id/cancel', requireCustomer, async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
    await svc.cancelByCustomer(requireAuth(req), idFrom(req), reason, requestContext(req));
    ok(res, await svc.orderDetail(requireAuth(req), idFrom(req)));
  });

  return r;
}
