import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAuth } from '../../core/auth.js';
import { ok, parse } from '../../core/http.js';
import { listNotifications, markRead } from './notifications.service.js';

export function notificationRoutes() {
  const r = Router();
  r.use(authenticate);

  r.get('/', async (req, res) => {
    ok(res, await listNotifications(requireAuth(req).userId, req.query.unread === 'true'));
  });

  r.post('/read', async (req, res) => {
    const body = parse(z.object({ ids: z.array(z.number().int().positive()).max(200).optional(), all: z.boolean().optional() }), req.body);
    await markRead(requireAuth(req).userId, body.all ? 'all' : body.ids ?? []);
    ok(res, await listNotifications(requireAuth(req).userId, false));
  });

  return r;
}
