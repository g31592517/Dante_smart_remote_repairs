import { Router } from 'express';
import { addressSchema, deviceSchema, updateProfileSchema } from '@dante/shared';
import { authenticate, requireAuth } from '../../core/auth.js';
import { notFound } from '../../core/errors.js';
import { created, idFrom, ok, parse } from '../../core/http.js';
import { db } from '../../db/knex.js';
import { currentUser } from '../auth/auth.service.js';
import { accessibleDevicesQuery, createDevice, deviceHistory, mapDevice, updateDevice } from './devices.service.js';

function mapAddress(a: Record<string, any>) {
  return {
    id: a.id, label: a.label, line1: a.line1, line2: a.line2, city: a.city, region: a.region, postalCode: a.postal_code,
    country: a.country, phone: a.phone, isDefault: !!a.is_default,
  };
}

/** The signed-in user's own profile, addresses, devices and consents. */
export function accountRoutes() {
  const r = Router();
  r.use(authenticate);

  r.get('/profile', async (req, res) => ok(res, await currentUser(requireAuth(req).userId)));

  r.patch('/profile', async (req, res) => {
    const input = parse(updateProfileSchema, req.body);
    await db('users').where({ id: requireAuth(req).userId }).update({
      ...(input.firstName ? { first_name: input.firstName } : {}),
      ...(input.lastName ? { last_name: input.lastName } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
    });
    ok(res, await currentUser(requireAuth(req).userId));
  });

  r.get('/addresses', async (req, res) => {
    const rows = await db('customer_addresses').where({ user_id: requireAuth(req).userId }).orderBy([{ column: 'is_default', order: 'desc' }, 'id']);
    ok(res, rows.map(mapAddress));
  });

  r.post('/addresses', async (req, res) => {
    const a = parse(addressSchema, req.body);
    const userId = requireAuth(req).userId;
    const id = await db.transaction(async (trx) => {
      const count = await trx('customer_addresses').where({ user_id: userId }).count({ n: '*' }).first();
      const makeDefault = a.isDefault || Number(count?.n) === 0;
      if (makeDefault) await trx('customer_addresses').where({ user_id: userId }).update({ is_default: false });
      const [newId] = await trx('customer_addresses').insert({
        user_id: userId, label: a.label, line1: a.line1, line2: a.line2 ?? null, city: a.city, region: a.region ?? null,
        postal_code: a.postalCode ?? null, country: a.country, phone: a.phone ?? null, is_default: makeDefault,
      });
      return newId;
    });
    created(res, mapAddress(await db('customer_addresses').where({ id }).first()));
  });

  r.put('/addresses/:id', async (req, res) => {
    const a = parse(addressSchema, req.body);
    const userId = requireAuth(req).userId;
    const id = idFrom(req);
    await db.transaction(async (trx) => {
      const existing = await trx('customer_addresses').where({ id, user_id: userId }).first('id');
      if (!existing) throw notFound('Address');
      if (a.isDefault) await trx('customer_addresses').where({ user_id: userId }).update({ is_default: false });
      await trx('customer_addresses').where({ id }).update({
        label: a.label, line1: a.line1, line2: a.line2 ?? null, city: a.city, region: a.region ?? null, postal_code: a.postalCode ?? null,
        country: a.country, phone: a.phone ?? null, ...(a.isDefault ? { is_default: true } : {}),
      });
    });
    ok(res, mapAddress(await db('customer_addresses').where({ id }).first()));
  });

  r.delete('/addresses/:id', async (req, res) => {
    const n = await db('customer_addresses').where({ id: idFrom(req), user_id: requireAuth(req).userId }).del();
    if (!n) throw notFound('Address');
    ok(res, { deleted: true });
  });

  r.get('/devices', async (req, res) => {
    const rows = await accessibleDevicesQuery(requireAuth(req)).orderBy('id', 'desc');
    ok(res, rows.map(mapDevice));
  });

  r.post('/devices', async (req, res) => {
    const input = parse(deviceSchema, req.body);
    const id = await createDevice(requireAuth(req), input);
    created(res, mapDevice(await db('devices').where({ id }).first()));
  });

  r.patch('/devices/:id', async (req, res) => {
    const input = parse(deviceSchema.partial(), req.body);
    await updateDevice(requireAuth(req), idFrom(req), input);
    ok(res, mapDevice(await db('devices').where({ id: idFrom(req) }).first()));
  });

  r.get('/devices/:id/history', async (req, res) => ok(res, await deviceHistory(requireAuth(req), idFrom(req))));

  r.get('/consents', async (req, res) => {
    const rows = await db('customer_consents')
      .where({ user_id: requireAuth(req).userId })
      .orderBy('granted_at', 'desc')
      .select('id', 'consent_type', 'subject_type', 'subject_id', 'consent_version', 'granted_at', 'revoked_at');
    ok(res, rows.map((c) => ({
      id: c.id, consentType: c.consent_type, subjectType: c.subject_type, subjectId: c.subject_id, version: c.consent_version,
      grantedAt: c.granted_at, revokedAt: c.revoked_at,
    })));
  });

  return r;
}
