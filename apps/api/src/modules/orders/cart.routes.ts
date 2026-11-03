import { Router } from 'express';
import { cartItemSchema, cartItemUpdateSchema } from '@dante/shared';
import { authenticate, requireAuth, requireCustomer } from '../../core/auth.js';
import { badRequest, notFound } from '../../core/errors.js';
import { idFrom, ok, parse } from '../../core/http.js';
import { db, type Db } from '../../db/knex.js';

async function cartId(userId: number, conn: Db = db): Promise<number> {
  const c = await conn('shopping_carts').where({ user_id: userId }).first('id');
  if (c) return c.id;
  await conn('shopping_carts').insert({ user_id: userId }).onConflict('user_id').ignore();
  return (await conn('shopping_carts').where({ user_id: userId }).first('id')).id;
}

/** Cart with live prices and availability (prices are never taken from the client). */
export async function loadCart(userId: number) {
  const id = await cartId(userId);
  const rows = await db('cart_items as ci').join('products as p', 'p.id', 'ci.product_id').leftJoin('inventory as i', 'i.product_id', 'p.id')
    .where('ci.cart_id', id).orderBy('ci.id')
    .select('ci.product_id', 'ci.quantity', 'p.name', 'p.sku', 'p.slug', 'p.price_minor', 'p.is_active', 'i.quantity_on_hand', 'i.quantity_reserved',
      db.raw('(SELECT storage_key FROM product_images pi WHERE pi.product_id = p.id ORDER BY sort_order, id LIMIT 1) as image_key'));
  const items = rows.map((r) => {
    const available = Math.max(0, (r.quantity_on_hand ?? 0) - (r.quantity_reserved ?? 0));
    return {
      productId: r.product_id, name: r.name, sku: r.sku, slug: r.slug, quantity: r.quantity, unitPriceMinor: r.price_minor,
      lineTotalMinor: r.price_minor * r.quantity, available, imageUrl: r.image_key ? `/media/${r.image_key}` : null,
      problem: !r.is_active ? 'UNAVAILABLE' : available < r.quantity ? 'INSUFFICIENT_STOCK' : null,
    };
  });
  return {
    items,
    itemCount: items.reduce((s, i) => s + i.quantity, 0),
    subtotalMinor: items.reduce((s, i) => s + i.lineTotalMinor, 0),
    canCheckout: items.length > 0 && items.every((i) => !i.problem),
  };
}

export function cartRoutes() {
  const r = Router();
  r.use(authenticate, requireCustomer);

  r.get('/', async (req, res) => ok(res, await loadCart(requireAuth(req).userId)));

  r.post('/items', async (req, res) => {
    const { productId, quantity } = parse(cartItemSchema, req.body);
    const userId = requireAuth(req).userId;
    const product = await db('products').where({ id: productId, is_active: true }).first('id');
    if (!product) throw notFound('Product');
    const id = await cartId(userId);
    const existing = await db('cart_items').where({ cart_id: id, product_id: productId }).first('quantity');
    const newQty = (existing?.quantity ?? 0) + quantity;
    if (newQty > 100) throw badRequest('Maximum 100 units per product');
    await db('cart_items').insert({ cart_id: id, product_id: productId, quantity: newQty }).onConflict(['cart_id', 'product_id']).merge(['quantity']);
    ok(res, await loadCart(userId));
  });

  r.patch('/items/:productId', async (req, res) => {
    const { quantity } = parse(cartItemUpdateSchema, req.body);
    const userId = requireAuth(req).userId;
    const id = await cartId(userId);
    const q = db('cart_items').where({ cart_id: id, product_id: idFrom(req, 'productId') });
    if (quantity === 0) await q.del();
    else if (!(await q.clone().update({ quantity }))) throw notFound('Cart item');
    ok(res, await loadCart(userId));
  });

  r.delete('/items/:productId', async (req, res) => {
    const userId = requireAuth(req).userId;
    await db('cart_items').where({ cart_id: await cartId(userId), product_id: idFrom(req, 'productId') }).del();
    ok(res, await loadCart(userId));
  });

  r.delete('/', async (req, res) => {
    const userId = requireAuth(req).userId;
    await db('cart_items').where({ cart_id: await cartId(userId) }).del();
    ok(res, await loadCart(userId));
  });

  return r;
}
