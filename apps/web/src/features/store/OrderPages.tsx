import { useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import { ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS, PAY_ON_COLLECTION_METHODS, type OrderStatus } from '@dante/shared';
import { api, apiPage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDateTime } from '../../lib/format';
import { useMoney } from '../../lib/settings';
import type { OrderDetail, OrderSummary } from '../../lib/types';
import { useToast } from '../../components/toast';
import { Alert, Button, ButtonLink, Card, DescriptionList, EmptyState, Modal, OrderStatusBadge, PageHeader, Pagination, QueryState, Textarea, errorMessage } from '../../components/ui';
import { PaymentList } from '../support/components';
import { PayPanel } from '../support/PayPanel';
import { RecordPaymentButton } from '../staff/RecordPayment';

export function MyOrdersPage() {
  const money = useMoney();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['orders', 'mine', page], queryFn: () => apiPage<OrderSummary>('/orders', { query: { page, pageSize: 15 } }) });
  return (
    <div>
      <PageHeader title="Orders" subtitle="Your IT product purchases" actions={<ButtonLink to="/shop" variant="secondary">Shop</ButtonLink>} />
      <Card padded={false}>
        <QueryState query={q}>
          {(d) => d.items.length === 0 ? <EmptyState title="No orders yet" icon={<Package className="size-6" />} action={<ButtonLink to="/shop">Browse products</ButtonLink>} /> : (
            <>
              <ul className="divide-y divide-ink-100">
                {d.items.map((o) => (
                  <li key={o.id}>
                    <Link to={`/account/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-ink-50/70">
                      <div><p className="font-semibold">{o.reference}</p><p className="text-xs text-slate-500">{fmtDateTime(o.placedAt)} · {o.itemCount} item(s) · {o.fulfilmentMethod === 'DELIVERY' ? 'Delivery' : 'Collection'}</p></div>
                      <div className="flex items-center gap-3"><span className="font-semibold">{money(o.totalMinor)}</span><OrderStatusBadge status={o.status} /></div>
                    </Link>
                  </li>
                ))}
              </ul>
              <Pagination page={d.meta.page} pageSize={d.meta.pageSize} total={d.meta.total} onPage={setPage} />
            </>
          )}
        </QueryState>
      </Card>
    </div>
  );
}

/** Order detail for customers (/account/orders/:id) and staff (/staff/orders/:id). */
export function OrderPage() {
  const id = Number(useParams().id);
  const staffView = useLocation().pathname.startsWith('/staff');
  const [params] = useSearchParams();
  const money = useMoney();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api<OrderDetail>(`/orders/${id}`), refetchInterval: 30_000 });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['order', id] });
  const move = useMutation({
    mutationFn: (status: OrderStatus) => api<OrderDetail>(`/orders/${id}/status`, { body: { status, note: status === 'CANCELLED' ? reason : undefined } }),
    onSuccess: (o) => { qc.setQueryData(['order', id], o); setCancelOpen(false); toast.success(`Order ${ORDER_STATUS_LABELS[o.status].toLowerCase()}`); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: () => api<OrderDetail>(`/orders/${id}/cancel`, { body: { reason } }),
    onSuccess: (o) => { qc.setQueryData(['order', id], o); setCancelOpen(false); toast.success('Order cancelled'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <QueryState query={q}>
      {(o) => (
        <div className="space-y-6">
          <PageHeader back={staffView ? { to: '/staff/orders', label: 'Orders' } : { to: '/account/orders', label: 'Orders' }} title={`Order ${o.reference}`} subtitle={`Placed ${fmtDateTime(o.placedAt)}`} actions={<OrderStatusBadge status={o.status} />} />
          {params.get('placed') && <Alert kind="success" title="Order placed">Your items are reserved. {o.paymentInstructions ? 'Follow the payment instructions below.' : (PAY_ON_COLLECTION_METHODS as readonly string[]).includes(o.paymentMethod) ? 'Pay when you collect your order.' : ''}</Alert>}
          {params.get('payment') === 'success' && <Alert kind="success">Thank you. Your payment is being confirmed by the payment provider.</Alert>}
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <div className="space-y-6">
              <Card title="Items" padded={false}>
                <ul className="divide-y divide-ink-100 text-sm">
                  {o.items.map((i) => (
                    <li key={i.id} className="flex justify-between gap-3 px-5 py-3">
                      <span>{i.quantity} × {i.name}<span className="block text-xs text-slate-500">SKU {i.sku}{staffView && i.stockState ? ` · stock ${i.stockState.toLowerCase()}` : ''}</span></span>
                      <span className="font-medium">{money(i.lineTotalMinor)}</span>
                    </li>
                  ))}
                </ul>
                <dl className="space-y-1 border-t border-ink-100 px-5 py-3 text-sm">
                  <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(o.subtotalMinor)}</dd></div>
                  {o.deliveryFeeMinor > 0 && <div className="flex justify-between"><dt>Delivery</dt><dd>{money(o.deliveryFeeMinor)}</dd></div>}
                  {o.taxMinor > 0 && <div className="flex justify-between text-slate-500"><dt>{o.taxInclusive ? 'Includes tax' : 'Tax'}</dt><dd>{money(o.taxMinor)}</dd></div>}
                  <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd className="font-display">{money(o.totalMinor)}</dd></div>
                </dl>
              </Card>
              {!staffView && o.balance.outstandingMinor > 0 && o.status !== 'CANCELLED' && !(PAY_ON_COLLECTION_METHODS as readonly string[]).includes(o.paymentMethod) && (
                <Card title="Payment"><PayPanel payableType="SALES_ORDER" payableId={o.id} outstandingMinor={o.balance.outstandingMinor} onDone={refresh} /></Card>
              )}
              {o.payments.length > 0 && <Card title="Payments"><PaymentList payments={o.payments} /></Card>}
            </div>
            <div className="space-y-6">
              {staffView && (o.nextStatuses.length > 0 || o.balance.outstandingMinor > 0) && (
                <Card title="Fulfilment">
                  <div className="flex flex-wrap gap-2">
                    {o.nextStatuses.filter((s) => s !== 'CANCELLED').map((s) => <Button key={s} size="sm" loading={move.isPending && move.variables === s} onClick={() => move.mutate(s)}>Mark {ORDER_STATUS_LABELS[s].toLowerCase()}</Button>)}
                    {o.balance.outstandingMinor > 0 && o.status !== 'CANCELLED' && can('payments.record') && <RecordPaymentButton payableType="SALES_ORDER" payableId={o.id} outstandingMinor={o.balance.outstandingMinor} onDone={refresh} />}
                  </div>
                </Card>
              )}
              <Card title="Details">
                <DescriptionList items={[
                  { label: 'Fulfilment', value: o.fulfilmentMethod === 'DELIVERY' ? 'Delivery' : 'Collection' },
                  { label: 'Payment method', value: PAYMENT_METHOD_LABELS[o.paymentMethod] },
                  ...(staffView && o.customer ? [{ label: 'Customer', value: `${o.customer.name} · ${o.customer.email}` }] : []),
                  ...(o.deliveryAddress ? [{ label: 'Deliver to', value: [o.deliveryAddress.line1, o.deliveryAddress.city, o.deliveryAddress.country].filter(Boolean).join(', ') }] : []),
                  ...(o.customerNote ? [{ label: 'Note', value: o.customerNote }] : []),
                ]} />
                {o.paymentInstructions && o.balance.outstandingMinor > 0 && <div className="mt-4"><Alert kind="info" title="How to pay">{o.paymentInstructions} Use reference <strong>{o.reference}</strong>.</Alert></div>}
              </Card>
              <Card title="Tracking">
                <ol className="space-y-3 text-sm">
                  {o.history.map((h, i) => <li key={i}><p className="font-medium">{ORDER_STATUS_LABELS[h.to as OrderStatus]}</p><p className="text-xs text-slate-500">{fmtDateTime(h.at)}{h.note ? ` · ${h.note}` : ''}</p></li>)}
                </ol>
              </Card>
              {o.canCancel && (staffView ? o.nextStatuses.includes('CANCELLED') : true) && <button className="text-sm font-medium text-rose-600 hover:underline" onClick={() => setCancelOpen(true)}>Cancel order</button>}
            </div>
          </div>
          <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this order?"
            footer={<><Button variant="secondary" onClick={() => setCancelOpen(false)}>Keep order</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={cancel.isPending || move.isPending} onClick={() => (staffView ? move.mutate('CANCELLED') : cancel.mutate())}>Cancel order</Button></>}>
            <p className="mb-3 text-sm text-slate-600">Reserved items go back into stock. {staffView && o.balance.paidMinor > 0 && 'Refund the payment first.'}</p>
            <Textarea label="Reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Modal>
        </div>
      )}
    </QueryState>
  );
}
