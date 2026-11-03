import type { z } from 'zod';
import {
  PERMISSIONS, REMOTE_SESSION_TRANSITIONS, TERMINAL_STATUSES, anyDeskUrl,
  type RemoteSessionStatus, type completeRemoteSessionSchema,
} from '@dante/shared';
import type { AuthContext } from '../../core/auth.js';
import { audit } from '../../core/audit.js';
import { badRequest, forbidden, integrationUnavailable, invalidState, notFound } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { db, type Db } from '../../db/knex.js';
import { notify } from '../notifications/notifications.service.js';
import { getSettings } from '../settings/settings.service.js';
import { loadRequestFor } from '../support/support.access.js';
import { addActivity, transitionStatus } from '../support/support.workflow.js';
import { anydeskClient, type AnyDeskSession } from './anydesk.client.js';

type ClientInfo = { ip?: string; userAgent?: string };
const OPEN: RemoteSessionStatus[] = ['REQUESTED', 'AUTHORIZED', 'INITIATED', 'ACTIVE'];

export function mapRemoteSession(s: Record<string, any>, customerView: boolean) {
  const connectable = ['AUTHORIZED', 'INITIATED', 'ACTIVE'].includes(s.status) && !!s.anydesk_address;
  return {
    id: s.id,
    status: s.status as RemoteSessionStatus,
    instructions: s.instructions,
    anydeskAddress: s.anydesk_address,
    // The launch link is only exposed to staff and only after the customer has authorised the session.
    anydeskUrl: !customerView && connectable ? anyDeskUrl(s.anydesk_address) : undefined,
    requestedAt: s.requested_at,
    authorizedAt: s.authorized_at,
    initiatedAt: s.initiated_at,
    activeAt: s.active_at,
    completedAt: s.completed_at,
    revokedAt: s.revoked_at,
    revokeReason: s.revoke_reason,
    outcome: s.outcome,
    workPerformed: s.work_performed,
    evidence: {
      source: s.session_data_source,
      anydeskSessionId: s.anydesk_session_id,
      startedAt: s.session_started_at,
      endedAt: s.session_ended_at,
      durationSeconds: s.session_duration_seconds,
      apiSyncedAt: s.api_synced_at,
    },
  };
}

async function loadSession(sessionId: number, conn: Db, forUpdate = true) {
  const q = conn('remote_sessions').where({ id: sessionId }).first();
  if (forUpdate) q.forUpdate();
  const s = await q;
  if (!s) throw notFound('Remote session');
  return s;
}

function assertTransition(from: RemoteSessionStatus, to: RemoteSessionStatus) {
  if (!REMOTE_SESSION_TRANSITIONS[from].includes(to)) throw invalidState(`Remote session is ${from.toLowerCase()} and cannot become ${to.toLowerCase()}`);
}

/** Staff who may operate the session: the assigned technician, or a manager with remote.operate. */
async function staffAccess(auth: AuthContext, requestId: number, conn: Db) {
  if (!auth.permissions.has(PERMISSIONS.REMOTE_OPERATE)) throw forbidden();
  const access = await loadRequestFor(auth, requestId, conn, { forUpdate: true });
  if (access.isCustomerView) throw forbidden();
  const isAssigned = access.request.assigned_technician_id === auth.userId;
  if (!isAssigned && !auth.permissions.has(PERMISSIONS.REQUESTS_MANAGE)) throw forbidden('Only the assigned technician can run this session');
  return access.request;
}

/** Step 1 (staff): ask the customer to prepare AnyDesk and authorise a session. */
export async function requestSession(auth: AuthContext, requestId: number, instructions: string | undefined, client: ClientInfo) {
  return db.transaction(async (trx) => {
    const request = await staffAccess(auth, requestId, trx);
    if (!request.assigned_technician_id) throw invalidState('Assign a technician before requesting a remote session');
    if (['SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'COMPLETED', ...TERMINAL_STATUSES].includes(request.status)) {
      throw invalidState('Remote sessions can only be requested for an accepted, assigned request that is still open');
    }
    const open = await trx('remote_sessions').where({ support_request_id: requestId }).whereIn('status', OPEN).first('id');
    if (open) throw invalidState('This request already has an open remote session');
    const [id] = await trx('remote_sessions').insert({
      support_request_id: requestId,
      technician_user_id: request.assigned_technician_id,
      requested_by: auth.userId,
      status: 'REQUESTED',
      instructions: instructions ?? null,
    });
    if (['ASSIGNED', 'DIAGNOSIS_IN_PROGRESS', 'APPROVED'].includes(request.status)) {
      await transitionStatus(trx, request as any, 'AWAITING_CUSTOMER', { actorUserId: auth.userId, note: 'Please prepare your device for a remote support session', notifyCustomer: false });
    }
    await addActivity(trx, requestId, 'REMOTE_REQUESTED', 'Remote support session requested — follow the instructions on this page to install AnyDesk and authorise the session', { actorUserId: auth.userId });
    await notify({
      userIds: [request.customer_user_id], type: 'REMOTE_SESSION_REQUESTED', title: `${request.reference}: remote support session`,
      body: 'Your technician is ready to help remotely. Open the request page, install AnyDesk if needed, enter your AnyDesk ID and authorise the session.',
      link: `/account/requests/${requestId}`,
    }, trx);
    await audit({ actorUserId: auth.userId, action: 'remote.requested', entityType: 'remote_session', entityId: id as number, metadata: { requestId }, ...client }, trx);
    return id as number;
  });
}

/** Step 2 (customer): provide the AnyDesk ID and give explicit, recorded consent. */
export async function authorizeSession(auth: AuthContext, sessionId: number, address: string, consentVersion: string, client: ClientInfo) {
  return db.transaction(async (trx) => {
    const s = await loadSession(sessionId, trx);
    const access = await loadRequestFor(auth, s.support_request_id, trx, { forUpdate: true });
    // consent must come from the person who raised the request (the device user), not from staff
    if (!access.isCustomerView || access.request.customer_user_id !== auth.userId) throw forbidden('Only the customer who raised this request can authorise remote access');
    assertTransition(s.status, 'AUTHORIZED');
    const settings = await getSettings(trx);
    if (consentVersion !== settings.remoteConsentVersion) throw invalidState('The remote-access terms have changed. Reload the page and review them again.');
    const [consentId] = await trx('customer_consents').insert({
      user_id: auth.userId,
      consent_type: 'REMOTE_ACCESS',
      subject_type: 'REMOTE_SESSION',
      subject_id: sessionId,
      consent_version: settings.remoteConsentVersion,
      consent_text: settings.remoteConsentText,
      ip: client.ip ?? null,
      user_agent: client.userAgent?.slice(0, 255) ?? null,
    });
    await trx('remote_sessions').where({ id: sessionId }).update({ status: 'AUTHORIZED', anydesk_address: address, consent_id: consentId, authorized_at: trx.fn.now(3) });
    await addActivity(trx, s.support_request_id, 'REMOTE_AUTHORIZED', 'Customer authorised the remote support session', { actorUserId: auth.userId });
    await notify({
      userIds: [s.technician_user_id], type: 'REMOTE_SESSION_AUTHORIZED', title: `${access.request.reference}: customer is ready for remote support`,
      body: 'The customer entered their AnyDesk ID and authorised the session. Open the job and click "Connect using AnyDesk".',
      link: `/staff/requests/${s.support_request_id}`,
    }, trx);
    await audit({ actorUserId: auth.userId, action: 'remote.authorized', entityType: 'remote_session', entityId: sessionId, metadata: { consentId, version: settings.remoteConsentVersion }, ...client }, trx);
  });
}

/**
 * Step 3 (technician): record that the connection is being launched and return the AnyDesk URL.
 * Refused unless the customer's authorisation is present and not withdrawn.
 */
export async function initiateSession(auth: AuthContext, sessionId: number, client: ClientInfo) {
  return db.transaction(async (trx) => {
    const s = await loadSession(sessionId, trx);
    const request = await staffAccess(auth, s.support_request_id, trx);
    if (s.status !== 'INITIATED') assertTransition(s.status, 'INITIATED'); // re-launching an initiated session is allowed
    const consent = s.consent_id ? await trx('customer_consents').where({ id: s.consent_id }).first('revoked_at') : null;
    if (!consent || consent.revoked_at || !s.anydesk_address) throw invalidState('The customer has not authorised this session');
    if (s.status === 'AUTHORIZED') {
      await trx('remote_sessions').where({ id: sessionId }).update({ status: 'INITIATED', initiated_at: trx.fn.now(3), initiated_by: auth.userId });
      if (['AWAITING_CUSTOMER', 'ASSIGNED', 'APPROVED'].includes(request.status)) {
        await transitionStatus(trx, request as any, 'DIAGNOSIS_IN_PROGRESS', { actorUserId: auth.userId, notifyCustomer: false });
      }
      await addActivity(trx, s.support_request_id, 'REMOTE_INITIATED', 'Technician is connecting with AnyDesk — accept the incoming connection in your AnyDesk window', { actorUserId: auth.userId });
      await notify({
        userIds: [request.customer_user_id], type: 'REMOTE_SESSION_CONNECTING', title: `${request.reference}: technician is connecting`,
        body: 'Your technician is connecting now. Click "Accept" in the AnyDesk window on your device. You can end the session at any time.',
        link: `/account/requests/${s.support_request_id}`, email: false,
      }, trx);
    }
    await audit({ actorUserId: auth.userId, action: 'remote.initiated', entityType: 'remote_session', entityId: sessionId, metadata: { requestId: s.support_request_id, address: s.anydesk_address }, ...client }, trx);
    return { anydeskUrl: anyDeskUrl(s.anydesk_address) };
  });
}

/** Technician confirms the customer accepted and the session is live. */
export async function markActive(auth: AuthContext, sessionId: number, client: ClientInfo) {
  await db.transaction(async (trx) => {
    const s = await loadSession(sessionId, trx);
    await staffAccess(auth, s.support_request_id, trx);
    assertTransition(s.status, 'ACTIVE');
    await trx('remote_sessions').where({ id: sessionId }).update({ status: 'ACTIVE', active_at: trx.fn.now(3) });
    await addActivity(trx, s.support_request_id, 'REMOTE_ACTIVE', 'Remote session in progress', { actorUserId: auth.userId });
    await audit({ actorUserId: auth.userId, action: 'remote.active', entityType: 'remote_session', entityId: sessionId, ...client }, trx);
  });
}

export async function completeSession(auth: AuthContext, sessionId: number, input: z.infer<typeof completeRemoteSessionSchema>, client: ClientInfo) {
  // Try to pull authoritative session data from AnyDesk before closing (best effort, outside the transaction).
  const apiData = await findApiSession(sessionId).catch((err) => {
    logger.warn({ err }, 'AnyDesk API sync failed during completion; using manual data');
    return null;
  });
  return db.transaction(async (trx) => {
    const s = await loadSession(sessionId, trx);
    const request = await staffAccess(auth, s.support_request_id, trx);
    assertTransition(s.status, 'COMPLETED');
    const evidence = apiData
      ? {
          session_data_source: 'ANYDESK_API', anydesk_session_id: apiData.sid,
          session_started_at: apiData.startTime ? new Date(apiData.startTime * 1000) : null,
          session_ended_at: apiData.endTime ? new Date(apiData.endTime * 1000) : null,
          session_duration_seconds: apiData.duration, api_synced_at: trx.fn.now(3),
        }
      : input.anydeskSessionId || input.startedAt
        ? {
            session_data_source: 'MANUAL', anydesk_session_id: input.anydeskSessionId ?? null,
            session_started_at: input.startedAt ? new Date(input.startedAt) : null,
            session_ended_at: input.endedAt ? new Date(input.endedAt) : null,
            session_duration_seconds: input.startedAt && input.endedAt ? Math.max(0, Math.round((Date.parse(input.endedAt) - Date.parse(input.startedAt)) / 1000)) : null,
          }
        : {};
    if (input.startedAt && input.endedAt && Date.parse(input.endedAt) < Date.parse(input.startedAt)) throw badRequest('Session end time is before its start time');
    await trx('remote_sessions').where({ id: sessionId }).update({
      status: 'COMPLETED', completed_at: trx.fn.now(3), outcome: input.outcome, work_performed: input.workPerformed, ...evidence,
    });
    await trx('repair_work_logs').insert({
      support_request_id: s.support_request_id, technician_user_id: auth.userId, activity: `Remote session: ${input.workPerformed}`, visible_to_customer: true,
      minutes_spent: (evidence as { session_duration_seconds?: number | null }).session_duration_seconds ? Math.round(((evidence as any).session_duration_seconds as number) / 60) : 0,
    });
    await addActivity(trx, s.support_request_id, 'REMOTE_COMPLETED', `Remote session completed (${input.outcome.toLowerCase().replace(/_/g, ' ')})`, { actorUserId: auth.userId });
    await notify({
      userIds: [request.customer_user_id], type: 'REMOTE_SESSION_COMPLETED', title: `${request.reference}: remote session finished`,
      body: `Outcome: ${input.outcome.toLowerCase().replace(/_/g, ' ')}. ${input.workPerformed.slice(0, 300)}`, link: `/account/requests/${s.support_request_id}`,
    }, trx);
    await audit({ actorUserId: auth.userId, action: 'remote.completed', entityType: 'remote_session', entityId: sessionId, metadata: { outcome: input.outcome, source: (evidence as any).session_data_source ?? 'NONE' }, ...client }, trx);
  }).then(async () => {
    // label the session in AnyDesk with our reference (best effort)
    if (apiData) {
      const ref = await db('remote_sessions as s').join('support_requests as r', 'r.id', 's.support_request_id').where('s.id', sessionId).first('r.reference');
      await anydeskClient()?.setSessionComment(apiData.sid, `Support request ${ref?.reference}`).catch(() => undefined);
    }
  });
}

export async function cancelSession(auth: AuthContext, sessionId: number, note: string | undefined, client: ClientInfo) {
  await db.transaction(async (trx) => {
    const s = await loadSession(sessionId, trx);
    await staffAccess(auth, s.support_request_id, trx);
    assertTransition(s.status, 'CANCELLED');
    await trx('remote_sessions').where({ id: sessionId }).update({ status: 'CANCELLED' });
    await addActivity(trx, s.support_request_id, 'REMOTE_CANCELLED', `Remote session cancelled${note ? `: ${note}` : ''}`, { actorUserId: auth.userId });
    await audit({ actorUserId: auth.userId, action: 'remote.cancelled', entityType: 'remote_session', entityId: sessionId, ...client }, trx);
  });
}

/** Customer withdraws authorisation at any time before completion. */
export async function revokeSession(auth: AuthContext, sessionId: number, reason: string | undefined, client: ClientInfo) {
  let closeSid: string | null = null;
  await db.transaction(async (trx) => {
    const s = await loadSession(sessionId, trx);
    const access = await loadRequestFor(auth, s.support_request_id, trx);
    if (!access.isCustomerView || access.request.customer_user_id !== auth.userId) throw forbidden();
    assertTransition(s.status, 'REVOKED');
    await trx('remote_sessions').where({ id: sessionId }).update({ status: 'REVOKED', revoked_at: trx.fn.now(3), revoke_reason: reason ?? null });
    if (s.consent_id) await trx('customer_consents').where({ id: s.consent_id }).update({ revoked_at: trx.fn.now(3), revoke_reason: reason ?? null });
    await addActivity(trx, s.support_request_id, 'REMOTE_REVOKED', 'Customer withdrew authorisation for remote access', { actorUserId: auth.userId });
    await notify({
      userIds: [s.technician_user_id], type: 'REMOTE_SESSION_REVOKED', title: `${access.request.reference}: remote access withdrawn`,
      body: `The customer withdrew authorisation${reason ? `: ${reason}` : ''}. Disconnect immediately if you are still connected.`,
      link: `/staff/requests/${s.support_request_id}`,
    }, trx);
    await audit({ actorUserId: auth.userId, action: 'remote.revoked', entityType: 'remote_session', entityId: sessionId, metadata: { reason }, ...client }, trx);
    closeSid = s.anydesk_session_id;
  });
  // If the session is known to the API, ask AnyDesk to close it as well (best effort).
  const api = anydeskClient();
  if (api) {
    const sid = closeSid ?? (await findApiSession(sessionId).catch(() => null))?.sid;
    if (sid) await api.closeSession(sid).catch((err) => logger.warn({ err }, 'AnyDesk close failed'));
  }
}

/* ---------------- AnyDesk REST synchronisation ---------------- */

/**
 * Finds the AnyDesk session that corresponds to our session: an outgoing connection to the customer's
 * AnyDesk ID/alias, started after the technician clicked Connect. Returns null when the API is not
 * configured or nothing matches yet.
 */
async function findApiSession(sessionId: number): Promise<AnyDeskSession | null> {
  const api = anydeskClient();
  if (!api) return null;
  const s = await db('remote_sessions').where({ id: sessionId }).first();
  if (!s?.anydesk_address || !s.initiated_at) return null;
  if (s.anydesk_session_id && s.session_data_source === 'ANYDESK_API') return api.getSession(s.anydesk_session_id);
  const from = Math.floor(new Date(s.initiated_at).getTime() / 1000) - 300;
  const sessions = await api.listSessions({ from, sort: 'start-time' });
  const target = String(s.anydesk_address).toLowerCase();
  const match = sessions.filter((x) => x.to.cid === target || x.to.alias?.toLowerCase() === target).sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
  return match[0] ?? null;
}

/** Staff action: pull the latest session data from the AnyDesk API. */
export async function syncSession(auth: AuthContext, sessionId: number) {
  const s0 = await db('remote_sessions').where({ id: sessionId }).first('support_request_id');
  if (!s0) throw notFound('Remote session');
  await db.transaction((trx) => staffAccess(auth, s0.support_request_id, trx));
  if (!anydeskClient()) throw integrationUnavailable('The AnyDesk REST API is not configured. Record session details manually when completing the session.');
  const found = await findApiSession(sessionId);
  if (!found) return { matched: false as const };
  await db.transaction(async (trx) => {
    const s = await loadSession(sessionId, trx);
    const updates: Record<string, unknown> = {
      session_data_source: 'ANYDESK_API', anydesk_session_id: found.sid, api_synced_at: trx.fn.now(3),
      session_started_at: found.startTime ? new Date(found.startTime * 1000) : null,
      session_ended_at: found.endTime ? new Date(found.endTime * 1000) : null,
      session_duration_seconds: found.duration,
    };
    // the API confirming an active session is authoritative evidence that the customer accepted
    if (found.active && s.status === 'INITIATED') Object.assign(updates, { status: 'ACTIVE', active_at: trx.fn.now(3) });
    await trx('remote_sessions').where({ id: sessionId }).update(updates);
  });
  return { matched: true as const, session: found };
}
