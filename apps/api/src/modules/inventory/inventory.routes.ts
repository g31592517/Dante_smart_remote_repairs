import { Router } from 'express';
import { PERMISSIONS, purchaseOrderSchema, receivePurchaseOrderSchema, stockAdjustmentSchema, supplierSchema } from '@dante/shared';
import { authenticate, requireAuth, requirePermission } from '../../core/auth.js';
import { audit, requestContext } from '../../core/audit.js';
import { badRequest, invalidState, notFound } from '../../core/errors.js';
import { created, idFrom, ok, pageMeta, parse } from '../../core/http.js';
import { nextReference } from '../../core/references.js';
import { db } from '../../db/knex.js';
import { notify } from '../notifications/notifications.service.js';
import { adjustStock, receiveStock } from './inventory.service.js';

const P = PERMISSIONS;

function mapSupplier(s: Record<string, any>) {
  return { id: s.id, name: s.name, contactName: s.contact_name, email: s.email, phone: s.phone, address: s.address, notes: s.notes, isActive: !!s.is_active };
}

async function purchaseOrder(id: number) {
  const po = await db('purchase_orders as po').join('suppliers as s', 's.id', 'po.supplier_id').where('po.id', id).first('po.*', 's.name as supplier_name');
  if (!po) throw notFound('Purchase order');
  const items = await db('purchase_order_items as i').join('products as p', 'p.id', 'i.product_id').where('i.purchase_order_id', id)
    .select('i.*', 'p.name', 'p.sku');
  return {
    id: po.id, reference: po.reference, supplierId: po.supplier_id, supplierName: po.supplier_name, status: po.status, expectedAt: po.expected_at,
    notes: po.notes, totalCostMinor: po.total_cost_minor, orderedAt: po.ordered_at, receivedAt: po.received_at, createdAt: po.created_at,
    items: items.map((i) => ({
      id: i.id, productId: i.product_id, name: i.name, sku: i.sku, quantityOrdered: i.quantity_ordered, quantityReceived: i.quantity_received, unitCostMinor: i.unit_cost_minor,
    })),
  };
}

export function inventoryRoutes() {
  const r = Router();
  r.use(authenticate);

  r.get('/stock', requirePermission(P.INVENTORY_VIEW), async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const rows = await db('inventory as i').join('products as p', 'p.id', 'i.product_id').join('product_categories as c', 'c.id', 'p.category_id')
      .modify((qb) => {
        if (req.query.lowStock === 'true') qb.whereRaw('(i.quantity_on_hand - i.quantity_reserved) <= i.reorder_level');
        if (req.query.spareParts === 'true') qb.where('p.is_spare_part', true);
        if (q) qb.where((w) => w.where('p.name', 'like', `%${q}%`).orWhere('p.sku', 'like', `%${q}%`));
      })
      .orderByRaw('(i.quantity_on_hand - i.quantity_reserved - i.reorder_level) asc').orderBy('p.name')
      .select('p.id', 'p.sku', 'p.name', 'p.price_minor', 'p.is_active', 'p.is_spare_part', 'c.name as category', 'i.quantity_on_hand', 'i.quantity_reserved', 'i.reorder_level', 'i.bin_location', 'i.updated_at');
    ok(res, rows.map((s: Record<string, any>) => ({
      productId: s.id, sku: s.sku, name: s.name, category: s.category, priceMinor: s.price_minor, isActive: !!s.is_active, isSparePart: !!s.is_spare_part,
      onHand: s.quantity_on_hand, reserved: s.quantity_reserved, available: s.quantity_on_hand - s.quantity_reserved, reorderLevel: s.reorder_level,
      lowStock: s.quantity_on_hand - s.quantity_reserved <= s.reorder_level, binLocation: s.bin_location, updatedAt: s.updated_at,
    })));
  });

  r.post('/adjustments', requirePermission(P.INVENTORY_MANAGE), async (req, res) => {
    const input = parse(stockAdjustmentSchema, req.body);
    const auth = requireAuth(req);
    const result = await db.transaction(async (trx) => {
      const out = await adjustStock(trx, input.productId, input.quantityDelta, { reason: input.reason, actorUserId: auth.userId, referenceType: 'ADJUSTMENT' });
      await audit({ actorUserId: auth.userId, action: 'inventory.adjusted', entityType: 'product', entityId: input.productId, metadata: { delta: input.quantityDelta, reason: input.reason }, ...requestContext(req) }, trx);
      return out;
    });
    ok(res, result);
  });

  r.get('/movements', requirePermission(P.INVENTORY_VIEW, P.REPORTS_INVENTORY), async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const base = db('inventory_movements as m').join('products as p', 'p.id', 'm.product_id').leftJoin('users as u', 'u.id', 'm.performed_by')
      .modify((qb) => {
        if (req.query.productId) qb.where('m.product_id', Number(req.query.productId));
        if (req.query.type) qb.where('m.movement_type', String(req.query.type));
      });
    const total = await base.clone().count({ n: '*' }).first();
    const rows = await base.clone().orderBy('m.id', 'desc').limit(pageSize).offset((page - 1) * pageSize)
      .select('m.*', 'p.name', 'p.sku', db.raw("CONCAT(u.first_name, ' ', u.last_name) as performed_by_name"));
    ok(res, rows.map((m: Record<string, any>) => ({
      id: m.id, productId: m.product_id, productName: m.name, sku: m.sku, type: m.movement_type, onHandDelta: m.on_hand_delta, reservedDelta: m.reserved_delta,
      onHandAfter: m.on_hand_after, reservedAfter: m.reserved_after, referenceType: m.reference_type, referenceId: m.reference_id, reason: m.reason,
      performedBy: m.performed_by_name, createdAt: m.created_at,
    })), pageMeta(page, pageSize, Number(total?.n ?? 0)));
  });

  /** Who is holding reserved stock of a product (open orders and repairs). */
  r.get('/reservations/:productId', requirePermission(P.INVENTORY_VIEW), async (req, res) => {
    const pid = idFrom(req, 'productId');
    const orders = await db('sales_order_items as i').join('sales_orders as o', 'o.id', 'i.sales_order_id')
      .where({ 'i.product_id': pid, 'i.stock_state': 'RESERVED' }).select('o.id', 'o.reference', 'o.status', 'i.quantity');
    const repairs = await db('repair_parts as rp').join('support_requests as sr', 'sr.id', 'rp.support_request_id')
      .where({ 'rp.product_id': pid, 'rp.stock_state': 'RESERVED' }).select('sr.id', 'sr.reference', 'sr.status', 'rp.quantity');
    ok(res, {
      orders: orders.map((o) => ({ orderId: o.id, reference: o.reference, status: o.status, quantity: o.quantity })),
      repairs: repairs.map((x) => ({ requestId: x.id, reference: x.reference, status: x.status, quantity: x.quantity })),
    });
  });

  /* ----- suppliers ----- */

  r.get('/suppliers', requirePermission(P.SUPPLIERS_MANAGE, P.PURCHASING_MANAGE), async (_req, res) => {
    ok(res, (await db('suppliers').orderBy('name')).map(mapSupplier));
  });
  r.post('/suppliers', requirePermission(P.SUPPLIERS_MANAGE), async (req, res) => {
    const s = parse(supplierSchema, req.body);
    const [id] = await db('suppliers').insert({ name: s.name, contact_name: s.contactName ?? null, email: s.email ?? null, phone: s.phone ?? null, address: s.address ?? null, notes: s.notes ?? null, is_active: s.active });
    created(res, mapSupplier(await db('suppliers').where({ id }).first()));
  });
  r.put('/suppliers/:id', requirePermission(P.SUPPLIERS_MANAGE), async (req, res) => {
    const s = parse(supplierSchema, req.body);
    const n = await db('suppliers').where({ id: idFrom(req) }).update({ name: s.name, contact_name: s.contactName ?? null, email: s.email ?? null, phone: s.phone ?? null, address: s.address ?? null, notes: s.notes ?? null, is_active: s.active });
    if (!n) throw notFound('Supplier');
    ok(res, mapSupplier(await db('suppliers').where({ id: idFrom(req) }).first()));
  });

  /* ----- purchase orders (restocking) ----- */

  r.get('/purchase-orders', requirePermission(P.PURCHASING_MANAGE), async (_req, res) => {
    const rows = await db('purchase_orders as po').join('suppliers as s', 's.id', 'po.supplier_id').orderBy('po.id', 'desc').limit(200)
      .select('po.id', 'po.reference', 'po.status', 'po.total_cost_minor', 'po.expected_at', 'po.created_at', 's.name as supplier_name');
    ok(res, rows.map((p) => ({ id: p.id, reference: p.reference, status: p.status, totalCostMinor: p.total_cost_minor, expectedAt: p.expected_at, createdAt: p.created_at, supplierName: p.supplier_name })));
  });
  r.get('/purchase-orders/:id', requirePermission(P.PURCHASING_MANAGE), async (req, res) => ok(res, await purchaseOrder(idFrom(req))));

  r.post('/purchase-orders', requirePermission(P.PURCHASING_MANAGE), async (req, res) => {
    const input = parse(purchaseOrderSchema, req.body);
    const auth = requireAuth(req);
    if (!(await db('suppliers').where({ id: input.supplierId, is_active: true }).first('id'))) throw badRequest('Choose an active supplier');
    const ids = [...new Set(input.items.map((i) => i.productId))];
    if (ids.length !== input.items.length) throw badRequest('List each product once');
    if (Number((await db('products').whereIn('id', ids).count({ n: '*' }).first())?.n) !== ids.length) throw badRequest('Unknown product in order');
    const id = await db.transaction(async (trx) => {
      const reference = await nextReference(trx, 'PO');
      const total = input.items.reduce((s, i) => s + i.quantity * i.unitCostMinor, 0);
      const [poId] = await trx('purchase_orders').insert({ reference, supplier_id: input.supplierId, status: 'DRAFT', expected_at: input.expectedAt ?? null, notes: input.notes ?? null, total_cost_minor: total, created_by: auth.userId });
      await trx('purchase_order_items').insert(input.items.map((i) => ({ purchase_order_id: poId, product_id: i.productId, quantity_ordered: i.quantity, unit_cost_minor: i.unitCostMinor })));
      await audit({ actorUserId: auth.userId, action: 'purchase_order.created', entityType: 'purchase_order', entityId: poId as number, ...requestContext(req) }, trx);
      return poId as number;
    });
    created(res, await purchaseOrder(id));
  });

  r.post('/purchase-orders/:id/order', requirePermission(P.PURCHASING_MANAGE), async (req, res) => {
    const n = await db('purchase_orders').where({ id: idFrom(req), status: 'DRAFT' }).update({ status: 'ORDERED', ordered_at: db.fn.now(3) });
    if (!n) throw invalidState('Only draft purchase orders can be placed');
    ok(res, await purchaseOrder(idFrom(req)));
  });

  r.post('/purchase-orders/:id/cancel', requirePermission(P.PURCHASING_MANAGE), async (req, res) => {
    const n = await db('purchase_orders').where({ id: idFrom(req) }).whereIn('status', ['DRAFT', 'ORDERED']).update({ status: 'CANCELLED' });
    if (!n) throw invalidState('Only draft or ordered purchase orders can be cancelled');
    ok(res, await purchaseOrder(idFrom(req)));
  });

  /** Receive (part of) a purchase order: each received quantity becomes a RECEIPT stock movement. */
  r.post('/purchase-orders/:id/receive', requirePermission(P.PURCHASING_MANAGE, P.INVENTORY_MANAGE), async (req, res) => {
    const input = parse(receivePurchaseOrderSchema, req.body);
    const auth = requireAuth(req);
    const id = idFrom(req);
    await db.transaction(async (trx) => {
      const po = await trx('purchase_orders').where({ id }).forUpdate().first();
      if (!po) throw notFound('Purchase order');
      if (!['ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status)) throw invalidState('Place the order before receiving stock');
      const items = await trx('purchase_order_items').where({ purchase_order_id: id }).forUpdate();
      const received: number[] = [];
      for (const line of input.items.sort((a, b) => {
        const pa = items.find((i) => i.id === a.purchaseOrderItemId)?.product_id ?? 0;
        const pb = items.find((i) => i.id === b.purchaseOrderItemId)?.product_id ?? 0;
        return pa - pb;
      })) {
        const item = items.find((i) => i.id === line.purchaseOrderItemId);
        if (!item) throw badRequest(`Line ${line.purchaseOrderItemId} is not on this purchase order`);
        if (item.quantity_received + line.quantityReceived > item.quantity_ordered) throw badRequest('Cannot receive more than was ordered');
        await receiveStock(trx, item.product_id, line.quantityReceived, { referenceType: 'PURCHASE_ORDER_ITEM', referenceId: item.id, actorUserId: auth.userId, reason: `Received on ${po.reference}` });
        await trx('purchase_order_items').where({ id: item.id }).increment('quantity_received', line.quantityReceived);
        item.quantity_received += line.quantityReceived;
        received.push(item.product_id);
      }
      const complete = items.every((i) => i.quantity_received >= i.quantity_ordered);
      await trx('purchase_orders').where({ id }).update({ status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED', ...(complete ? { received_at: trx.fn.now(3) } : {}) });
      // let technicians know that parts their repairs are waiting for have arrived
      const waiting = await trx('repair_parts as rp').join('support_requests as sr', 'sr.id', 'rp.support_request_id')
        .whereIn('rp.product_id', received).where({ 'rp.awaiting_stock': true, 'rp.stock_state': 'NONE' }).whereNotNull('sr.assigned_technician_id')
        .distinct('sr.id', 'sr.reference', 'sr.assigned_technician_id');
      for (const w of waiting) {
        await notify({ userIds: [w.assigned_technician_id], type: 'PARTS_ARRIVED', title: `${w.reference}: parts received`,
          body: 'Stock for parts this job is waiting for has arrived. Open the job and allocate the parts.', link: `/staff/requests/${w.id}`, email: false }, trx);
      }
      await audit({ actorUserId: auth.userId, action: 'purchase_order.received', entityType: 'purchase_order', entityId: id, metadata: { lines: input.items }, ...requestContext(req) }, trx);
    });
    ok(res, await purchaseOrder(id));
  });

  return r;
}
