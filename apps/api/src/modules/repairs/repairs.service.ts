import type { z } from 'zod';
import {
  PERMISSIONS, TERMINAL_STATUSES,
  type diagnosticSchema, type feedbackSchema, type intakeSchema, type serviceReportSchema, type workLogSchema,
} from '@dante/shared';
import type { AuthContext } from '../../core/auth.js';
import { audit } from '../../core/audit.js';
import { badRequest, conflict, forbidden, invalidState, notFound } from '../../core/errors.js';
import { db, type Db } from '../../db/knex.js';
import { notify } from '../notifications/notifications.service.js';
import { getSettings } from '../settings/settings.service.js';
import { loadRequestFor } from '../support/support.access.js';
import { addActivity, transitionStatus } from '../support/support.workflow.js';
import { usersWithPermission } from '../support/support.service.js';
import { consumePart, tryReserve } from './parts.service.js';

type ClientInfo = { ip?: string; userAgent?: string };

/** Staff working the job: the assigned technician or a manager. */
async function workAccess(auth: AuthContext, requestId: number, trx: Db) {
  const access = await loadRequestFor(auth, requestId, trx, { forUpdate: true });
  if (access.isCustomerView) throw forbidden();
  if (access.request.assigned_technician_id !== auth.userId && !auth.permissions.has(PERMISSIONS.REQUESTS_MANAGE)) {
    throw forbidden('Only the assigned technician or a manager can update this job');
  }
  if (TERMINAL_STATUSES.includes(access.request.status)) throw invalidState('This request is closed');
  return access.request;
}

export async function recordIntake(auth: AuthContext, requestId: number, input: z.infer<typeof intakeSchema>, client: ClientInfo) {
  await db.transaction(async (trx) => {
    const request = await workAccess(auth, requestId, trx);
    if (request.service_type !== 'HARDWARE_REPAIR' && request.service_type !== 'ONSITE_SUPPORT') throw invalidState('Device intake applies to hardware and on-site jobs');
    const existing = await trx('repair_jobs').where({ support_request_id: requestId }).first('id', 'received_at');
    const row = {
      device_id: request.device_id, intake_type: input.intakeType, condition_notes: input.conditionNotes, accessories: input.accessories ?? null,
      serial_number: input.serialNumber ?? null, appointment_at: input.appointmentAt ? new Date(input.appointmentAt) : null,
      received_at: existing?.received_at ?? trx.fn.now(3), received_by: auth.userId,
      ...(input.customerAcknowledged ? { customer_acknowledged_at: trx.fn.now(3), acknowledged_by_name: input.acknowledgedByName ?? null } : {}),
    };
    if (existing) await trx('repair_jobs').where({ id: existing.id }).update(row);
    else await trx('repair_jobs').insert({ support_request_id: requestId, ...row });
    if (input.serialNumber && request.device_id) {
      await trx('devices').where({ id: request.device_id }).whereNull('serial_number').update({ serial_number: input.serialNumber });
    }
    await addActivity(trx, requestId, 'DEVICE_RECEIVED',
      input.intakeType === 'WORKSHOP' ? 'Device received at our workshop and its condition recorded' : 'On-site visit recorded', { actorUserId: auth.userId });
    if (['ASSIGNED', 'AWAITING_CUSTOMER'].includes(request.status)) {
      await transitionStatus(trx, request as any, 'DIAGNOSIS_IN_PROGRESS', { actorUserId: auth.userId });
    }
    await audit({ actorUserId: auth.userId, action: 'repair.intake_recorded', entityType: 'support_request', entityId: requestId, metadata: { acknowledged: input.customerAcknowledged }, ...client }, trx);
  });
}

/** Customer confirms the handover online (alternative to signing at the counter). */
export async function acknowledgeIntake(auth: AuthContext, requestId: number, client: ClientInfo) {
  await db.transaction(async (trx) => {
    const access = await loadRequestFor(auth, requestId, trx, { forUpdate: true });
    if (!access.isCustomerView || access.request.customer_user_id !== auth.userId) throw forbidden();
    const job = await trx('repair_jobs').where({ support_request_id: requestId }).first();
    if (!job) throw invalidState('The device has not been received yet');
    if (job.customer_acknowledged_at) return;
    const settings = await getSettings(trx);
    const text = `${settings.intakeTermsText}\n\nCondition recorded: ${job.condition_notes ?? '-'}\nAccessories: ${job.accessories ?? 'none'}`;
    const [consentId] = await trx('customer_consents').insert({
      user_id: auth.userId, consent_type: 'REPAIR_INTAKE', subject_type: 'REPAIR_JOB', subject_id: job.id, consent_version: 'intake-v1',
      consent_text: text, ip: client.ip ?? null, user_agent: client.userAgent?.slice(0, 255) ?? null,
    });
    await trx('repair_jobs').where({ id: job.id }).update({ customer_acknowledged_at: trx.fn.now(3), acknowledged_by_name: `${auth.firstName} ${auth.lastName}`, intake_consent_id: consentId });
    await addActivity(trx, requestId, 'INTAKE_ACKNOWLEDGED', 'Customer confirmed the device handover details', { actorUserId: auth.userId });
  });
}

export async function addDiagnostic(auth: AuthContext, requestId: number, input: z.infer<typeof diagnosticSchema>) {
  await db.transaction(async (trx) => {
    const request = await workAccess(auth, requestId, trx);
    await trx('repair_diagnostics').insert({
      support_request_id: requestId, technician_user_id: auth.userId, findings: input.findings, root_cause: input.rootCause ?? null,
      recommended_action: input.recommendedAction ?? null, visible_to_customer: input.visibleToCustomer,
    });
    await addActivity(trx, requestId, 'DIAGNOSIS', input.visibleToCustomer ? `Diagnosis: ${input.findings.slice(0, 500)}` : 'Diagnostic notes recorded', {
      visible: input.visibleToCustomer, actorUserId: auth.userId,
    });
    if (['ASSIGNED', 'AWAITING_CUSTOMER'].includes(request.status)) {
      await transitionStatus(trx, request as any, 'DIAGNOSIS_IN_PROGRESS', { actorUserId: auth.userId });
    }
  });
}

export async function addWorkLog(auth: AuthContext, requestId: number, input: z.infer<typeof workLogSchema>) {
  await db.transaction(async (trx) => {
    await workAccess(auth, requestId, trx);
    await trx('repair_work_logs').insert({
      support_request_id: requestId, technician_user_id: auth.userId, activity: input.activity, minutes_spent: input.minutesSpent,
      visible_to_customer: input.visibleToCustomer,
    });
    if (input.visibleToCustomer) await addActivity(trx, requestId, 'WORK_LOGGED', input.activity.slice(0, 500), { actorUserId: auth.userId });
  });
}

/**
 * Technician requests a NON-chargeable part (e.g. warranty replacement). Chargeable parts must come
 * from an approved quotation. The part is reserved immediately when in stock.
 */
export async function requestPart(auth: AuthContext, requestId: number, productId: number, quantity: number, note: string, client: ClientInfo) {
  return db.transaction(async (trx) => {
    await workAccess(auth, requestId, trx);
    const product = await trx('products').where({ id: productId }).first('id', 'name');
    if (!product) throw badRequest('Unknown product');
    const [partId] = await trx('repair_parts').insert({
      support_request_id: requestId, product_id: productId, quantity, chargeable: false, stock_state: 'NONE', notes: note,
    });
    const reserved = await tryReserve(trx, partId as number, auth.userId);
    await addActivity(trx, requestId, 'PART_REQUESTED', `No-charge part requested: ${quantity} × ${product.name} (${reserved ? 'reserved' : 'awaiting stock'})`, { visible: false, actorUserId: auth.userId });
    if (!reserved) {
      await notify({ userIds: await usersWithPermission(PERMISSIONS.PURCHASING_MANAGE, trx), type: 'PART_NEEDED', title: `Part needed: ${product.name}`,
        body: `A repair is waiting for ${quantity} × ${product.name}.`, link: '/staff/inventory?lowStock=true', email: false }, trx);
    }
    await audit({ actorUserId: auth.userId, action: 'repair.part_requested', entityType: 'support_request', entityId: requestId, metadata: { productId, quantity, reserved }, ...client }, trx);
    return { partId: partId as number, reserved };
  });
}

/** Retry reservation for parts that were waiting for stock (e.g. after a purchase order is received). */
export async function allocateWaitingParts(auth: AuthContext, requestId: number) {
  return db.transaction(async (trx) => {
    await workAccess(auth, requestId, trx);
    const waiting = await trx('repair_parts').where({ support_request_id: requestId, stock_state: 'NONE' }).orderBy('product_id').select('id');
    let reserved = 0;
    for (const p of waiting) if (await tryReserve(trx, p.id, auth.userId)) reserved++;
    return { waiting: waiting.length, reserved, stillWaiting: waiting.length - reserved };
  });
}

/** Records a part as installed: consumes it from stock exactly once. */
export async function installPart(auth: AuthContext, requestId: number, partId: number, client: ClientInfo) {
  await db.transaction(async (trx) => {
    const request = await workAccess(auth, requestId, trx);
    const part = await trx('repair_parts as p').leftJoin('quotation_items as qi', 'qi.id', 'p.quotation_item_id').leftJoin('quotations as q', 'q.id', 'qi.quotation_id')
      .where({ 'p.id': partId, 'p.support_request_id': requestId }).first('p.*', 'q.status as quotation_status');
    if (!part) throw notFound('Part');
    if (part.chargeable && part.quotation_status !== 'APPROVED') throw invalidState('This part is not covered by an approved quotation');
    if (part.stock_state === 'RELEASED') throw invalidState('This part was released and is no longer allocated to the job');
    if (part.stock_state === 'CONSUMED') throw conflict('This part has already been installed');
    if (!['APPROVED', 'REPAIR_IN_PROGRESS', 'TESTING_QC', 'AWAITING_PARTS'].includes(request.status)) throw invalidState('Start the repair before installing parts');
    await consumePart(trx, partId, auth.userId);
    const product = await trx('products').where({ id: part.product_id }).first('name');
    await addActivity(trx, requestId, 'PART_INSTALLED', `Installed ${part.quantity} × ${product?.name}`, { actorUserId: auth.userId });
    await audit({ actorUserId: auth.userId, action: 'repair.part_installed', entityType: 'repair_part', entityId: partId, metadata: { requestId }, ...client }, trx);
  });
}

const REPORTABLE = ['DIAGNOSIS_IN_PROGRESS', 'APPROVED', 'REPAIR_IN_PROGRESS', 'TESTING_QC', 'AWAITING_PAYMENT', 'READY_FOR_COLLECTION', 'AWAITING_CUSTOMER'];

export async function submitReport(auth: AuthContext, requestId: number, input: z.infer<typeof serviceReportSchema>, client: ClientInfo) {
  await db.transaction(async (trx) => {
    const request = await workAccess(auth, requestId, trx);
    if (!REPORTABLE.includes(request.status)) throw invalidState('The service report is submitted when the work is done (before completing the job)');
    const open = await trx('remote_sessions').where({ support_request_id: requestId }).whereIn('status', ['INITIATED', 'ACTIVE']).first('id');
    if (open) throw invalidState('Complete the open remote session before submitting the report');
    const reservedLeft = await trx('repair_parts').where({ support_request_id: requestId, stock_state: 'RESERVED' }).first('id');
    if (reservedLeft) throw invalidState('Some reserved parts were neither installed nor released. Install them or release them first.');

    const parts = await trx('repair_parts as p').join('products as pr', 'pr.id', 'p.product_id').where({ 'p.support_request_id': requestId, 'p.stock_state': 'CONSUMED' })
      .select('pr.name', 'pr.sku', 'p.quantity', 'p.chargeable');
    const sessions = await trx('remote_sessions').where({ support_request_id: requestId, status: 'COMPLETED' })
      .select('id', 'outcome', 'anydesk_session_id', 'session_started_at', 'session_ended_at', 'session_duration_seconds', 'session_data_source', 'work_performed');
    const row = {
      technician_user_id: request.assigned_technician_id ?? auth.userId,
      original_problem: input.originalProblem, diagnosis: input.diagnosis, actions_performed: input.actionsPerformed, changes_made: input.changesMade ?? null,
      parts_replaced: JSON.stringify(parts.map((p) => ({ name: p.name, sku: p.sku, quantity: p.quantity, chargeable: !!p.chargeable }))),
      testing_results: input.testingResults,
      remote_sessions: JSON.stringify(sessions.map((s) => ({
        id: s.id, outcome: s.outcome, anydeskSessionId: s.anydesk_session_id, startedAt: s.session_started_at, endedAt: s.session_ended_at,
        durationSeconds: s.session_duration_seconds, source: s.session_data_source, workPerformed: s.work_performed,
      }))),
      recommendations: input.recommendations ?? null, warranty_days: input.warrantyDays, warranty_terms: input.warrantyTerms ?? null,
      outcome: input.outcome, submitted_at: trx.fn.now(3),
    };
    const existing = await trx('service_reports').where({ support_request_id: requestId }).first('id');
    if (existing) await trx('service_reports').where({ id: existing.id }).update(row);
    else await trx('service_reports').insert({ support_request_id: requestId, ...row });

    await trx('repair_warranties').where({ support_request_id: requestId }).del();
    if (input.warrantyDays > 0) {
      const start = new Date();
      const end = new Date(start.getTime() + input.warrantyDays * 86_400_000);
      await trx('repair_warranties').insert({
        support_request_id: requestId, device_id: request.device_id, starts_on: start.toISOString().slice(0, 10), ends_on: end.toISOString().slice(0, 10),
        terms: input.warrantyTerms ?? null,
      });
    }
    await addActivity(trx, requestId, 'REPORT_SUBMITTED', `Final service report ${existing ? 'updated' : 'submitted'} — outcome: ${input.outcome.toLowerCase().replace(/_/g, ' ')}`, { actorUserId: auth.userId });
    await notify({ userIds: [request.customer_user_id], type: 'REPORT_READY', title: `${request.reference}: service report available`,
      body: 'Your technician has documented the work done. You can read the report on the request page.', link: `/account/requests/${requestId}` }, trx);
    await audit({ actorUserId: auth.userId, action: 'repair.report_submitted', entityType: 'support_request', entityId: requestId, ...client }, trx);
  });
}

export async function recordReturn(auth: AuthContext, requestId: number, returnedTo: string, client: ClientInfo) {
  await db.transaction(async (trx) => {
    await workAccess(auth, requestId, trx);
    const job = await trx('repair_jobs').where({ support_request_id: requestId }).first('id');
    if (!job) throw invalidState('No device intake was recorded for this request');
    await trx('repair_jobs').where({ id: job.id }).update({ returned_at: trx.fn.now(3), returned_to: returnedTo });
    await addActivity(trx, requestId, 'DEVICE_RETURNED', `Device handed back to ${returnedTo}`, { actorUserId: auth.userId });
    await audit({ actorUserId: auth.userId, action: 'repair.device_returned', entityType: 'support_request', entityId: requestId, ...client }, trx);
  });
}

export async function submitFeedback(auth: AuthContext, requestId: number, input: z.infer<typeof feedbackSchema>) {
  await db.transaction(async (trx) => {
    const access = await loadRequestFor(auth, requestId, trx, { forUpdate: true });
    const r = access.request;
    if (!access.isCustomerView || (r.customer_user_id !== auth.userId && !(auth.org?.role === 'ORG_ADMIN' && auth.org.id === r.organization_id))) {
      throw forbidden('Only the customer can leave feedback');
    }
    if (!['COMPLETED', 'CLOSED'].includes(r.status)) throw invalidState('Feedback can be given once the job is completed');
    if (await trx('customer_feedback').where({ support_request_id: requestId }).first('id')) throw conflict('Feedback has already been submitted for this request');
    await trx('customer_feedback').insert({
      support_request_id: requestId, user_id: auth.userId, technician_user_id: r.assigned_technician_id, rating: input.rating,
      issue_resolved: input.issueResolved, timeliness_rating: input.timelinessRating ?? null, communication_rating: input.communicationRating ?? null,
      professionalism_rating: input.professionalismRating ?? null, comment: input.comment ?? null,
    });
    await addActivity(trx, requestId, 'FEEDBACK', `Customer rated the service ${input.rating}/5`, { actorUserId: auth.userId });
    if (input.rating <= 2 || !input.issueResolved) {
      await notify({ userIds: await usersWithPermission(PERMISSIONS.REQUESTS_MANAGE, trx), type: 'LOW_FEEDBACK', title: `${r.reference}: low rating (${input.rating}/5)`,
        body: input.comment ?? (input.issueResolved ? '' : 'Customer reports the issue is not resolved.'), link: `/staff/requests/${requestId}` }, trx);
    }
  });
}
