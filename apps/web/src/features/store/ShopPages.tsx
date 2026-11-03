import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, ShieldCheck, ShoppingCart, SlidersHorizontal } from 'lucide-react';
import clsx from 'clsx';
import { api, apiPage, mediaUrl } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { majorToMinor, useMoney, useSettings } from '../../lib/settings';
import type { Category, Product } from '../../lib/types';
import { useToast } from '../../components/toast';
import { Badge, Button, EmptyState, Input, PageHeader, Pagination, QueryState, Select, Spinner, errorMessage } from '../../components/ui';
import { ProductCard, ProductImage, StockBadge } from './ProductCard';

export function ShopPage() {
  const [params, setParams] = useSearchParams();
  const { data: settings } = useSettings();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [showFilters, setShowFilters] = useState(false);
  const page = Number(params.get('page') ?? 1);
  const set = (k: string, v: string | undefined) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  const digits = settings?.currencyMinorDigits ?? 2;
  const categories = useQuery({ queryKey: ['catalog', 'categories'], queryFn: () => api<Category[]>('/catalog/categories') });
  const products = useQuery({
    queryKey: ['catalog', 'products', params.toString()],
    queryFn: () => apiPage<Product>('/catalog/products', { query: {
      q: params.get('q'), categoryId: params.get('category'), condition: params.get('condition'), inStock: params.get('inStock'),
      sort: params.get('sort') ?? 'newest', page, pageSize: 12,
      minPriceMinor: params.get('min') ? majorToMinor(params.get('min')!, digits) : undefined,
      maxPriceMinor: params.get('max') ? majorToMinor(params.get('max')!, digits) : undefined,
    } }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader title="IT products & spare parts" subtitle="The same stock our technicians use for repairs — tested and with warranty." />
      <form onSubmit={(e) => { e.preventDefault(); set('q', q.trim() || undefined); }} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search by name, brand or SKU…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
        </div>
        <Button type="submit">Search</Button>
        <Button variant="secondary" className="lg:hidden" onClick={() => setShowFilters((s) => !s)} icon={<SlidersHorizontal className="size-4" />} aria-expanded={showFilters}>Filters</Button>
      </form>
      <div className="mt-6 grid gap-6 lg:grid-cols-[230px_1fr]">
        <aside className={clsx('space-y-5', !showFilters && 'hidden lg:block')} aria-label="Filters">
          <div>
            <p className="label">Category</p>
            <ul className="space-y-0.5 text-sm">
              <li><button className={clsx('w-full rounded-lg px-2 py-1.5 text-left', !params.get('category') ? 'bg-white font-semibold shadow-card' : 'hover:bg-white/60')} onClick={() => set('category', undefined)}>All products</button></li>
              {categories.data?.filter((c) => !c.parentId).map((c) => (
                <li key={c.id}>
                  <button className={clsx('w-full rounded-lg px-2 py-1.5 text-left', params.get('category') === String(c.id) ? 'bg-white font-semibold shadow-card' : 'hover:bg-white/60')} onClick={() => set('category', String(c.id))}>{c.name}</button>
                  <ul className="ml-3">
                    {categories.data?.filter((s) => s.parentId === c.id).map((s) => (
                      <li key={s.id}><button className={clsx('w-full rounded-lg px-2 py-1 text-left text-slate-600', params.get('category') === String(s.id) ? 'font-semibold text-ink-900' : 'hover:text-ink-900')} onClick={() => set('category', String(s.id))}>{s.name}</button></li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
          <Select label="Condition" value={params.get('condition') ?? ''} onChange={(e) => set('condition', e.target.value || undefined)} placeholder="Any condition"
            options={[{ value: 'NEW', label: 'New' }, { value: 'REFURBISHED', label: 'Refurbished' }, { value: 'USED', label: 'Used' }]} />
          <div className="grid grid-cols-2 gap-2">
            <Input label={`Min (${settings?.currencyCode ?? ''})`} inputMode="decimal" defaultValue={params.get('min') ?? ''} onBlur={(e) => set('min', e.target.value || undefined)} />
            <Input label="Max" inputMode="decimal" defaultValue={params.get('max') ?? ''} onBlur={(e) => set('max', e.target.value || undefined)} />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={params.get('inStock') === 'true'} onChange={(e) => set('inStock', e.target.checked ? 'true' : undefined)} /> In stock only</label>
        </aside>
        <div>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-slate-500" aria-live="polite">{products.data ? `${products.data.meta.total} product(s)` : ''}</p>
            <Select aria-label="Sort" value={params.get('sort') ?? 'newest'} onChange={(e) => set('sort', e.target.value)} className="w-auto"
              options={[{ value: 'newest', label: 'Newest' }, { value: 'price_asc', label: 'Price: low to high' }, { value: 'price_desc', label: 'Price: high to low' }, { value: 'name', label: 'Name' }]} />
          </div>
          <QueryState query={products}>
            {(d) => d.items.length === 0 ? (
              <div className="card"><EmptyState title="No products match" icon={<Search className="size-6" />}>Try a different search or remove some filters.</EmptyState></div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{d.items.map((p) => <ProductCard key={p.id} product={p} />)}</div>
                <div className="card mt-6"><Pagination page={d.meta.page} pageSize={d.meta.pageSize} total={d.meta.total} onPage={(p) => set('page', String(p))} /></div>
              </>
            )}
          </QueryState>
        </div>
      </div>
    </div>
  );
}

export function ProductPage() {
  const { slug } = useParams();
  const money = useMoney();
  const { user, isCustomer } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [qty, setQty] = useState(1);
  const [img, setImg] = useState(0);
  const q = useQuery({ queryKey: ['catalog', 'product', slug], queryFn: () => api<Product>(`/catalog/products/${slug}`) });
  const add = useMutation({
    mutationFn: (p: Product) => api('/cart/items', { body: { productId: p.id, quantity: qty } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['cart'] }); toast.success('Added to your cart'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <Spinner />;
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <QueryState query={q}>
        {(p) => (
          <>
            <Link to="/shop" className="text-sm font-medium text-slate-500 hover:text-ink-900">← Back to shop</Link>
            <div className="mt-4 grid gap-8 lg:grid-cols-2">
              <div>
                <div className="card aspect-[4/3] overflow-hidden">
                  {p.images[img] ? <img src={mediaUrl(p.images[img]!.url)} alt={p.images[img]!.alt} className="h-full w-full object-contain" /> : <ProductImage product={p} />}
                </div>
                {p.images.length > 1 && (
                  <div className="mt-3 flex gap-2">
                    {p.images.map((im, i) => (
                      <button key={im.id} onClick={() => setImg(i)} className={clsx('size-16 overflow-hidden rounded-lg border-2', i === img ? 'border-brand-500' : 'border-transparent')} aria-label={`Image ${i + 1}`}>
                        <img src={mediaUrl(im.url)} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className="text-sm text-slate-500">{p.categoryName}{p.brand ? ` · ${p.brand}` : ''} · SKU {p.sku}</p>
                <h1 className="mt-1 text-3xl font-semibold">{p.name}</h1>
                <div className="mt-3 flex flex-wrap gap-2"><StockBadge stock={p.stock} />{p.condition !== 'NEW' && <Badge color="violet">{p.condition === 'REFURBISHED' ? 'Refurbished' : 'Used'}</Badge>}</div>
                <p className="mt-5 font-display text-3xl font-semibold">{money(p.priceMinor)}</p>
                {p.stock.status !== 'OUT_OF_STOCK' && (
                  <div className="mt-5 flex items-end gap-3">
                    <Input label="Quantity" type="number" min={1} max={Math.min(100, p.stock.available)} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(p.stock.available, Number(e.target.value) || 1)))} className="w-24" />
                    <Button size="lg" variant="accent" icon={<ShoppingCart className="size-5" />} loading={add.isPending}
                      onClick={() => (user ? (isCustomer ? add.mutate(p) : toast.error('Use a customer account to shop')) : navigate(`/login?next=/shop/${p.slug}`))}>
                      Add to cart
                    </Button>
                  </div>
                )}
                {p.warrantyMonths > 0 && <p className="mt-5 flex items-center gap-2 text-sm text-brand-700"><ShieldCheck className="size-4" /> {p.warrantyInfo ?? `${p.warrantyMonths}-month warranty`}</p>}
                <p className="mt-6 whitespace-pre-line text-ink-800">{p.description}</p>
                {p.compatibility && (<><h2 className="mt-6 text-lg font-semibold">Compatibility</h2><p className="mt-1 text-sm text-ink-800">{p.compatibility}</p></>)}
                {Object.keys(p.specifications).length > 0 && (
                  <>
                    <h2 className="mt-6 text-lg font-semibold">Specifications</h2>
                    <dl className="mt-2 divide-y divide-ink-100 rounded-xl border border-ink-100 bg-white text-sm">
                      {Object.entries(p.specifications).map(([k, v]) => <div key={k} className="grid grid-cols-2 px-4 py-2"><dt className="text-slate-500">{k}</dt><dd>{v}</dd></div>)}
                    </dl>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}
