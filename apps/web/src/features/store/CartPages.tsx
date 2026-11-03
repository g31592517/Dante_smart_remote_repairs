import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { computeTotals, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@dante/shared';
import { api, mediaUrl } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useMoney, useSettings } from '../../lib/settings';
import type { Address, Cart, OrderDetail } from '../../lib/types';
import { useToast } from '../../components/toast';
import { Alert, Button, ButtonLink, Card, EmptyState, Input, PageHeader, QueryState, Spinner, errorMessage } from '../../components/ui';

export function CartPage() {
  const { user, isCustomer, ready } = useAuth();
  const money = useMoney();
  const qc = useQueryClient();
  const toast = useToast();
  const cart = useQuery({ queryKey: ['cart'], queryFn: () => api<Cart>('/cart'), enabled: isCustomer });
  const update = useMutation({
    mutationFn: ({ productId, quantity }: { productId: number; quantity: number }) => api<Cart>(`/cart/items/${productId}`, { method: 'PATCH', body: { quantity } }),
    onSuccess: (c) => qc.setQueryData(['cart'], c),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!ready) return <Spinner />;
  if (!user || !isCustomer) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <div className="card"><EmptyState title="Sign in to use your cart" icon={<ShoppingCart className="size-6" />} action={<ButtonLink to="/login?next=/cart">Sign in</ButtonLink>}>Your cart is saved to your account, so you can continue on any device.</EmptyState></div>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader title="Your cart" />
      <QueryState query={cart}>
        {(c) => c.items.length === 0 ? (
          <div className="card"><EmptyState title="Your cart is empty" icon={<ShoppingCart className="size-6" />} action={<ButtonLink to="/shop">Browse products</ButtonLink>} /></div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <Card padded={false}>
              <ul className="divide-y divide-ink-100">
                {c.items.map((i) => (
                  <li key={i.productId} className="flex gap-4 p-4">
                    <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-ink-50">{i.imageUrl && <img src={mediaUrl(i.imageUrl)} alt="" className="h-full w-full object-cover" />}</div>
                    <div className="min-w-0 flex-1">
                      <Link to={`/shop/${i.slug}`} className="font-semibold hover:underline">{i.name}</Link>
                      <p className="text-xs text-slate-500">SKU {i.sku} · {money(i.unitPriceMinor)} each</p>
                      {i.problem && <p className="mt-1 text-xs font-medium text-rose-600">{i.problem === 'UNAVAILABLE' ? 'No longer available — please remove' : `Only ${i.available} available`}</p>}
                      <div className="mt-2 flex items-center gap-2">
                        <Button size="sm" variant="secondary" aria-label="Decrease quantity" disabled={update.isPending} onClick={() => update.mutate({ productId: i.productId, quantity: i.quantity - 1 })}><Minus className="size-3.5" /></Button>
                        <span className="w-8 text-center text-sm font-semibold" aria-label="Quantity">{i.quantity}</span>
                        <Button size="sm" variant="secondary" aria-label="Increase quantity" disabled={update.isPending || i.quantity >= i.available} onClick={() => update.mutate({ productId: i.productId, quantity: i.quantity + 1 })}><Plus className="size-3.5" /></Button>
                        <Button size="sm" variant="ghost" aria-label={`Remove ${i.name}`} onClick={() => update.mutate({ productId: i.productId, quantity: 0 })}><Trash2 className="size-4" /></Button>
                      </div>
                    </div>
                    <p className="font-semibold whitespace-nowrap">{money(i.lineTotalMinor)}</p>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Summary" className="h-fit">
              <div className="flex justify-between text-sm"><span>Subtotal ({c.itemCount} items)</span><span className="font-semibold">{money(c.subtotalMinor)}</span></div>
              <p className="mt-1 text-xs text-slate-500">Delivery and tax are calculated at checkout.</p>
              {!c.canCheckout && <div className="mt-3"><Alert kind="warning">Fix the highlighted items before checking out.</Alert></div>}
              <ButtonLink to="/checkout" variant="accent" className={clsx('mt-4 w-full', !c.canCheckout && 'pointer-events-none opacity-50')}>Checkout</ButtonLink>
            </Card>
          </div>
        )}
      </QueryState>
    </div>
  );
}

export function CheckoutPage() {
  const money = useMoney();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: settings } = useSettings();
  const cart = useQuery({ queryKey: ['cart'], queryFn: () => api<Cart>('/cart') });
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: () => api<Address[]>('/account/addresses') });
  const [fulfilment, setFulfilment] = useState<'COLLECTION' | 'DELIVERY'>('COLLECTION');
  const [addressId, setAddressId] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [note, setNote] = useState('');
  const [newAddr, setNewAddr] = useState({ label: 'Home', line1: '', city: '', country: '' });

  const methods: PaymentMethod[] = [...(settings?.enabledPaymentMethods ?? []), ...(settings?.onlinePaymentAvailable ? ['GATEWAY' as const] : [])]
    .filter((m) => fulfilment === 'COLLECTION' || (m !== 'CASH' && m !== 'CARD_ON_SITE'));
  const selectedAddress = addressId ?? addresses.data?.find((a) => a.isDefault)?.id ?? addresses.data?.[0]?.id ?? null;

  const addAddress = useMutation({
    mutationFn: () => api<Address>('/account/addresses', { body: newAddr }),
    onSuccess: (a) => { void qc.invalidateQueries({ queryKey: ['addresses'] }); setAddressId(a.id); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const place = useMutation({
    mutationFn: async () => {
      const order = await api<OrderDetail>('/orders/checkout', { body: { fulfilmentMethod: fulfilment, addressId: fulfilment === 'DELIVERY' ? selectedAddress : undefined, paymentMethod: method, customerNote: note || undefined } });
      if (method === 'GATEWAY') {
        const { checkoutUrl } = await api<{ checkoutUrl: string }>('/payments/checkout', { body: { payableType: 'SALES_ORDER', payableId: order.id } });
        window.location.assign(checkoutUrl);
      }
      return order;
    },
    onSuccess: (order) => {
      void qc.invalidateQueries({ queryKey: ['cart'] });
      if (method !== 'GATEWAY') navigate(`/account/orders/${order.id}?placed=1`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (cart.isLoading || !settings) return <Spinner />;
  const c = cart.data;
  if (!c?.items.length) return <div className="mx-auto max-w-3xl px-4 py-12"><div className="card"><EmptyState title="Your cart is empty" action={<ButtonLink to="/shop">Browse products</ButtonLink>} /></div></div>;
  const fee = fulfilment === 'DELIVERY' ? settings.deliveryFeeMinor : 0;
  const totals = computeTotals(c.items.map((i) => i.lineTotalMinor), settings.taxRateBasisPoints, settings.taxInclusive, fee);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader title="Checkout" back={{ to: '/cart', label: 'Cart' }} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card title="1. Collection or delivery">
            <div className="grid gap-3 sm:grid-cols-2">
              {(['COLLECTION', 'DELIVERY'] as const).map((f) => (
                <button key={f} type="button" onClick={() => { setFulfilment(f); setMethod(''); }} className={clsx('rounded-xl border p-4 text-left', fulfilment === f ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20' : 'border-ink-100')}>
                  <p className="font-semibold">{f === 'COLLECTION' ? 'Collect from our office' : 'Deliver to me'}</p>
                  <p className="text-sm text-slate-500">{f === 'COLLECTION' ? settings.contactAddress : settings.deliveryFeeMinor ? `Delivery fee ${money(settings.deliveryFeeMinor)}` : 'Delivery'}</p>
                </button>
              ))}
            </div>
            {fulfilment === 'DELIVERY' && (
              <div className="mt-4 space-y-2">
                {addresses.data?.map((a) => (
                  <label key={a.id} className={clsx('flex cursor-pointer gap-3 rounded-xl border p-3 text-sm', selectedAddress === a.id ? 'border-brand-500' : 'border-ink-100')}>
                    <input type="radio" name="address" checked={selectedAddress === a.id} onChange={() => setAddressId(a.id)} className="accent-brand-600" />
                    <span><span className="font-semibold">{a.label}</span> — {a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city}, {a.country}</span>
                  </label>
                ))}
                <details className="rounded-xl border border-dashed border-ink-100 p-3 text-sm" open={!addresses.data?.length}>
                  <summary className="cursor-pointer font-medium">Add a new address</summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Input label="Label" value={newAddr.label} onChange={(e) => setNewAddr({ ...newAddr, label: e.target.value })} />
                    <Input label="Street address" value={newAddr.line1} onChange={(e) => setNewAddr({ ...newAddr, line1: e.target.value })} />
                    <Input label="City / town" value={newAddr.city} onChange={(e) => setNewAddr({ ...newAddr, city: e.target.value })} />
                    <Input label="Country" value={newAddr.country} onChange={(e) => setNewAddr({ ...newAddr, country: e.target.value })} />
                  </div>
                  <Button className="mt-3" size="sm" variant="secondary" loading={addAddress.isPending} disabled={!newAddr.line1 || !newAddr.city || !newAddr.country} onClick={() => addAddress.mutate()}>Save address</Button>
                </details>
              </div>
            )}
          </Card>
          <Card title="2. Payment method">
            <div className="grid gap-2">
              {methods.map((m) => (
                <label key={m} className={clsx('flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm', method === m ? 'border-brand-500 bg-brand-50' : 'border-ink-100')}>
                  <input type="radio" name="method" checked={method === m} onChange={() => setMethod(m)} className="accent-brand-600" />
                  <span className="font-medium">{PAYMENT_METHOD_LABELS[m]}</span>
                  <span className="text-slate-500">{m === 'GATEWAY' ? '— pay now' : m === 'CASH' || m === 'CARD_ON_SITE' ? '— pay when you collect' : '— instructions after ordering'}</span>
                </label>
              ))}
            </div>
            {fulfilment === 'DELIVERY' && <p className="mt-2 text-xs text-slate-500">Orders for delivery are dispatched once payment is confirmed.</p>}
          </Card>
          <Card title="3. Note (optional)"><Input aria-label="Order note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything we should know?" /></Card>
        </div>
        <Card title="Order summary" className="h-fit">
          <ul className="space-y-2 text-sm">{c.items.map((i) => <li key={i.productId} className="flex justify-between gap-2"><span className="truncate">{i.quantity} × {i.name}</span><span>{money(i.lineTotalMinor)}</span></li>)}</ul>
          <dl className="mt-4 space-y-1 border-t border-ink-100 pt-3 text-sm">
            {fee > 0 && <div className="flex justify-between"><dt>Delivery</dt><dd>{money(fee)}</dd></div>}
            {totals.taxMinor > 0 && <div className="flex justify-between text-slate-500"><dt>{settings.taxInclusive ? `Includes ${settings.taxLabel}` : settings.taxLabel}</dt><dd>{money(totals.taxMinor)}</dd></div>}
            <div className="flex justify-between pt-1 text-base font-semibold"><dt>Total</dt><dd className="font-display">{money(totals.totalMinor)}</dd></div>
          </dl>
          <Button className="mt-4 w-full" variant="accent" size="lg" loading={place.isPending}
            disabled={!method || (fulfilment === 'DELIVERY' && !selectedAddress) || !c.canCheckout} onClick={() => place.mutate()}>
            {method === 'GATEWAY' ? 'Continue to payment' : 'Place order'}
          </Button>
          <p className="mt-2 text-xs text-slate-500">Prices and availability are confirmed when you place the order; items are reserved for you immediately.</p>
        </Card>
      </div>
    </div>
  );
}
