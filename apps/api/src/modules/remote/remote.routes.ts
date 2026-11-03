import { Router } from 'express';
import { z } from 'zod';
import {
  authorizeRemoteSessionSchema, completeRemoteSessionSchema, remoteSessionStatusSchema, requestRemoteSessionSchema, revokeConsentSchema,
  PERMISSIONS,
} from '@dante/shared';
import { authenticate, requireAuth, requirePermission } from '../../core/auth.js';
import { requestContext } from '../../core/audit.js';
import { integrationUnavailable } from '../../core/errors.js';
import { created, idFrom, ok, parse } from '../../core/http.js';
import { db } from '../../db/knex.js';
import { anydeskClient } from './anydesk.client.js';
import * as svc from './remote.service.js';

async function sessionView(id: number, customerView: boolean) {
  return svc.mapRemoteSession(await db('remote_sessions').where({ id }).first(), customerView);
}

export function remoteRoutes() {
  const r = Router();
  r.use(authenticate);

  r.post('/', async (req, res) => {
    const body = parse(requestRemoteSessionSchema.extend({ supportRequestId: z.coerce.number().int().positive() }), req.body);
    const id = await svc.requestSession(requireAuth(req), body.supportRequestId, body.instructions, requestContext(req));
    created(res, await sessionView(id, false));
  });

  r.post('/:id/authorize', async (req, res) => {
    const input = parse(authorizeRemoteSessionSchema, req.body);
    await svc.authorizeSession(requireAuth(req), idFrom(req), input.anydeskAddress, input.consentVersion, requestContext(req));
    ok(res, await sessionView(idFrom(req), true));
  });

  r.post('/:id/revoke', async (req, res) => {
    const { reason } = parse(revokeConsentSchema, req.body ?? {});
    await svc.revokeSession(requireAuth(req), idFrom(req), reason, requestContext(req));
    ok(res, await sessionView(idFrom(req), true));
  });

  /** Returns { anydeskUrl } — the client opens it to launch the technician's AnyDesk. */
  r.post('/:id/initiate', async (req, res) => {
    ok(res, await svc.initiateSession(requireAuth(req), idFrom(req), requestContext(req)));
  });

  r.post('/:id/status', async (req, res) => {
    const { status, note } = parse(remoteSessionStatusSchema, req.body);
    const auth = requireAuth(req);
    if (status === 'INITIATED') return ok(res, await svc.initiateSession(auth, idFrom(req), requestContext(req)));
    if (status === 'ACTIVE') await svc.markActive(auth, idFrom(req), requestContext(req));
    if (status === 'CANCELLED') await svc.cancelSession(auth, idFrom(req), note, requestContext(req));
    ok(res, await sessionView(idFrom(req), false));
  });

  r.post('/:id/complete', async (req, res) => {
    const input = parse(completeRemoteSessionSchema, req.body);
    await svc.completeSession(requireAuth(req), idFrom(req), input, requestContext(req));
    ok(res, await sessionView(idFrom(req), false));
  });

  r.post('/:id/sync', async (req, res) => {
    const result = await svc.syncSession(requireAuth(req), idFrom(req));
    ok(res, { ...result, remoteSession: await sessionView(idFrom(req), false) });
  });

  /** Connectivity check for the AnyDesk REST API (admin settings page). */
  r.get('/anydesk/status', requirePermission(PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.REMOTE_VIEW_ALL), async (_req, res) => {
    const api = anydeskClient();
    if (!api) throw integrationUnavailable('AnyDesk REST API is not configured (ANYDESK_LICENSE_ID / ANYDESK_API_PASSWORD). The manual workflow is active.');
    const info = await api.sysinfo();
    ok(res, { connected: true, name: info.name, apiVersion: info['api-ver'], license: info.license?.name, licenseExpires: info.license?.expires });
  });

  return r;
}
