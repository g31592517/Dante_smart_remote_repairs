import { PERMISSIONS, type StockLineState, type StockMovementType } from '@dante/shared';
import type { Db } from '../../db/knex.js';
import { insufficientStock, invalidState, notFound } from '../../core/errors.js';
import { notify } from '../notifications/notifications.service.js';

/**
 * The single gateway to stock levels, shared by the shop (sales orders) and the workshop (repair parts).
 *
 *   available = quantity_on_hand - quantity_reserved
 *
 * Every function here must run inside a transaction. The inventory row is locked with
 * SELECT ... FOR UPDATE, every change writes an inventory_movements row, and the database CHECK
 * constraint (on_hand >= reserved >= 0) is the last line of defence.
 *
 * Stock LINES (sales_order_items, repair_parts) carry a stock_state that makes every transition
 * idempotent:  NONE → RESERVED → CONSUMED,  RESERVED → RELEASED.  A line can never be deducted twice.
 */

interface StockRow {
  product_id: number;
  quantity_on_hand: number;
  quantity_reserved: number;
  reorder_level: number;
}

interface MoveContext {
  referenceType?: string;
  referenceId?: number;
  reason?: string;
  actorUserId?: number | null;
}

async function lock(trx: Db, productId: number): Promise<StockRow> {
  const row = await trx('inventory').where({ product_id: productId }).forUpdate().first();
  if (!row) throw notFound(`Stock record for product ${productId}`);
  return row;
}

async function apply(trx: Db, productId: number, type: StockMovementType, onHandDelta: number, reservedDelta: number, ctx: MoveContext) {
  const before = await lock(trx, productId);
  const onHand = before.quantity_on_hand + onHandDelta;
  const reserved = before.quantity_reserved + reservedDelta;
  if (onHand < 0 || reserved < 0 || reserved > onHand) {
    const product = await trx('products').where({ id: productId }).first('name', 'sku');
    throw insufficientStock(`Not enough stock of ${product?.name ?? 'product'} (${product?.sku ?? productId})`, {
      productId, available: before.quantity_on_hand - before.quantity_reserved, onHand: before.quantity_on_hand, reserved: before.quantity_reserved,
    });
  }
  await trx('inventory').where({ product_id: productId }).update({ quantity_on_hand: onHand, quantity_reserved: reserved });
  await trx('inventory_movements').insert({
    product_id: productId,
    movement_type: type,
    on_hand_delta: onHandDelta,
    reserved_delta: reservedDelta,
    on_hand_after: onHand,
    reserved_after: reserved,
    reference_type: ctx.referenceType ?? null,
    reference_id: ctx.referenceId ?? null,
    reason: ctx.reason ?? null,
    performed_by: ctx.actorUserId ?? null,
  });
  const availableBefore = before.quantity_on_hand - before.quantity_reserved;
  const availableAfter = onHand - reserved;
  if (availableAfter <= before.reorder_level && availableBefore > before.reorder_level) {
    const product = await trx('products').where({ id: productId }).first('name', 'sku');
    const managers = await trx('users as u')
      .join('user_roles as ur', 'ur.user_id', 'u.id')
      .join('role_permissions as rp', 'rp.role_id', 'ur.role_id')
      .join('permissions as p', 'p.id', 'rp.permission_id')
      .where({ 'p.code': PERMISSIONS.INVENTORY_MANAGE, 'u.is_active': true })
      .distinct()
      .pluck('u.id');
    await notify({
      userIds: managers, type: 'LOW_STOCK', title: `Low stock: ${product?.name}`,
      body: `${product?.sku}: ${availableAfter} available (reorder level ${before.reorder_level}). Consider restocking.`,
      link: '/staff/inventory?lowStock=true',
    }, trx);
  }
  return { onHand, reserved, available: availableAfter };
}

export const receiveStock = (trx: Db, productId: number, qty: number, ctx: MoveContext) => apply(trx, productId, 'RECEIPT', qty, 0, ctx);

export function adjustStock(trx: Db, productId: number, delta: number, ctx: MoveContext & { reason: string }) {
  if (delta === 0) throw invalidState('Quantity change cannot be zero');
  return apply(trx, productId, 'ADJUSTMENT', delta, 0, ctx);
}

export async function availability(conn: Db, productIds: number[]) {
  if (!productIds.length) return new Map<number, { onHand: number; reserved: number; available: number; reorderLevel: number }>();
  const rows = await conn('inventory').whereIn('product_id', productIds).select('product_id', 'quantity_on_hand', 'quantity_reserved', 'reorder_level');
  return new Map(rows.map((r) => [r.product_id as number, {
    onHand: r.quantity_on_hand, reserved: r.quantity_reserved, available: r.quantity_on_hand - r.quantity_reserved, reorderLevel: r.reorder_level,
  }]));
}

/* ---------------- line-level, idempotent operations ---------------- */

type LineTable = 'sales_order_items' | 'repair_parts';
const REF_TYPE: Record<LineTable, string> = { sales_order_items: 'SALES_ORDER_ITEM', repair_parts: 'REPAIR_PART' };

async function lockLine(trx: Db, table: LineTable, lineId: number) {
  const line = await trx(table).where({ id: lineId }).forUpdate().first('id', 'product_id', 'quantity', 'stock_state');
  if (!line) throw notFound('Stock line');
  return line as { id: number; product_id: number; quantity: number; stock_state: StockLineState };
}

/** NONE/RELEASED → RESERVED. Already reserved or consumed: no-op. Throws INSUFFICIENT_STOCK when unavailable. */
export async function reserveLine(trx: Db, table: LineTable, lineId: number, actorUserId: number | null) {
  const line = await lockLine(trx, table, lineId);
  if (line.stock_state === 'RESERVED' || line.stock_state === 'CONSUMED') return line.stock_state;
  await apply(trx, line.product_id, 'RESERVATION', 0, line.quantity, { referenceType: REF_TYPE[table], referenceId: line.id, actorUserId });
  await trx(table).where({ id: lineId }).update({ stock_state: 'RESERVED', ...(table === 'repair_parts' ? { reserved_at: trx.fn.now(3), awaiting_stock: false } : {}) });
  return 'RESERVED' as const;
}

/** RESERVED → RELEASED (stock becomes available again). Other states: no-op. */
export async function releaseLine(trx: Db, table: LineTable, lineId: number, actorUserId: number | null, reason?: string) {
  const line = await lockLine(trx, table, lineId);
  if (line.stock_state !== 'RESERVED') return line.stock_state;
  await apply(trx, line.product_id, 'RESERVATION_RELEASE', 0, -line.quantity, { referenceType: REF_TYPE[table], referenceId: line.id, actorUserId, reason });
  await trx(table).where({ id: lineId }).update({ stock_state: 'RELEASED', ...(table === 'repair_parts' ? { released_at: trx.fn.now(3) } : {}) });
  return 'RELEASED' as const;
}

/**
 * RESERVED → CONSUMED: removes the units from stock (on_hand and reserved both drop).
 * NONE/RELEASED → CONSUMED directly from available stock. CONSUMED: no-op (never deducted twice).
 */
export async function consumeLine(trx: Db, table: LineTable, lineId: number, actorUserId: number | null) {
  const line = await lockLine(trx, table, lineId);
  if (line.stock_state === 'CONSUMED') return 'CONSUMED' as const;
  const type: StockMovementType = table === 'sales_order_items' ? 'SALE' : 'REPAIR_CONSUMPTION';
  const reservedDelta = line.stock_state === 'RESERVED' ? -line.quantity : 0;
  await apply(trx, line.product_id, type, -line.quantity, reservedDelta, { referenceType: REF_TYPE[table], referenceId: line.id, actorUserId });
  await trx(table).where({ id: lineId }).update({ stock_state: 'CONSUMED', ...(table === 'repair_parts' ? { consumed_at: trx.fn.now(3) } : {}) });
  return 'CONSUMED' as const;
}

/** Lock order matters: always process lines in ascending product id to avoid deadlocks. */
export function sortByProduct<T extends { product_id: number }>(lines: T[]) {
  return [...lines].sort((a, b) => a.product_id - b.product_id);
}

