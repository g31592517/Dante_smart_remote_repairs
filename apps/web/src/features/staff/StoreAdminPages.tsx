import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownUp, ImagePlus, Plus, Search, Trash2 } from 'lucide-react';
import { ORDER_STATUS_LABELS, ORDER_STATUSES, PAYMENT_METHOD_LABELS, PRODUCT_CONDITIONS } from '@dante/shared';
import { api, apiPage, mediaUrl } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate, fmtDateTime, humanize } from '../../lib/format';
import { majorToMinor, useMoney, useSettings } from '../../lib/settings';
import type { Category, OrderSummary, Product } from '../../lib/types';
import { useToast } from '../../components/toast';
import { Alert, Badge, Button, ButtonLink, Card, Checkbox, EmptyState, Input, Modal, OrderStatusBadge, PageHeader, Pagination, QueryState, Select, Table, Textarea, errorMessage } from '../../components/ui';
import { StockBadge } from '../store/ProductCard';

/* ---------------- products ---------------- */

export function ProductsAdminPage() {
  const money = useMoney();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery({ queryKey: ['admin-products', q, page], queryFn: () => apiPage<Product>('/catalog/products', { query: { q, page, pageSize: 25, includeInactive: 'true' } }), placeholderData: keepPreviousData });
  return (
    <div>
      <PageHeader title="Products" subtitle="Catalogue shared by the shop and the repair workshop" actions={<ButtonLink to="/staff/products/new" icon={<Plus className="size-4" />}>New product</ButtonLink>} />
      <Card padded={false}>
        <form className="relative border-b border-ink-100 p-4" onSubmit={(e) => { e.preventDefault(); setPage(1); }}>
          <Search className="pointer-events-none absolute top-1/2 left-7 size-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search name or SKU" aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <QueryState query={list}>
          {(d) => d.items.length === 0 ? <EmptyState title="No products" /> : (
            <>
              <Table head={['Product', 'Category', 'Price', 'Stock', 'Flags']}>
                {d.items.map((p) => (
                  <tr key={p.id} className="hover:bg-ink-50/60">
                    <td className="px-4 py-3"><Link to={`/staff/products/${p.id}`} className="font-semibold hover:underline">{p.name}</Link><p className="text-xs text-slate-500">{p.sku}</p></td>
                    <td className="px-4 py-3 text-sm">{p.categoryName}</td>
                    <td className="px-4 py-3 text-sm font-medium">{money(p.priceMinor)}</td>
                    <td className="px-4 py-3 text-sm">{p.stock.onHand ?? '—'} on hand · {p.stock.reserved ?? 0} reserved<div className="mt-1"><StockBadge stock={p.stock} /></div></td>
                    <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{!p.isActive && <Badge color="red">Hidden</Badge>}{p.isFeatured && <Badge color="amber">Featured</Badge>}{p.isSparePart && <Badge color="blue">Spare part</Badge>}{p.condition !== 'NEW' && <Badge color="violet">{humanize(p.condition)}</Badge>}</div></td>
                  </tr>
                ))}
              </Table>
              <Pagination page={d.meta.page} pageSize={d.meta.pageSize} total={d.meta.total} onPage={setPage} />
            </>
          )}
        </QueryState>
      </Card>
    </div>
  );
}

const emptyProduct = { sku: '', name: '', categoryId: '', description: '', price: '', condition: 'NEW', brand: '', warrantyMonths: 12, warrantyInfo: '', compatibility: '', specs: [['', '']] as [string, string][], reorderLevel: 2, isActive: true, isFeatured: false, isSparePart: false };

export function ProductEditPage() {
  const id = useParams().id;
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: s } = useSettings();
  const digits = s?.currencyMinorDigits ?? 2;
  const [f, setF] = useState(emptyProduct);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const cats = useQuery({ queryKey: ['catalog', 'categories'], queryFn: () => api<Category[]>('/catalog/categories') });
  const product = useQuery({ queryKey: ['admin-product', id], queryFn: () => api<Product>(`/catalog/products/${id}`), enabled: !isNew });
  useEffect(() => {
    const p = product.data;
    if (!p) return;
    setF({
      sku: p.sku, name: p.name, categoryId: String(p.categoryId), description: p.description, price: (p.priceMinor / 10 ** digits).toFixed(digits), condition: p.condition,
      brand: p.brand ?? '', warrantyMonths: p.warrantyMonths, warrantyInfo: p.warrantyInfo ?? '', compatibility: p.compatibility ?? '',
      specs: Object.entries(p.specifications).length ? (Object.entries(p.specifications) as [string, string][]) : [['', '']], reorderLevel: p.stock.reorderLevel ?? 2,
      isActive: p.isActive, isFeatured: p.isFeatured, isSparePart: p.isSparePart,
    });
  }, [product.data, digits]);
  const save = useMutation({
    mutationFn: () => api<Product>(isNew ? '/catalog/products' : `/catalog/products/${id}`, {
      method: isNew ? 'POST' : 'PUT',
      body: {
        sku: f.sku, name: f.name, categoryId: Number(f.categoryId), description: f.description, priceMinor: majorToMinor(f.price, digits), condition: f.condition,
        brand: f.brand || undefined, warrantyMonths: f.warrantyMonths, warrantyInfo: f.warrantyInfo || undefined, compatibility: f.compatibility || undefined,
        specifications: Object.fromEntries(f.specs.filter(([k, v]) => k.trim() && v.trim())), reorderLevel: f.reorderLevel, isActive: f.isActive, isFeatured: f.isFeatured, isSparePart: f.isSparePart,
      },
    }),
    onSuccess: (p) => { toast.success('Product saved'); void qc.invalidateQueries({ queryKey: ['admin-products'] }); setErrors({}); if (isNew) navigate(`/staff/products/${p.id}`, { replace: true }); else void product.refetch(); },
    onError: (e) => { toast.error(errorMessage(e)); setErrors((e as { fieldErrors?: Record<string, string> }).fieldErrors ?? {}); },
  });
  const upload = useMutation({
    mutationFn: (files: File[]) => { const fd = new FormData(); files.forEach((x) => fd.append('images', x)); return api(`/catalog/products/${id}/images`, { form: fd }); },
    onSuccess: () => void product.refetch(),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const removeImg = useMutation({ mutationFn: (imgId: number) => api(`/catalog/products/${id}/images/${imgId}`, { method: 'DELETE' }), onSuccess: () => void product.refetch() });
  if (!isNew && product.isLoading) return <QueryState query={product}>{() => null}</QueryState>;
  return (
    <div className="space-y-6">
      <PageHeader back={{ to: '/staff/products', label: 'Products' }} title={isNew ? 'New product' : f.name} subtitle={isNew ? 'Stock starts at zero — receive it through purchasing or an adjustment.' : `SKU ${f.sku}`} />
      <form className="grid gap-6 lg:grid-cols-[1.4fr_1fr]" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Card title="Details">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Name" required value={f.name} error={errors.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <Input label="SKU" required value={f.sku} error={errors.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} />
            <Select label="Category" required placeholder="Choose…" value={f.categoryId} error={errors.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} options={(cats.data ?? []).map((c) => ({ value: c.id, label: c.parentId ? `— ${c.name}` : c.name }))} />
            <Input label="Brand" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} />
            <Input label={`Selling price (${s?.currencyCode ?? ''})`} required inputMode="decimal" value={f.price} error={errors.priceMinor} onChange={(e) => setF({ ...f, price: e.target.value })} />
            <Select label="Condition" value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} options={PRODUCT_CONDITIONS.map((c) => ({ value: c, label: humanize(c) }))} />
          </div>
          <Textarea className="mt-3" label="Description" rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <Textarea className="mt-3" label="Compatibility" rows={2} value={f.compatibility} onChange={(e) => setF({ ...f, compatibility: e.target.value })} />
          <p className="label mt-4">Specifications</p>
          {f.specs.map(([k, v], i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input aria-label="Specification name" placeholder="e.g. Capacity" value={k} onChange={(e) => setF({ ...f, specs: f.specs.map((x, j) => (j === i ? [e.target.value, x[1]] : x)) })} />
              <Input aria-label="Specification value" placeholder="e.g. 512 GB" value={v} onChange={(e) => setF({ ...f, specs: f.specs.map((x, j) => (j === i ? [x[0], e.target.value] : x)) })} />
              <button type="button" aria-label="Remove specification" className="p-2 text-slate-400 hover:text-rose-600" onClick={() => setF({ ...f, specs: f.specs.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setF({ ...f, specs: [...f.specs, ['', '']] })}>+ Add specification</Button>
        </Card>
        <div className="space-y-6">
          <Card title="Stock & warranty">
            <div className="grid gap-3">
              <Input label="Reorder level" type="number" min={0} hint="A low-stock alert is raised at or below this level" value={f.reorderLevel} onChange={(e) => setF({ ...f, reorderLevel: Number(e.target.value) || 0 })} />
              <Input label="Warranty (months)" type="number" min={0} value={f.warrantyMonths} onChange={(e) => setF({ ...f, warrantyMonths: Number(e.target.value) || 0 })} />
              <Input label="Warranty information" value={f.warrantyInfo} onChange={(e) => setF({ ...f, warrantyInfo: e.target.value })} />
              <Checkbox checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} label="Visible in the shop" />
              <Checkbox checked={f.isFeatured} onChange={(e) => setF({ ...f, isFeatured: e.target.checked })} label="Featured on the homepage" />
              <Checkbox checked={f.isSparePart} onChange={(e) => setF({ ...f, isSparePart: e.target.checked })} label="Spare part used in repairs" />
            </div>
          </Card>
          {!isNew && product.data && (
            <Card title="Images" actions={
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-ink-100 px-3 py-1.5 text-sm font-semibold hover:bg-ink-50">
                <ImagePlus className="size-4" /> Upload
                <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; if (fs.length) upload.mutate(fs); }} />
              </label>
            }>
              {product.data.images.length === 0 ? <p className="text-sm text-slate-500">No images yet (JPEG, PNG or WebP).</p> : (
                <div className="grid grid-cols-3 gap-2">
                  {product.data.images.map((im) => (
                    <div key={im.id} className="group relative aspect-square overflow-hidden rounded-lg border border-ink-100">
                      <img src={mediaUrl(im.url)} alt="" className="h-full w-full object-cover" />
                      <button type="button" aria-label="Delete image" onClick={() => removeImg.mutate(im.id)} className="absolute top-1 right-1 rounded-md bg-white/90 p-1 text-rose-600 opacity-0 group-hover:opacity-100 focus:opacity-100"><Trash2 className="size-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
          <Button type="submit" size="lg" className="w-full" loading={save.isPending}>{isNew ? 'Create product' : 'Save changes'}</Button>
        </div>
      </form>
    </div>
  );
}

/* ---------------- inventory ---------------- */

interface StockRow { productId: number; sku: string; name: string; category: string; priceMinor: number; isActive: boolean; isSparePart: boolean; onHand: number; reserved: number; available: number; reorderLevel: number; lowStock: boolean }
interface Movement { id: number; productName: string; sku: string; type: string; onHandDelta: number; reservedDelta: number; onHandAfter: number; reservedAfter: number; referenceType: string | null; referenceId: number | null; reason: string | null; performedBy: string | null; createdAt: string }

export function InventoryPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [adjust, setAdjust] = useState<StockRow | null>(null);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [movementsFor, setMovementsFor] = useState<StockRow | null>(null);
  const low = params.get('lowStock') === 'true';
  const stock = useQuery({ queryKey: ['stock', low, q], queryFn: () => api<StockRow[]>('/inventory/stock', { query: { lowStock: low ? 'true' : undefined, q } }) });
  const movements = useQuery({ queryKey: ['movements', movementsFor?.productId], enabled: !!movementsFor, queryFn: () => apiPage<Movement>('/inventory/movements', { query: { productId: movementsFor!.productId, pageSize: 50 } }) });
  const reservations = useQuery({
    queryKey: ['reservations', movementsFor?.productId], enabled: !!movementsFor && (movementsFor?.reserved ?? 0) > 0,
    queryFn: () => api<{ orders: { orderId: number; reference: string; quantity: number }[]; repairs: { requestId: number; reference: string; quantity: number }[] }>(`/inventory/reservations/${movementsFor!.productId}`),
  });
  const doAdjust = useMutation({
    mutationFn: () => api('/inventory/adjustments', { body: { productId: adjust!.productId, quantityDelta: Number(delta), reason } }),
    onSuccess: () => { toast.success('Stock adjusted'); setAdjust(null); setDelta(''); setReason(''); void qc.invalidateQueries({ queryKey: ['stock'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div>
      <PageHeader title="Inventory" subtitle="Available = on hand − reserved (for orders and approved repairs)" actions={can('purchasing.manage') && <ButtonLink to="/staff/purchasing" variant="secondary">Restock</ButtonLink>} />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 p-4">
          <input className="input max-w-sm" placeholder="Search name or SKU" aria-label="Search stock" value={q} onChange={(e) => setQ(e.target.value)} />
          <Checkbox checked={low} onChange={(e) => setParams(e.target.checked ? { lowStock: 'true' } : {})} label="Low stock only" />
        </div>
        <QueryState query={stock}>
          {(rows) => rows.length === 0 ? <EmptyState title={low ? 'No low-stock products' : 'No products'} /> : (
            <Table head={['Product', 'On hand', 'Reserved', 'Available', 'Reorder at', '']}>
              {rows.map((s) => (
                <tr key={s.productId} className={s.lowStock ? 'bg-rose-50/40' : ''}>
                  <td className="px-4 py-3"><p className="font-medium">{s.name}</p><p className="text-xs text-slate-500">{s.sku} · {s.category}{s.isSparePart ? ' · spare part' : ''}</p></td>
                  <td className="px-4 py-3 text-sm">{s.onHand}</td>
                  <td className="px-4 py-3 text-sm">{s.reserved}</td>
                  <td className="px-4 py-3 text-sm font-semibold">{s.available}{s.lowStock && <Badge color="red" className="ml-2">Low</Badge>}</td>
                  <td className="px-4 py-3 text-sm">{s.reorderLevel}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setMovementsFor(s)}>History</Button>
                    {can('inventory.manage') && <Button size="sm" variant="ghost" icon={<ArrowDownUp className="size-4" />} onClick={() => setAdjust(s)}>Adjust</Button>}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </QueryState>
      </Card>
      <Modal open={!!adjust} onClose={() => setAdjust(null)} title={`Adjust stock: ${adjust?.name ?? ''}`}
        footer={<><Button variant="secondary" onClick={() => setAdjust(null)}>Cancel</Button><Button loading={doAdjust.isPending} disabled={!Number(delta) || reason.trim().length < 3} onClick={() => doAdjust.mutate()}>Apply</Button></>}>
        <p className="mb-3 text-sm text-slate-600">On hand {adjust?.onHand}, reserved {adjust?.reserved}. Use a positive number to add stock and a negative number to remove it (damage, loss, count correction). Every adjustment is audited.</p>
        <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
          <Input label="Change" type="number" value={delta} onChange={(e) => setDelta(e.target.value)} />
          <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Stock count correction" />
        </div>
      </Modal>
      <Modal wide open={!!movementsFor} onClose={() => setMovementsFor(null)} title={`Stock history: ${movementsFor?.name ?? ''}`}>
        {reservations.data && (reservations.data.orders.length + reservations.data.repairs.length > 0) && (
          <div className="mb-4"><Alert kind="info" title="Currently reserved by">
            {reservations.data.orders.map((o) => <span key={`o${o.orderId}`} className="mr-3"><Link className="link" to={`/staff/orders/${o.orderId}`}>{o.reference}</Link> ×{o.quantity}</span>)}
            {reservations.data.repairs.map((r) => <span key={`r${r.requestId}`} className="mr-3"><Link className="link" to={`/staff/requests/${r.requestId}`}>{r.reference}</Link> ×{r.quantity}</span>)}
          </Alert></div>
        )}
        <QueryState query={movements}>
          {(d) => (
            <Table head={['When', 'Type', 'On hand', 'Reserved', 'Reference', 'By']}>
              {d.items.map((m) => (
                <tr key={m.id}>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{fmtDateTime(m.createdAt)}</td>
                  <td className="px-3 py-2 text-xs"><Badge color={m.type === 'RECEIPT' ? 'green' : m.type === 'SALE' || m.type === 'REPAIR_CONSUMPTION' ? 'blue' : m.type === 'ADJUSTMENT' ? 'amber' : 'slate'}>{humanize(m.type)}</Badge>{m.reason && <span className="block text-slate-500">{m.reason}</span>}</td>
                  <td className="px-3 py-2 text-xs">{m.onHandDelta > 0 ? '+' : ''}{m.onHandDelta || ''} → {m.onHandAfter}</td>
                  <td className="px-3 py-2 text-xs">{m.reservedDelta > 0 ? '+' : ''}{m.reservedDelta || ''} → {m.reservedAfter}</td>
                  <td className="px-3 py-2 text-xs">{m.referenceType ? `${humanize(m.referenceType)} #${m.referenceId ?? ''}` : '—'}</td>
                  <td className="px-3 py-2 text-xs">{m.performedBy ?? 'System'}</td>
                </tr>
              ))}
            </Table>
          )}
        </QueryState>
      </Modal>
    </div>
  );
}

/* ---------------- purchasing ---------------- */

interface Supplier { id: number; name: string; contactName: string | null; email: string | null; phone: string | null; isActive: boolean }
interface PO { id: number; reference: string; status: string; supplierName: string; totalCostMinor: number; expectedAt: string | null; createdAt: string; items?: { id: number; productId: number; name: string; sku: string; quantityOrdered: number; quantityReceived: number; unitCostMinor: number }[] }

export function PurchasingPage() {
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const { data: s } = useSettings();
  const digits = s?.currencyMinorDigits ?? 2;
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplier, setSupplier] = useState({ name: '', contactName: '', email: '', phone: '' });
  const [poOpen, setPoOpen] = useState(false);
  const [po, setPo] = useState<{ supplierId: string; expectedAt: string; lines: { productId: string; quantity: string; cost: string }[] }>({ supplierId: '', expectedAt: '', lines: [{ productId: '', quantity: '1', cost: '' }] });
  const [detail, setDetail] = useState<number | null>(null);
  const [receive, setReceive] = useState<Record<number, string>>({});
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<Supplier[]>('/inventory/suppliers') });
  const pos = useQuery({ queryKey: ['purchase-orders'], queryFn: () => api<PO[]>('/inventory/purchase-orders'), enabled: can('purchasing.manage') });
  const stock = useQuery({ queryKey: ['stock', false, ''], queryFn: () => api<StockRow[]>('/inventory/stock'), enabled: poOpen });
  const poDetail = useQuery({ queryKey: ['purchase-order', detail], queryFn: () => api<PO>(`/inventory/purchase-orders/${detail}`), enabled: !!detail });
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['purchase-orders'] }); void qc.invalidateQueries({ queryKey: ['purchase-order'] }); void qc.invalidateQueries({ queryKey: ['stock'] }); };
  const saveSupplier = useMutation({
    mutationFn: () => api('/inventory/suppliers', { body: { name: supplier.name, contactName: supplier.contactName || undefined, email: supplier.email || undefined, phone: supplier.phone || undefined } }),
    onSuccess: () => { setSupplierOpen(false); setSupplier({ name: '', contactName: '', email: '', phone: '' }); void qc.invalidateQueries({ queryKey: ['suppliers'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const createPo = useMutation({
    mutationFn: () => api<PO>('/inventory/purchase-orders', { body: { supplierId: Number(po.supplierId), expectedAt: po.expectedAt || undefined, items: po.lines.filter((l) => l.productId).map((l) => ({ productId: Number(l.productId), quantity: Number(l.quantity), unitCostMinor: majorToMinor(l.cost || 0, digits) })) } }),
    onSuccess: (p) => { setPoOpen(false); toast.success(`${p.reference} created`); invalidate(); setDetail(p.id); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const poAction = useMutation({
    mutationFn: ({ id, action, body }: { id: number; action: string; body?: unknown }) => api(`/inventory/purchase-orders/${id}/${action}`, { body: body ?? {} }),
    onSuccess: () => { setReceive({}); invalidate(); toast.success('Purchase order updated'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Purchasing" subtitle="Suppliers and restocking. Received stock is immediately available to the shop and to repairs."
        actions={<>{can('suppliers.manage') && <Button variant="secondary" onClick={() => setSupplierOpen(true)}>Add supplier</Button>}{can('purchasing.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setPoOpen(true)}>New purchase order</Button>}</>} />
      {can('purchasing.manage') && (
        <Card title="Purchase orders" padded={false}>
          <QueryState query={pos}>
            {(list) => list.length === 0 ? <EmptyState title="No purchase orders yet" /> : (
              <Table head={['Reference', 'Supplier', 'Status', 'Total cost', 'Expected', '']}>
                {list.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-medium">{p.reference}</td>
                    <td className="px-4 py-3 text-sm">{p.supplierName}</td>
                    <td className="px-4 py-3"><Badge color={p.status === 'RECEIVED' ? 'green' : p.status === 'CANCELLED' ? 'red' : p.status === 'DRAFT' ? 'slate' : 'amber'}>{humanize(p.status)}</Badge></td>
                    <td className="px-4 py-3 text-sm">{money(p.totalCostMinor)}</td>
                    <td className="px-4 py-3 text-sm">{fmtDate(p.expectedAt)}</td>
                    <td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => setDetail(p.id)}>Open</Button></td>
                  </tr>
                ))}
              </Table>
            )}
          </QueryState>
        </Card>
      )}
      <Card title="Suppliers" padded={false}>
        <QueryState query={suppliers}>
          {(list) => (
            <Table head={['Name', 'Contact', 'E-mail', 'Phone']}>
              {list.map((x) => <tr key={x.id}><td className="px-4 py-3 font-medium">{x.name}</td><td className="px-4 py-3 text-sm">{x.contactName ?? '—'}</td><td className="px-4 py-3 text-sm">{x.email ?? '—'}</td><td className="px-4 py-3 text-sm">{x.phone ?? '—'}</td></tr>)}
            </Table>
          )}
        </QueryState>
      </Card>
      <Modal open={supplierOpen} onClose={() => setSupplierOpen(false)} title="Add supplier" footer={<Button loading={saveSupplier.isPending} disabled={!supplier.name.trim()} onClick={() => saveSupplier.mutate()}>Save</Button>}>
        <div className="grid gap-3">
          <Input label="Name" value={supplier.name} onChange={(e) => setSupplier({ ...supplier, name: e.target.value })} />
          <Input label="Contact person" value={supplier.contactName} onChange={(e) => setSupplier({ ...supplier, contactName: e.target.value })} />
          <Input label="E-mail" type="email" value={supplier.email} onChange={(e) => setSupplier({ ...supplier, email: e.target.value })} />
          <Input label="Phone" value={supplier.phone} onChange={(e) => setSupplier({ ...supplier, phone: e.target.value })} />
        </div>
      </Modal>
      <Modal wide open={poOpen} onClose={() => setPoOpen(false)} title="New purchase order" footer={<Button loading={createPo.isPending} disabled={!po.supplierId || !po.lines.some((l) => l.productId)} onClick={() => createPo.mutate()}>Create draft</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Supplier" placeholder="Choose…" value={po.supplierId} onChange={(e) => setPo({ ...po, supplierId: e.target.value })} options={(suppliers.data ?? []).filter((x) => x.isActive).map((x) => ({ value: x.id, label: x.name }))} />
          <Input label="Expected delivery" type="date" value={po.expectedAt} onChange={(e) => setPo({ ...po, expectedAt: e.target.value })} />
        </div>
        <p className="label mt-4">Lines</p>
        {po.lines.map((l, i) => (
          <div key={i} className="mb-2 grid grid-cols-[1fr_90px_120px] gap-2">
            <Select aria-label="Product" placeholder="Product…" value={l.productId} onChange={(e) => setPo({ ...po, lines: po.lines.map((x, j) => (j === i ? { ...x, productId: e.target.value } : x)) })}
              options={(stock.data ?? []).map((x) => ({ value: x.productId, label: `${x.name} (${x.available} available)` }))} />
            <Input aria-label="Quantity" type="number" min={1} value={l.quantity} onChange={(e) => setPo({ ...po, lines: po.lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)) })} />
            <Input aria-label="Unit cost" placeholder="Unit cost" inputMode="decimal" value={l.cost} onChange={(e) => setPo({ ...po, lines: po.lines.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)) })} />
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setPo({ ...po, lines: [...po.lines, { productId: '', quantity: '1', cost: '' }] })}>+ Add line</Button>
      </Modal>
      <Modal wide open={!!detail} onClose={() => setDetail(null)} title={poDetail.data ? `${poDetail.data.reference} — ${poDetail.data.supplierName}` : 'Purchase order'}>
        <QueryState query={poDetail}>
          {(p) => (
            <div className="space-y-4">
              <Badge color={p.status === 'RECEIVED' ? 'green' : 'amber'}>{humanize(p.status)}</Badge>
              <Table head={['Product', 'Ordered', 'Received', 'Unit cost', ...(['ORDERED', 'PARTIALLY_RECEIVED'].includes(p.status) ? ['Receive now'] : [])]}>
                {p.items?.map((i) => (
                  <tr key={i.id}>
                    <td className="px-3 py-2 text-sm">{i.name}<span className="block text-xs text-slate-500">{i.sku}</span></td>
                    <td className="px-3 py-2 text-sm">{i.quantityOrdered}</td>
                    <td className="px-3 py-2 text-sm">{i.quantityReceived}</td>
                    <td className="px-3 py-2 text-sm">{money(i.unitCostMinor)}</td>
                    {['ORDERED', 'PARTIALLY_RECEIVED'].includes(p.status) && (
                      <td className="px-3 py-2"><Input aria-label={`Receive ${i.name}`} type="number" min={0} max={i.quantityOrdered - i.quantityReceived} className="w-24" value={receive[i.id] ?? ''} onChange={(e) => setReceive({ ...receive, [i.id]: e.target.value })} /></td>
                    )}
                  </tr>
                ))}
              </Table>
              <div className="flex flex-wrap justify-end gap-2">
                {['DRAFT', 'ORDERED'].includes(p.status) && <Button variant="ghost" className="text-rose-600" onClick={() => poAction.mutate({ id: p.id, action: 'cancel' })}>Cancel PO</Button>}
                {p.status === 'DRAFT' && <Button onClick={() => poAction.mutate({ id: p.id, action: 'order' })}>Mark as ordered</Button>}
                {['ORDERED', 'PARTIALLY_RECEIVED'].includes(p.status) && (
                  <>
                    <Button variant="secondary" onClick={() => setReceive(Object.fromEntries((p.items ?? []).map((i) => [i.id, String(i.quantityOrdered - i.quantityReceived)])))}>Fill all remaining</Button>
                    <Button loading={poAction.isPending} disabled={!Object.values(receive).some((v) => Number(v) > 0)}
                      onClick={() => poAction.mutate({ id: p.id, action: 'receive', body: { items: Object.entries(receive).filter(([, v]) => Number(v) > 0).map(([k, v]) => ({ purchaseOrderItemId: Number(k), quantityReceived: Number(v) })) } })}>
                      Receive into stock
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </QueryState>
      </Modal>
    </div>
  );
}

/* ---------------- orders ---------------- */

export function OrdersAdminPage() {
  const money = useMoney();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const page = Number(params.get('page') ?? 1);
  const list = useQuery({ queryKey: ['orders', 'staff', params.toString(), q], queryFn: () => apiPage<OrderSummary>('/orders', { query: { status: params.get('status'), q, page, pageSize: 25 } }), placeholderData: keepPreviousData });
  return (
    <div>
      <PageHeader title="Orders" subtitle="Product sales — fulfilment and collection" />
      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-ink-100 p-4">
          <input className="input max-w-xs" placeholder="Order reference or e-mail" aria-label="Search orders" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select aria-label="Status" className="w-auto" value={params.get('status') ?? ''} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})} placeholder="All statuses"
            options={ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] }))} />
        </div>
        <QueryState query={list}>
          {(d) => d.items.length === 0 ? <EmptyState title="No orders" /> : (
            <>
              <Table head={['Order', 'Customer', 'Fulfilment', 'Payment', 'Total', 'Status']}>
                {d.items.map((o) => (
                  <tr key={o.id} className="hover:bg-ink-50/60">
                    <td className="px-4 py-3"><Link className="font-semibold hover:underline" to={`/staff/orders/${o.id}`}>{o.reference}</Link><p className="text-xs text-slate-500">{fmtDateTime(o.placedAt)} · {o.itemCount} item(s)</p></td>
                    <td className="px-4 py-3 text-sm">{o.customerName}</td>
                    <td className="px-4 py-3 text-sm">{o.fulfilmentMethod === 'DELIVERY' ? 'Delivery' : 'Collection'}</td>
                    <td className="px-4 py-3 text-sm">{PAYMENT_METHOD_LABELS[o.paymentMethod]}</td>
                    <td className="px-4 py-3 text-sm font-semibold">{money(o.totalMinor)}</td>
                    <td className="px-4 py-3"><OrderStatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </Table>
              <Pagination page={d.meta.page} pageSize={d.meta.pageSize} total={d.meta.total} onPage={(p) => setParams({ ...Object.fromEntries(params), page: String(p) })} />
            </>
          )}
        </QueryState>
      </Card>
    </div>
  );
}
