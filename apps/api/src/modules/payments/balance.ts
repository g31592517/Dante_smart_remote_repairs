import { db, type Db } from '../../db/knex.js';

export interface Balance {
  dueMinor: number;
  paidMinor: number;
  outstandingMinor: number;
}

/**
 * What a support request costs = the total of its currently APPROVED quotation (a revision
 * supersedes the previous one, so at most one is APPROVED at a time).
 */
export async function requestBalance(requestId: number, conn: Db = db): Promise<Balance> {
  const due = await conn('quotations').where({ support_request_id: requestId, status: 'APPROVED' }).sum({ s: 'total_minor' }).first();
  const paid = await paidFor('SUPPORT_REQUEST', requestId, conn);
  const dueMinor = Number(due?.s ?? 0);
  return { dueMinor, paidMinor: paid, outstandingMinor: Math.max(0, dueMinor - paid) };
}

export async function orderBalance(orderId: number, conn: Db = db): Promise<Balance> {
  const order = await conn('sales_orders').where({ id: orderId }).first('total_minor');
  const paid = await paidFor('SALES_ORDER', orderId, conn);
  const dueMinor = Number(order?.total_minor ?? 0);
  return { dueMinor, paidMinor: paid, outstandingMinor: Math.max(0, dueMinor - paid) };
}

async function paidFor(type: 'SALES_ORDER' | 'SUPPORT_REQUEST', id: number, conn: Db) {
  const r = await conn('payments').where({ payable_type: type, payable_id: id, status: 'SUCCEEDED' }).sum({ s: 'amount_minor' }).first();
  return Number(r?.s ?? 0);
}
