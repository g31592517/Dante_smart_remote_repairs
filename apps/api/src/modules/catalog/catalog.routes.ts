import { Router } from 'express';
import multer from 'multer';
import { PERMISSIONS, productCategorySchema, productListQuery, productSchema } from '@dante/shared';
import { authenticate, optionalAuth, requireAuth, requirePermission } from '../../core/auth.js';
import { audit, requestContext } from '../../core/audit.js';
import { badRequest, notFound } from '../../core/errors.js';
import { created, idFrom, ok, pageMeta, parse } from '../../core/http.js';
import { deletePublicFile, savePublicProductImage } from '../../core/storage.js';
import { db } from '../../db/knex.js';
import type { AuthContext } from '../../core/auth.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 6 } });

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 200);
}

function stockLabel(available: number, reorder: number) {
  if (available <= 0) return 'OUT_OF_STOCK';
  if (available <= reorder) return 'LOW_STOCK';
  return 'IN_STOCK';
}

export function mapProduct(p: Record<string, any>, images: Record<string, any>[], auth?: AuthContext) {
  const available = (p.quantity_on_hand ?? 0) - (p.quantity_reserved ?? 0);
  const staffStock = auth?.permissions.has(PERMISSIONS.INVENTORY_VIEW);
  return {
    id: p.id, sku: p.sku, name: p.name, slug: p.slug, categoryId: p.category_id, categoryName: p.category_name, description: p.description,
    priceMinor: p.price_minor, condition: p.condition, brand: p.brand, warrantyMonths: p.warranty_months, warrantyInfo: p.warranty_info,
    compatibility: p.compatibility,
    specifications: typeof p.specifications === 'string' ? JSON.parse(p.specifications) : p.specifications ?? {},
    isActive: !!p.is_active, isFeatured: !!p.is_featured, isSparePart: !!p.is_spare_part,
    images: images.map((i) => ({ id: i.id, url: `/media/${i.storage_key}`, alt: i.alt_text ?? p.name })),
    stock: {
      status: stockLabel(available, p.reorder_level ?? 0),
      available: Math.max(0, available),
      ...(staffStock ? { onHand: p.quantity_on_hand, reserved: p.quantity_reserved, reorderLevel: p.reorder_level } : {}),
    },
  };
}

async function imagesFor(productIds: number[]) {
  if (!productIds.length) return [];
  return db('product_images').whereIn('product_id', productIds).orderBy(['product_id', 'sort_order', 'id']);
}

export function productQuery() {
  return db('products as p')
    .join('product_categories as c', 'c.id', 'p.category_id')
    .leftJoin('inventory as i', 'i.product_id', 'p.id')
    .select('p.*', 'c.name as category_name', 'i.quantity_on_hand', 'i.quantity_reserved', 'i.reorder_level');
}

export function catalogRoutes() {
  const r = Router();

  r.get('/categories', async (_req, res) => {
    const rows = await db('product_categories').where('is_active', true).orderBy(['sort_order', 'name'])
      .select('id', 'name', 'slug', 'parent_id', 'description')
      .select(db.raw('(SELECT COUNT(*) FROM products p WHERE p.category_id = product_categories.id AND p.is_active = 1) as product_count'));
    ok(res, rows.map((c) => ({ id: c.id, name: c.name, slug: c.slug, parentId: c.parent_id, description: c.description, productCount: Number(c.product_count) })));
  });

  r.get('/products', optionalAuth, async (req, res) => {
    const q = parse(productListQuery, req.query);
    const manage = req.auth?.permissions.has(PERMISSIONS.PRODUCTS_MANAGE) || req.auth?.permissions.has(PERMISSIONS.INVENTORY_VIEW);
    const base = productQuery().modify((qb) => {
      if (!(manage && req.query.includeInactive === 'true')) qb.where('p.is_active', true);
      if (q.categoryId) qb.where((w) => w.where('p.category_id', q.categoryId!).orWhere('c.parent_id', q.categoryId!));
      if (q.condition) qb.where('p.condition', q.condition);
      if (q.minPriceMinor !== undefined) qb.where('p.price_minor', '>=', q.minPriceMinor);
      if (q.maxPriceMinor !== undefined) qb.where('p.price_minor', '<=', q.maxPriceMinor);
      if (q.inStock === 'true') qb.whereRaw('(i.quantity_on_hand - i.quantity_reserved) > 0');
      if (q.featured === 'true') qb.where('p.is_featured', true);
      if (q.q) {
        const term = q.q.replace(/[^\p{L}\p{N}\s.-]/gu, ' ').trim();
        if (term) qb.where((w) => w.whereRaw('MATCH(p.name, p.description) AGAINST (? IN BOOLEAN MODE)', [term.split(/\s+/).map((t) => `${t}*`).join(' ')])
          .orWhere('p.sku', 'like', `%${term}%`).orWhere('p.name', 'like', `%${term}%`).orWhere('p.brand', 'like', `%${term}%`));
      }
    });
    const total = await base.clone().clearSelect().count({ n: '*' }).first();
    const sort = { newest: ['p.created_at', 'desc'], price_asc: ['p.price_minor', 'asc'], price_desc: ['p.price_minor', 'desc'], name: ['p.name', 'asc'] }[q.sort] as [string, 'asc' | 'desc'];
    const rows = await base.clone().orderBy(sort[0], sort[1]).orderBy('p.id', 'desc').limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    const imgs = await imagesFor(rows.map((p: Record<string, any>) => p.id));
    ok(res, rows.map((p: Record<string, any>) => mapProduct(p, imgs.filter((i) => i.product_id === p.id), req.auth)), pageMeta(q.page, q.pageSize, Number(total?.n ?? 0)));
  });

  r.get('/products/:idOrSlug', optionalAuth, async (req, res) => {
    const key = String(req.params.idOrSlug);
    const p = await productQuery().where(/^\d+$/.test(key) ? { 'p.id': Number(key) } : { 'p.slug': key }).first();
    const manage = req.auth?.permissions.has(PERMISSIONS.PRODUCTS_MANAGE);
    if (!p || (!p.is_active && !manage)) throw notFound('Product');
    ok(res, mapProduct(p, await imagesFor([p.id]), req.auth));
  });

  /* ----- management ----- */
  const manage = [authenticate, requirePermission(PERMISSIONS.PRODUCTS_MANAGE)];

  r.post('/categories', ...manage, async (req, res) => {
    const c = parse(productCategorySchema, req.body);
    const [id] = await db('product_categories').insert({
      name: c.name, slug: c.slug ?? slugify(c.name), parent_id: c.parentId ?? null, description: c.description ?? null, sort_order: c.sortOrder, is_active: c.active,
    });
    created(res, { id });
  });

  r.put('/categories/:id', ...manage, async (req, res) => {
    const c = parse(productCategorySchema, req.body);
    const id = idFrom(req);
    if (c.parentId === id) throw badRequest('A category cannot be its own parent');
    const n = await db('product_categories').where({ id }).update({
      name: c.name, ...(c.slug ? { slug: c.slug } : {}), parent_id: c.parentId ?? null, description: c.description ?? null, sort_order: c.sortOrder, is_active: c.active,
    });
    if (!n) throw notFound('Category');
    ok(res, { id });
  });

  r.post('/products', ...manage, async (req, res) => {
    const p = parse(productSchema, req.body);
    const auth = requireAuth(req);
    if (!(await db('product_categories').where({ id: p.categoryId }).first('id'))) throw badRequest('Unknown category');
    const id = await db.transaction(async (trx) => {
      let slug = slugify(p.name);
      if (await trx('products').where({ slug }).first('id')) slug = `${slug}-${slugify(p.sku)}`;
      const [pid] = await trx('products').insert({
        sku: p.sku, name: p.name, slug, category_id: p.categoryId, description: p.description, price_minor: p.priceMinor, condition: p.condition,
        brand: p.brand ?? null, warranty_months: p.warrantyMonths, warranty_info: p.warrantyInfo ?? null, compatibility: p.compatibility ?? null,
        specifications: JSON.stringify(p.specifications), is_active: p.isActive, is_featured: p.isFeatured, is_spare_part: p.isSparePart,
      });
      await trx('inventory').insert({ product_id: pid, quantity_on_hand: 0, quantity_reserved: 0, reorder_level: p.reorderLevel });
      await audit({ actorUserId: auth.userId, action: 'product.created', entityType: 'product', entityId: pid as number, metadata: { sku: p.sku }, ...requestContext(req) }, trx);
      return pid as number;
    });
    created(res, mapProduct(await productQuery().where('p.id', id).first(), [], auth));
  });

  r.put('/products/:id', ...manage, async (req, res) => {
    const p = parse(productSchema, req.body);
    const auth = requireAuth(req);
    const id = idFrom(req);
    const existing = await db('products').where({ id }).first('price_minor');
    if (!existing) throw notFound('Product');
    await db.transaction(async (trx) => {
      await trx('products').where({ id }).update({
        sku: p.sku, name: p.name, category_id: p.categoryId, description: p.description, price_minor: p.priceMinor, condition: p.condition,
        brand: p.brand ?? null, warranty_months: p.warrantyMonths, warranty_info: p.warrantyInfo ?? null, compatibility: p.compatibility ?? null,
        specifications: JSON.stringify(p.specifications), is_active: p.isActive, is_featured: p.isFeatured, is_spare_part: p.isSparePart,
      });
      await trx('inventory').where({ product_id: id }).update({ reorder_level: p.reorderLevel });
      await audit({ actorUserId: auth.userId, action: 'product.updated', entityType: 'product', entityId: id,
        metadata: existing.price_minor !== p.priceMinor ? { priceFrom: existing.price_minor, priceTo: p.priceMinor } : undefined, ...requestContext(req) }, trx);
    });
    ok(res, mapProduct(await productQuery().where('p.id', id).first(), await imagesFor([id]), auth));
  });

  r.post('/products/:id/images', ...manage, upload.array('images', 6), async (req, res) => {
    const id = idFrom(req);
    if (!(await db('products').where({ id }).first('id'))) throw notFound('Product');
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw badRequest('Attach at least one image (form field "images")');
    const max = await db('product_images').where({ product_id: id }).max({ m: 'sort_order' }).first();
    let order = Number(max?.m ?? -1) + 1;
    for (const f of files) {
      const key = await savePublicProductImage(f.buffer, f.originalname);
      await db('product_images').insert({ product_id: id, storage_key: key, alt_text: String(req.body.alt ?? '').slice(0, 200) || null, sort_order: order++ });
    }
    ok(res, mapProduct(await productQuery().where('p.id', id).first(), await imagesFor([id]), requireAuth(req)));
  });

  r.delete('/products/:id/images/:imageId', ...manage, async (req, res) => {
    const img = await db('product_images').where({ id: idFrom(req, 'imageId'), product_id: idFrom(req) }).first();
    if (!img) throw notFound('Image');
    await db('product_images').where({ id: img.id }).del();
    await deletePublicFile(img.storage_key);
    ok(res, { deleted: true });
  });

  return r;
}
