import { allowedTransitions, PERMISSIONS, SYSTEM_ONLY_TARGETS, type RequestStatus, type ServiceType } from '@dante/shared';
import type { AuthContext } from '../../core/auth.js';
import { db } from '../../db/knex.js';
import { mapDevice } from '../users/devices.service.js';
import { mapRemoteSession } from '../remote/remote.service.js';
import { loadQuotations } from '../repairs/quotations.service.js';
import { requestBalance } from '../payments/balance.js';
import { mapPayment } from '../payments/payments.service.js';
import { getSettings } from '../settings/settings.service.js';
import { loadRequestFor } from './support.access.js';

/**
 * Full request view. The same function serves customers and staff; everything confidential is
 * filtered here by `isCustomerView`, so no customer endpoint can accidentally include it.
 */
export async function requestDetail(auth: AuthContext, id: number) {
  const { request: r, isCustomerView, viewer } = await loadRequestFor(auth, id);
  const visible = <T extends { visible_to_customer?: number | boolean }>(rows: T[]) => (isCustomerView ? rows.filter((x) => !!x.visible_to_customer) : rows);

  const [category, device, customer, org, technician] = await Promise.all([
    db('service_categories').where({ id: r.category_id }).first('id', 'name'),
    r.device_id ? db('devices').where({ id: r.device_id }).first() : null,
    db('users').where({ id: r.customer_user_id }).first('id', 'first_name', 'last_name', 'email', 'phone'),
    r.organization_id ? db('organizations').where({ id: r.organization_id }).first('id', 'name') : null,
    r.assigned_technician_id ? db('users').where({ id: r.assigned_technician_id }).first('id', 'first_name', 'last_name', 'email') : null,
  ]);

  const activities = await db('request_activities as a').leftJoin('users as u', 'u.id', 'a.actor_user_id').where('a.support_request_id', id)
    .orderBy('a.created_at').orderBy('a.id').select('a.*', 'u.first_name', 'u.last_name');
  const attachments = await db('attachments').where({ support_request_id: id }).orderBy('id');
  const sessions = await db('remote_sessions').where({ support_request_id: id }).orderBy('id', 'desc');
  const repairJob = await db('repair_jobs').where({ support_request_id: id }).first();
  const diagnostics = await db('repair_diagnostics as d').join('users as u', 'u.id', 'd.technician_user_id').where('d.support_request_id', id)
    .orderBy('d.created_at').select('d.*', 'u.first_name', 'u.last_name');
  const workLogs = await db('repair_work_logs as w').join('users as u', 'u.id', 'w.technician_user_id').where('w.support_request_id', id)
    .orderBy('w.created_at').select('w.*', 'u.first_name', 'u.last_name');
  const parts = await db('repair_parts as p').join('products as pr', 'pr.id', 'p.product_id').where('p.support_request_id', id)
    .orderBy('p.id').select('p.*', 'pr.name as product_name', 'pr.sku');
  const report = await db('service_reports').where({ support_request_id: id }).first();
  const warranty = await db('repair_warranties').where({ support_request_id: id }).first();
  const feedback = await db('customer_feedback').where({ support_request_id: id }).first();
  const payments = await db('payments').where({ payable_type: 'SUPPORT_REQUEST', payable_id: id }).orderBy('id');
  const settings = await getSettings();

  const status = r.status as RequestStatus;
  const manager = auth.permissions.has(PERMISSIONS.REQUESTS_MANAGE);
  const nextStatuses = isCustomerView ? [] : allowedTransitions(r.service_type as ServiceType, status).filter((s) => !SYSTEM_ONLY_TARGETS.includes(s));

  return {
    id: r.id,
    reference: r.reference,
    serviceType: r.service_type,
    status,
    title: r.title,
    description: r.description,
    errorMessages: r.error_messages,
    urgency: r.urgency,
    preferredContact: r.preferred_contact,
    contact: { name: r.contact_name, email: r.contact_email, phone: r.contact_phone, department: r.department, location: r.location },
    siteAddress: r.site_address,
    preferredVisitDate: r.preferred_visit_date,
    category,
    device: device ? mapDevice(device) : null,
    customer: customer ? { id: customer.id, name: `${customer.first_name} ${customer.last_name}`, email: customer.email, phone: customer.phone } : null,
    organization: org,
    technician: technician ? { id: technician.id, name: `${technician.first_name} ${technician.last_name}`, ...(isCustomerView ? {} : { email: technician.email }) } : null,
    dates: {
      submittedAt: r.submitted_at, firstResponseAt: r.first_response_at, acceptedAt: r.accepted_at, assignedAt: r.assigned_at,
      completedAt: r.completed_at, closedAt: r.closed_at, cancelledAt: r.cancelled_at,
    },
    cancelReason: r.cancel_reason,
    timeline: visible(activities).map((a) => ({
      id: a.id, type: a.activity_type, message: a.message, createdAt: a.created_at, visibleToCustomer: !!a.visible_to_customer,
      actor: a.first_name ? `${a.first_name} ${a.last_name}` : null,
    })),
    attachments: visible(attachments).map((a) => ({
      id: a.id, context: a.context, name: a.original_name, mimeType: a.mime_type, sizeBytes: a.size_bytes, createdAt: a.created_at,
      visibleToCustomer: !!a.visible_to_customer,
    })),
    remoteSessions: sessions.map((s) => mapRemoteSession(s, isCustomerView)),
    anydeskDownloadUrl: settings.anydeskDownloadUrl,
    remoteConsent: { version: settings.remoteConsentVersion, text: settings.remoteConsentText },
    repairJob: repairJob
      ? {
          intakeType: repairJob.intake_type, appointmentAt: repairJob.appointment_at, receivedAt: repairJob.received_at,
          conditionNotes: repairJob.condition_notes, accessories: repairJob.accessories, serialNumber: repairJob.serial_number,
          customerAcknowledgedAt: repairJob.customer_acknowledged_at, acknowledgedByName: repairJob.acknowledged_by_name,
          returnedAt: repairJob.returned_at, returnedTo: repairJob.returned_to,
        }
      : null,
    diagnostics: visible(diagnostics).map((d) => ({
      id: d.id, findings: d.findings, rootCause: d.root_cause, recommendedAction: d.recommended_action, createdAt: d.created_at,
      technician: `${d.first_name} ${d.last_name}`, visibleToCustomer: !!d.visible_to_customer,
    })),
    workLogs: visible(workLogs).map((w) => ({
      id: w.id, activity: w.activity, minutesSpent: isCustomerView ? undefined : w.minutes_spent, createdAt: w.created_at,
      technician: `${w.first_name} ${w.last_name}`, visibleToCustomer: !!w.visible_to_customer,
    })),
    quotations: await loadQuotations(id, isCustomerView),
    parts: parts.map((p) => ({
      id: p.id, productId: p.product_id, productName: p.product_name, sku: p.sku, quantity: p.quantity, stockState: p.stock_state,
      awaitingStock: !!p.awaiting_stock, consumedAt: p.consumed_at, chargeable: !!p.chargeable,
    })),
    report: report
      ? {
          originalProblem: report.original_problem, diagnosis: report.diagnosis, actionsPerformed: report.actions_performed,
          changesMade: report.changes_made, partsReplaced: typeof report.parts_replaced === 'string' ? JSON.parse(report.parts_replaced) : report.parts_replaced,
          testingResults: report.testing_results,
          remoteSessions: typeof report.remote_sessions === 'string' ? JSON.parse(report.remote_sessions) : report.remote_sessions,
          recommendations: report.recommendations, warrantyDays: report.warranty_days, warrantyTerms: report.warranty_terms,
          outcome: report.outcome, submittedAt: report.submitted_at,
        }
      : null,
    warranty: warranty ? { startsOn: warranty.starts_on, endsOn: warranty.ends_on, terms: warranty.terms } : null,
    feedback: feedback
      ? {
          rating: feedback.rating, issueResolved: !!feedback.issue_resolved, timelinessRating: feedback.timeliness_rating,
          communicationRating: feedback.communication_rating, professionalismRating: feedback.professionalism_rating,
          comment: feedback.comment, createdAt: feedback.created_at,
        }
      : null,
    balance: await requestBalance(id),
    payments: payments.map((p) => mapPayment(p, isCustomerView)),
    currency: { code: settings.currencyCode, minorDigits: settings.currencyMinorDigits },
    permissions: {
      viewer,
      canManage: manager,
      canAssign: auth.permissions.has(PERMISSIONS.REQUESTS_ASSIGN),
      canWork: !isCustomerView,
      canViewInternalNotes: !isCustomerView && auth.permissions.has(PERMISSIONS.INTERNAL_NOTES_VIEW),
      nextStatuses,
    },
  };
}
