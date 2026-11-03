import type { z } from 'zod';
import {
  CUSTOMER_CANCELLABLE, PERMISSIONS, REQUEST_STATUS_LABELS, SERVICE_TYPE_LABELS, SYSTEM_ONLY_TARGETS, TERMINAL_STATUSES,
  type CreateSupportRequestInput, type PermissionCode, type RequestStatus, type ServiceType,
  type listRequestsQuery, type reviewRequestSchema,
} from '@dante/shared';
import type { AuthContext } from '../../core/auth.js';
import { audit } from '../../core/audit.js';
import { badRequest, forbidden, invalidState, notFound } from '../../core/errors.js';
import { nextReference } from '../../core/references.js';
import { db, type Db } from '../../db/knex.js';
import { notify } from '../notifications/notifications.service.js';
import { assertDeviceAccess, createDevice } from '../users/devices.service.js';
import { requestBalance } from '../payments/balance.js';
import { releaseRequestParts } from '../repairs/parts.service.js';
import { assertStaff, loadRequestFor, scopeRequests, viewerOf } from './support.access.js';
import { addActivity, markFirstResponse, transitionStatus } from './support.workflow.js';

type ClientInfo = { ip?: string; userAgent?: string };

export async function usersWithPermission(code: PermissionCode, conn: Db = db): Promise<number[]> {
  return conn('users as u')
    .join('user_roles as ur', 'ur.user_id', 'u.id')
    .join('role_permissions as rp', 'rp.role_id', 'ur.role_id')
    .join('permissions as p', 'p.id', 'rp.permission_id')
    .where({ 'p.code': code, 'u.is_active': true })
    .distinct()
    .pluck('u.id');
}

/* ---------------- creation ---------------- */

export async function createRequest(auth: AuthContext, input: CreateSupportRequestInput, client: ClientInfo) {
  if (!auth.roles.includes('CUSTOMER')) throw forbidden('Support requests are submitted from a customer account');
  const category = await db('service_categories').where({ id: input.categoryId, is_active: true }).first('id', 'name');
  if (!category) throw badRequest('Choose a valid service category');

  return db.transaction(async (trx) => {
    let deviceId: number | null = null;
    if (input.deviceId) deviceId = (await assertDeviceAccess(auth, input.deviceId, trx)).id;
    else if (input.device) deviceId = await createDevice(auth, input.device, trx);

    const reference = await nextReference(trx, 'SR');
    const [id] = await trx('support_requests').insert({
      reference,
      customer_user_id: auth.userId,
      organization_id: auth.org?.id ?? null,
      service_type: input.serviceType,
      category_id: input.categoryId,
      device_id: deviceId,
      title: input.title,
      description: input.description,
      error_messages: input.errorMessages ?? null,
      urgency: input.urgency,
      preferred_contact: input.preferredContact,
      contact_name: input.contactName,
      contact_email: input.contactEmail,
      contact_phone: input.contactPhone,
      department: input.department ?? null,
      location: input.location ?? null,
      site_address: input.siteAddress ?? null,
      preferred_visit_date: input.preferredVisitDate ?? null,
      status: 'SUBMITTED',
    });
    await trx('request_status_history').insert({ support_request_id: id, from_status: null, to_status: 'SUBMITTED', changed_by: auth.userId });
    await addActivity(trx, id as number, 'SUBMITTED', `Request submitted: ${SERVICE_TYPE_LABELS[input.serviceType as ServiceType]} — ${category.name}`, { actorUserId: auth.userId });
    await notify({
      userIds: [auth.userId], type: 'REQUEST_SUBMITTED', title: `Request ${reference} received`,
      body: `Thank you. We have received your request "${input.title}". Our team will review it shortly; you can follow progress from your account.`,
      link: `/account/requests/${id}`,
    }, trx);
    await notify({
      userIds: await usersWithPermission(PERMISSIONS.REQUESTS_MANAGE, trx), type: 'NEW_REQUEST', title: `New ${input.urgency.toLowerCase()} request ${reference}`,
      body: `${input.contactName}${auth.org ? ` (${auth.org.name})` : ''}: ${input.title}`, link: `/staff/requests/${id}`, email: input.urgency === 'CRITICAL' || input.urgency === 'HIGH',
    }, trx);
    await audit({ actorUserId: auth.userId, action: 'request.created', entityType: 'support_request', entityId: id as number, ...client }, trx);
    return { id: id as number, reference };
  });
}

/* ---------------- listing ---------------- */

export async function listRequests(auth: AuthContext, query: z.infer<typeof listRequestsQuery>) {
  if (!viewerOf(auth)) throw forbidden();
  const base = scopeRequests(db('support_requests as sr'), auth)
    .leftJoin('service_categories as c', 'c.id', 'sr.category_id')
    .leftJoin('users as t', 't.id', 'sr.assigned_technician_id')
    .leftJoin('users as cu', 'cu.id', 'sr.customer_user_id')
    .leftJoin('organizations as o', 'o.id', 'sr.organization_id')
    .modify((q) => {
      if (query.status) q.where('sr.status', query.status);
      if (query.statusGroup === 'open') q.whereNotIn('sr.status', ['COMPLETED', ...TERMINAL_STATUSES]);
      if (query.statusGroup === 'closed') q.whereIn('sr.status', ['COMPLETED', ...TERMINAL_STATUSES]);
      if (query.statusGroup === 'active') q.whereNotIn('sr.status', ['SUBMITTED', 'UNDER_REVIEW', 'COMPLETED', ...TERMINAL_STATUSES]);
      if (query.serviceType) q.where('sr.service_type', query.serviceType);
      if (query.categoryId) q.where('sr.category_id', query.categoryId);
      if (query.technicianId) q.where('sr.assigned_technician_id', query.technicianId);
      if (query.organizationId) q.where('sr.organization_id', query.organizationId);
      if (query.urgency) q.where('sr.urgency', query.urgency);
      if (query.q) q.where((w) => w.where('sr.reference', 'like', `%${query.q}%`).orWhere('sr.title', 'like', `%${query.q}%`).orWhere('sr.contact_name', 'like', `%${query.q}%`));
    });
  const total = await base.clone().clearSelect().count({ n: '*' }).first();
  const rows = await base
    .clone()
    .select('sr.id', 'sr.reference', 'sr.title', 'sr.service_type', 'sr.status', 'sr.urgency', 'sr.submitted_at', 'sr.updated_at',
      'sr.contact_name', 'sr.department', 'c.name as category_name', 'o.name as organization_name',
      db.raw("CONCAT(t.first_name, ' ', t.last_name) as technician_name"), db.raw("CONCAT(cu.first_name, ' ', cu.last_name) as customer_name"))
    .orderByRaw("FIELD(sr.urgency, 'CRITICAL', 'HIGH', 'NORMAL', 'LOW')")
    .orderBy('sr.submitted_at', 'desc')
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  return {
    items: rows.map((r: Record<string, any>) => ({
      id: r.id, reference: r.reference, title: r.title, serviceType: r.service_type, status: r.status, urgency: r.urgency,
      submittedAt: r.submitted_at, updatedAt: r.updated_at, category: r.category_name, technicianName: r.technician_name,
      customerName: r.customer_name, contactName: r.contact_name, organizationName: r.organization_name, department: r.department,
    })),
    total: Number(total?.n ?? 0),
  };
}

/* ---------------- staff actions ---------------- */

export async function reviewRequest(auth: AuthContext, id: number, input: z.infer<typeof reviewRequestSchema>, client: ClientInfo) {
  if (!auth.permissions.has(PERMISSIONS.REQUESTS_MANAGE)) throw forbidden();
  return db.transaction(async (trx) => {
    const { request } = await loadRequestFor(auth, id, trx, { forUpdate: true });
    if (!['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_CUSTOMER'].includes(request.status)) {
      throw invalidState(`This request has already been reviewed (status: ${REQUEST_STATUS_LABELS[request.status as RequestStatus]})`);
    }
    // re-categorisation by the reviewer
    const changes: Record<string, unknown> = {};
    if (input.categoryId) {
      if (!(await trx('service_categories').where({ id: input.categoryId }).first('id'))) throw badRequest('Unknown category');
      changes.category_id = input.categoryId;
    }
    if (input.serviceType && input.serviceType !== request.service_type) changes.service_type = input.serviceType;
    if (input.urgency) changes.urgency = input.urgency;
    if (Object.keys(changes).length) {
      await trx('support_requests').where({ id }).update(changes);
      Object.assign(request, changes);
      await addActivity(trx, id, 'RECATEGORISED', 'Request details updated during review', { visible: false, actorUserId: auth.userId, metadata: changes });
    }
    if (request.status === 'SUBMITTED' || request.status === 'AWAITING_CUSTOMER') {
      await transitionStatus(trx, request as any, 'UNDER_REVIEW', { actorUserId: auth.userId, notifyCustomer: false });
    }
    const target: RequestStatus = input.decision === 'ACCEPT' ? 'ACCEPTED' : input.decision === 'REQUEST_INFO' ? 'AWAITING_CUSTOMER' : 'CANCELLED';
    if (input.decision !== 'ACCEPT' && !input.message) throw badRequest('Explain to the customer what is needed or why the request is declined');
    await transitionStatus(trx, request as any, target, {
      actorUserId: auth.userId, note: input.message,
      extra: target === 'CANCELLED' ? { cancel_reason: input.message ?? 'Declined during review' } : undefined,
    });
    if (input.decision === 'REQUEST_INFO' && input.message) {
      await trx('service_messages').insert({ support_request_id: id, sender_user_id: auth.userId, from_staff: true, body: input.message });
    }
    await markFirstResponse(trx, id);
    await audit({ actorUserId: auth.userId, action: `request.review_${input.decision.toLowerCase()}`, entityType: 'support_request', entityId: id, ...client }, trx);
    return { status: target };
  });
}

export async function assignTechnician(auth: AuthContext, id: number, technicianUserId: number, note: string | undefined, client: ClientInfo) {
  if (!auth.permissions.has(PERMISSIONS.REQUESTS_ASSIGN)) throw forbidden();
  return db.transaction(async (trx) => {
    const { request } = await loadRequestFor(auth, id, trx, { forUpdate: true });
    if (['SUBMITTED', 'UNDER_REVIEW', 'COMPLETED', ...TERMINAL_STATUSES].includes(request.status)) {
      throw invalidState('Accept the request before assigning a technician (and it must not be finished)');
    }
    const tech = await trx('users as u')
      .join('user_roles as ur', 'ur.user_id', 'u.id')
      .join('roles as r', 'r.id', 'ur.role_id')
      .where({ 'u.id': technicianUserId, 'u.is_active': true, 'r.code': 'TECHNICIAN' })
      .first('u.id', 'u.first_name', 'u.last_name');
    if (!tech) throw badRequest('Choose an active technician');
    if (request.assigned_technician_id === tech.id) return { technicianUserId: tech.id };

    await trx('technician_assignments').where({ support_request_id: id, is_current: true }).update({ is_current: false, unassigned_at: trx.fn.now(3) });
    await trx('technician_assignments').insert({ support_request_id: id, technician_user_id: tech.id, assigned_by: auth.userId, note: note ?? null });
    const reassignment = !!request.assigned_technician_id;
    await trx('support_requests').where({ id }).update({ assigned_technician_id: tech.id, assigned_at: trx.fn.now(3) });
    // open remote sessions follow the job to the new technician
    await trx('remote_sessions').where({ support_request_id: id }).whereIn('status', ['REQUESTED', 'AUTHORIZED']).update({ technician_user_id: tech.id });
    if (request.status === 'ACCEPTED') {
      await transitionStatus(trx, request as any, 'ASSIGNED', { actorUserId: auth.userId, notifyCustomer: false });
    }
    await addActivity(trx, id, 'TECHNICIAN_ASSIGNED', `${reassignment ? 'Reassigned to' : 'Assigned to'} technician ${tech.first_name} ${tech.last_name}`, { actorUserId: auth.userId });
    await notify({
      userIds: [request.customer_user_id], type: 'TECHNICIAN_ASSIGNED', title: `${request.reference}: technician assigned`,
      body: `${tech.first_name} ${tech.last_name} will handle your request and may contact you through the request page.`,
      link: `/account/requests/${id}`,
    }, trx);
    await notify({ userIds: [tech.id], type: 'JOB_ASSIGNED', title: `New job ${request.reference}`, body: `${request.title} (${request.urgency.toLowerCase()} urgency)`, link: `/staff/requests/${id}` }, trx);
    await markFirstResponse(trx, id);
    await audit({ actorUserId: auth.userId, action: 'request.assigned', entityType: 'support_request', entityId: id, metadata: { technicianUserId: tech.id }, ...client }, trx);
    return { technicianUserId: tech.id };
  });
}

/** Statuses a technician may set on their own job (managers may also do everything else). */
const TECHNICIAN_TARGETS: RequestStatus[] = [
  'AWAITING_CUSTOMER', 'DIAGNOSIS_IN_PROGRESS', 'AWAITING_PARTS', 'REPAIR_IN_PROGRESS', 'TESTING_QC', 'AWAITING_PAYMENT',
  'READY_FOR_COLLECTION', 'COMPLETED',
];

export async function changeStatus(
  auth: AuthContext,
  id: number,
  input: { status: RequestStatus; note?: string; visibleToCustomer: boolean },
  client: ClientInfo,
) {
  return db.transaction(async (trx) => {
    const access = await loadRequestFor(auth, id, trx, { forUpdate: true });
    assertStaff(access);
    const { request } = access;
    const manager = auth.permissions.has(PERMISSIONS.REQUESTS_MANAGE);
    const to = input.status;
    if (SYSTEM_ONLY_TARGETS.includes(to)) throw invalidState('This status is set automatically (assignment or quotation workflow)');
    if (!manager && !(access.viewer === 'TECHNICIAN' && TECHNICIAN_TARGETS.includes(to))) throw forbidden('Only a support manager can set this status');

    if (to === 'COMPLETED') {
      const report = await trx('service_reports').where({ support_request_id: id }).first('id');
      if (!report) throw invalidState('Submit the final service report before completing the job');
      const balance = await requestBalance(id, trx);
      if (balance.outstandingMinor > 0) {
        if (!manager || !input.note) throw invalidState('Payment is outstanding. Record the payment first, or (managers) give a reason to complete without it', balance);
        await audit({ actorUserId: auth.userId, action: 'request.completed_with_balance', entityType: 'support_request', entityId: id, metadata: { ...balance, reason: input.note }, ...client }, trx);
      }
      const open = await trx('remote_sessions').where({ support_request_id: id }).whereIn('status', ['INITIATED', 'ACTIVE']).first('id');
      if (open) throw invalidState('A remote session is still open. Complete or cancel it first.');
    }
    if (to === 'REPAIR_IN_PROGRESS' && request.service_type !== 'REMOTE_SUPPORT') {
      // chargeable repair work needs the customer's approval; a manager may start no-charge (e.g. warranty) work with a reason
      const approved = await trx('quotations').where({ support_request_id: id, status: 'APPROVED' }).first('id');
      if (!approved && !(manager && input.note)) throw invalidState('The customer has not approved a quotation. Send a quotation first, or (managers) give a reason for no-charge work.');
    }
    if (to === 'CANCELLED') {
      if (!input.note) throw badRequest('Give a reason for cancelling');
      await releaseRequestParts(trx, id, auth.userId, 'Request cancelled');
      await trx('remote_sessions').where({ support_request_id: id }).whereIn('status', ['REQUESTED', 'AUTHORIZED', 'INITIATED', 'ACTIVE']).update({ status: 'CANCELLED' });
      await trx('quotations').where({ support_request_id: id }).whereIn('status', ['DRAFT', 'SENT']).update({ status: 'EXPIRED' });
    }
    await transitionStatus(trx, request as any, to, {
      actorUserId: auth.userId, note: input.note, visibleToCustomer: input.visibleToCustomer,
      extra: to === 'CANCELLED' ? { cancel_reason: input.note } : undefined,
    });
    if (input.visibleToCustomer) await markFirstResponse(trx, id);
    await audit({ actorUserId: auth.userId, action: 'request.status_changed', entityType: 'support_request', entityId: id, metadata: { to }, ...client }, trx);
    return { status: to };
  });
}

export async function cancelByCustomer(auth: AuthContext, id: number, reason: string, client: ClientInfo) {
  return db.transaction(async (trx) => {
    const access = await loadRequestFor(auth, id, trx, { forUpdate: true });
    if (!access.isCustomerView) throw forbidden();
    const { request } = access;
    if (!CUSTOMER_CANCELLABLE.includes(request.status)) {
      throw invalidState('Work has already started on this request. Send a message to your technician to discuss cancelling.');
    }
    await trx('remote_sessions').where({ support_request_id: id }).whereIn('status', ['REQUESTED', 'AUTHORIZED']).update({ status: 'CANCELLED' });
    await transitionStatus(trx, request as any, 'CANCELLED', { actorUserId: auth.userId, note: `Cancelled by customer: ${reason}`, notifyCustomer: false, extra: { cancel_reason: reason } });
    if (request.assigned_technician_id) {
      await notify({ userIds: [request.assigned_technician_id], type: 'REQUEST_CANCELLED', title: `${request.reference} cancelled by customer`, body: reason, link: `/staff/requests/${id}` }, trx);
    }
    await audit({ actorUserId: auth.userId, action: 'request.cancelled_by_customer', entityType: 'support_request', entityId: id, ...client }, trx);
  });
}

export async function addProgressUpdate(auth: AuthContext, id: number, message: string, visible: boolean) {
  await db.transaction(async (trx) => {
    const access = await loadRequestFor(auth, id, trx);
    assertStaff(access);
    await addActivity(trx, id, 'PROGRESS_UPDATE', message, { visible, actorUserId: auth.userId });
    if (visible) {
      await markFirstResponse(trx, id);
      await notify({ userIds: [access.request.customer_user_id], type: 'REQUEST_UPDATE', title: `${access.request.reference}: progress update`, body: message, link: `/account/requests/${id}` }, trx);
    }
  });
}

/* ---------------- conversation ---------------- */

export async function listMessages(auth: AuthContext, id: number) {
  await loadRequestFor(auth, id);
  const rows = await db('service_messages as m')
    .join('users as u', 'u.id', 'm.sender_user_id')
    .where('m.support_request_id', id)
    .orderBy('m.created_at')
    .select('m.id', 'm.body', 'm.from_staff', 'm.created_at', 'u.id as sender_id', 'u.first_name', 'u.last_name');
  const attachments = await db('attachments').where({ support_request_id: id, context: 'MESSAGE', visible_to_customer: true })
    .select('id', 'context_id', 'original_name', 'mime_type', 'size_bytes');
  return rows.map((m) => ({
    id: m.id, body: m.body, fromStaff: !!m.from_staff, createdAt: m.created_at,
    sender: { id: m.sender_id, name: `${m.first_name} ${m.last_name}` },
    attachments: attachments.filter((a) => a.context_id === m.id).map((a) => ({ id: a.id, name: a.original_name, mimeType: a.mime_type, sizeBytes: a.size_bytes })),
  }));
}

export async function postMessage(auth: AuthContext, id: number, body: string) {
  return db.transaction(async (trx) => {
    const access = await loadRequestFor(auth, id, trx);
    const { request } = access;
    if (TERMINAL_STATUSES.includes(request.status)) throw invalidState('This request is closed. Open a new request if you need further help.');
    const fromStaff = !access.isCustomerView;
    const [msgId] = await trx('service_messages').insert({ support_request_id: id, sender_user_id: auth.userId, from_staff: fromStaff, body });
    if (fromStaff) {
      await markFirstResponse(trx, id);
      await notify({ userIds: [request.customer_user_id], type: 'NEW_MESSAGE', title: `${request.reference}: new message from our team`, body: body.slice(0, 300), link: `/account/requests/${id}` }, trx);
    } else {
      const recipients = request.assigned_technician_id ? [request.assigned_technician_id] : await usersWithPermission(PERMISSIONS.REQUESTS_MANAGE, trx);
      await notify({ userIds: recipients, type: 'NEW_MESSAGE', title: `${request.reference}: customer replied`, body: body.slice(0, 300), link: `/staff/requests/${id}`, email: false }, trx);
      // a customer reply to an information request puts the request back in front of staff
      if (request.status === 'AWAITING_CUSTOMER') {
        await addActivity(trx, id, 'CUSTOMER_REPLIED', 'Customer responded', { actorUserId: auth.userId });
      }
    }
    return { id: msgId as number };
  });
}

export async function listInternalNotes(auth: AuthContext, id: number) {
  const access = await loadRequestFor(auth, id);
  assertStaff(access);
  if (!auth.permissions.has(PERMISSIONS.INTERNAL_NOTES_VIEW)) throw forbidden();
  const rows = await db('internal_notes as n').join('users as u', 'u.id', 'n.author_user_id').where('n.support_request_id', id)
    .orderBy('n.created_at').select('n.id', 'n.body', 'n.created_at', 'u.first_name', 'u.last_name');
  return rows.map((n) => ({ id: n.id, body: n.body, createdAt: n.created_at, author: `${n.first_name} ${n.last_name}` }));
}

export async function addInternalNote(auth: AuthContext, id: number, body: string) {
  const access = await loadRequestFor(auth, id);
  assertStaff(access);
  if (!auth.permissions.has(PERMISSIONS.INTERNAL_NOTES_VIEW)) throw forbidden();
  const [noteId] = await db('internal_notes').insert({ support_request_id: id, author_user_id: auth.userId, body });
  return { id: noteId as number };
}

export async function requestExists(id: number) {
  if (!(await db('support_requests').where({ id }).first('id'))) throw notFound('Support request');
}
