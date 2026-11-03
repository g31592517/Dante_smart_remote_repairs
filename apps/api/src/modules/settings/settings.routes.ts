import { Router } from 'express';
import { categorySchema, settingsUpdateSchema, PERMISSIONS } from '@dante/shared';
import { authenticate, optionalAuth, requireAuth, requirePermission } from '../../core/auth.js';
import { audit, requestContext } from '../../core/audit.js';
import { notFound } from '../../core/errors.js';
import { created, idFrom, ok, parse } from '../../core/http.js';
import { env } from '../../config/env.js';
import { db } from '../../db/knex.js';
import { emailChannel, smsChannel, whatsappChannel } from '../notifications/channels.js';
import { anydeskApiConfigured } from '../remote/anydesk.client.js';
import { activeGateway } from '../payments/gateway.js';
import { getPublicSettings, getSettings, updateSettings } from './settings.service.js';

function mapCategory(c: Record<string, any>) {
  return {
    id: c.id, name: c.name, description: c.description, defaultServiceType: c.default_service_type, icon: c.icon,
    sortOrder: c.sort_order, isActive: !!c.is_active,
  };
}

export function settingsRoutes() {
  const r = Router();

  r.get('/public', async (_req, res) => ok(res, await getPublicSettings()));

  r.get('/service-categories', optionalAuth, async (req, res) => {
    const all = req.auth?.permissions.has(PERMISSIONS.CATEGORIES_MANAGE) && req.query.all === 'true';
    const rows = await db('service_categories').modify((q) => (all ? q : q.where('is_active', true))).orderBy(['sort_order', 'name']);
    ok(res, rows.map(mapCategory));
  });

  r.post('/service-categories', authenticate, requirePermission(PERMISSIONS.CATEGORIES_MANAGE), async (req, res) => {
    const c = parse(categorySchema, req.body);
    const [id] = await db('service_categories').insert({
      name: c.name, description: c.description ?? null, default_service_type: c.defaultServiceType ?? null, icon: c.icon ?? null,
      sort_order: c.sortOrder, is_active: c.active,
    });
    await audit({ actorUserId: requireAuth(req).userId, action: 'category.created', entityType: 'service_category', entityId: id as number, ...requestContext(req) });
    created(res, mapCategory(await db('service_categories').where({ id }).first()));
  });

  r.put('/service-categories/:id', authenticate, requirePermission(PERMISSIONS.CATEGORIES_MANAGE), async (req, res) => {
    const c = parse(categorySchema, req.body);
    const id = idFrom(req);
    const n = await db('service_categories').where({ id }).update({
      name: c.name, description: c.description ?? null, default_service_type: c.defaultServiceType ?? null, icon: c.icon ?? null,
      sort_order: c.sortOrder, is_active: c.active,
    });
    if (!n) throw notFound('Category');
    await audit({ actorUserId: requireAuth(req).userId, action: 'category.updated', entityType: 'service_category', entityId: id, ...requestContext(req) });
    ok(res, mapCategory(await db('service_categories').where({ id }).first()));
  });

  r.get('/', authenticate, requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (_req, res) => ok(res, await getSettings(db, true)));

  r.patch('/', authenticate, requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res) => {
    const patch = parse(settingsUpdateSchema, req.body);
    ok(res, await updateSettings(patch, requireAuth(req).userId));
  });

  /** Which external integrations are configured. Reports presence only — never secrets. */
  r.get('/integrations', authenticate, requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (_req, res) => {
    const failed = await db('notification_deliveries').where({ status: 'FAILED' }).count({ n: '*' }).first();
    ok(res, {
      email: { transport: env.EMAIL_TRANSPORT, configured: emailChannel.configured, failedDeliveries: Number(failed?.n ?? 0) },
      sms: { provider: env.SMS_PROVIDER ?? null, configured: smsChannel.configured },
      whatsapp: { provider: env.WHATSAPP_PROVIDER ?? null, configured: whatsappChannel.configured },
      anydeskApi: { configured: anydeskApiConfigured(), baseUrl: env.ANYDESK_API_URL },
      paymentGateway: { provider: activeGateway()?.name ?? 'none', configured: !!activeGateway() },
    });
  });

  return r;
}
