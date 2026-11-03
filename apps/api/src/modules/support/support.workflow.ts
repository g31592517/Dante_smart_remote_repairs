import { REQUEST_STATUS_LABELS, canTransition, type RequestStatus, type ServiceType } from '@dante/shared';
import type { Db } from '../../db/knex.js';
import { invalidState } from '../../core/errors.js';
import { notify } from '../notifications/notifications.service.js';

export async function addActivity(
  conn: Db,
  requestId: number,
  activityType: string,
  message: string,
  opts: { visible?: boolean; actorUserId?: number | null; metadata?: Record<string, unknown> } = {},
) {
  await conn('request_activities').insert({
    support_request_id: requestId,
    activity_type: activityType,
    message: message.slice(0, 2000),
    visible_to_customer: opts.visible ?? true,
    actor_user_id: opts.actorUserId ?? null,
    metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
  });
}

/** Marks the first staff response (for "average response time" reporting). */
export async function markFirstResponse(conn: Db, requestId: number) {
  await conn('support_requests').where({ id: requestId }).whereNull('first_response_at').update({ first_response_at: conn.fn.now(3) });
}

const TIMESTAMP_FOR: Partial<Record<RequestStatus, string>> = {
  ACCEPTED: 'accepted_at',
  COMPLETED: 'completed_at',
  CLOSED: 'closed_at',
  CANCELLED: 'cancelled_at',
};

/**
 * The only function that changes support_requests.status. Validates against the shared state
 * machine, records history + timeline, stamps milestone times and notifies the customer.
 * Caller must hold a row lock on the request (loadRequestFor(..., { forUpdate: true })).
 */
export async function transitionStatus(
  conn: Db,
  request: { id: number; status: RequestStatus; service_type: ServiceType; customer_user_id: number; reference: string },
  to: RequestStatus,
  opts: { actorUserId: number | null; note?: string; visibleToCustomer?: boolean; notifyCustomer?: boolean; extra?: Record<string, unknown> } ,
) {
  if (request.status === to) return;
  if (!canTransition(request.service_type, request.status, to)) {
    throw invalidState(`A ${request.service_type.toLowerCase().replace(/_/g, ' ')} request cannot move from ${REQUEST_STATUS_LABELS[request.status]} to ${REQUEST_STATUS_LABELS[to]}`);
  }
  const stampCol = TIMESTAMP_FOR[to];
  await conn('support_requests')
    .where({ id: request.id })
    .update({ status: to, ...(stampCol ? { [stampCol]: conn.fn.now(3) } : {}), ...(opts.extra ?? {}) });
  await conn('request_status_history').insert({
    support_request_id: request.id,
    from_status: request.status,
    to_status: to,
    changed_by: opts.actorUserId,
    note: opts.note ?? null,
  });
  const visible = opts.visibleToCustomer ?? true;
  await addActivity(conn, request.id, 'STATUS_CHANGED', `Status changed to "${REQUEST_STATUS_LABELS[to]}"${opts.note && visible ? ` — ${opts.note}` : ''}`, {
    visible,
    actorUserId: opts.actorUserId,
    metadata: { from: request.status, to },
  });
  if (visible && opts.notifyCustomer !== false) {
    await notify(
      {
        userIds: [request.customer_user_id],
        type: 'REQUEST_STATUS',
        title: `${request.reference}: ${REQUEST_STATUS_LABELS[to]}`,
        body: opts.note ? `Your request is now "${REQUEST_STATUS_LABELS[to]}". ${opts.note}` : `Your request is now "${REQUEST_STATUS_LABELS[to]}".`,
        link: `/account/requests/${request.id}`,
      },
      conn,
    );
  }
  request.status = to;
}
