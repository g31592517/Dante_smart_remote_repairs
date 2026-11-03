import type { Db } from '../../db/knex.js';
import { AppError } from '../../core/errors.js';
import { consumeLine, releaseLine, reserveLine, sortByProduct } from '../inventory/inventory.service.js';

/** Reserve one part; on insufficient stock mark it awaiting stock instead of failing the approval. */
export async function tryReserve(trx: Db, partId: number, actorUserId: number): Promise<boolean> {
  // a savepoint, so a failed reservation does not abort the surrounding transaction
  try {
    await trx.transaction(async (sp) => {
      await reserveLine(sp, 'repair_parts', partId, actorUserId);
    });
    return true;
  } catch (err) {
    if (err instanceof AppError && err.code === 'INSUFFICIENT_STOCK') {
      await trx('repair_parts').where({ id: partId }).update({ awaiting_stock: true });
      return false;
    }
    throw err;
  }
}

/** Releases every still-reserved part of a request (cancellation, superseded quotation). */
export async function releaseRequestParts(trx: Db, requestId: number, actorUserId: number | null, reason: string, quotationId?: number) {
  const q = trx('repair_parts as p').where('p.support_request_id', requestId).whereIn('p.stock_state', ['RESERVED', 'NONE']);
  if (quotationId) q.join('quotation_items as qi', 'qi.id', 'p.quotation_item_id').where('qi.quotation_id', quotationId);
  const parts = await q.select('p.id', 'p.product_id', 'p.stock_state');
  for (const p of sortByProduct(parts)) {
    if (p.stock_state === 'RESERVED') await releaseLine(trx, 'repair_parts', p.id, actorUserId, reason);
    else await trx('repair_parts').where({ id: p.id }).update({ stock_state: 'RELEASED', released_at: trx.fn.now(3), awaiting_stock: false });
  }
}

export async function consumePart(trx: Db, partId: number, actorUserId: number) {
  const state = await consumeLine(trx, 'repair_parts', partId, actorUserId);
  await trx('repair_parts').where({ id: partId }).update({ installed_by: actorUserId, awaiting_stock: false });
  return state;
}
