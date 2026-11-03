import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { REQUEST_STATUS_LABELS_STAFF, REQUEST_STATUSES, SERVICE_TYPE_LABELS, type RequestStatus, type ServiceType } from '@dante/shared';
import { api, apiPage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { timeAgo, humanize } from '../../lib/format';
import { useMoney } from '../../lib/settings';
import type { RequestSummary } from '../../lib/types';
import { useToast } from '../../components/toast';
import { Badge, Card, EmptyState, PageHeader, Pagination, QueryState, RequestStatusBadge, Select, Stat, Table, errorMessage } from '../../components/ui';

interface Dashboard {
  support?: Record<'totalRequests' | 'awaitingReview' | 'unassigned' | 'activeRepairJobs' | 'activeRemoteJobs' | 'awaitingQuotationApproval' | 'awaitingParts' | 'awaitingPayment' | 'completedThisMonth' | 'pendingQuotations' | 'openRemoteSessions' | 'remoteSessionsCompletedThisMonth', number>;
  myJobs?: Partial<Record<RequestStatus, number>>;
  finance?: Record<'outstandingServiceMinor' | 'unpaidOrders' | 'unpaidOrdersMinor' | 'productSalesThisMonthMinor' | 'serviceRevenueThisMonthMinor' | 'paymentsAwaitingVerification', number>;
  store?: Record<'lowStockProducts' | 'ordersToFulfil' | 'ordersAwaitingHandover' | 'ordersThisMonth', number>;
}
export interface Technician { userId: number; name: string; email: string; specialties: string | null; isAvailable: boolean; maxActiveJobs: number; activeJobs: number }

export function StaffDashboardPage() {
  const { user } = useAuth();
  const money = useMoney();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/reports/dashboard'), refetchInterval: 60_000 });
  return (
    <div className="space-y-8">
      <PageHeader title={`Good day, ${user?.firstName}`} subtitle="What needs attention right now" />
      <QueryState query={q}>
        {(d) => (
          <>
            {d.support && (
              <section>
                <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Service desk</h2>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Awaiting review" value={d.support.awaitingReview} tone={d.support.awaitingReview ? 'amber' : 'slate'} to="/staff/requests?status=SUBMITTED" />
                  <Stat label="Accepted, unassigned" value={d.support.unassigned} tone={d.support.unassigned ? 'red' : 'slate'} to="/staff/requests?status=ACCEPTED" />
                  <Stat label="Active hardware/on-site jobs" value={d.support.activeRepairJobs} to="/staff/requests?statusGroup=active" />
                  <Stat label="Active remote jobs" value={d.support.activeRemoteJobs} hint={`${d.support.openRemoteSessions} remote session(s) open`} to="/staff/requests?serviceType=REMOTE_SUPPORT&statusGroup=active" />
                  <Stat label="Quotations awaiting customer" value={d.support.awaitingQuotationApproval} to="/staff/requests?status=AWAITING_QUOTATION_APPROVAL" />
                  <Stat label="Jobs awaiting parts" value={d.support.awaitingParts} tone={d.support.awaitingParts ? 'amber' : 'slate'} to="/staff/requests?status=AWAITING_PARTS" />
                  <Stat label="Awaiting payment" value={d.support.awaitingPayment} to="/staff/requests?status=AWAITING_PAYMENT" />
                  <Stat label="Completed this month" value={d.support.completedThisMonth} tone="teal" hint={`${d.support.totalRequests} requests in total`} />
                </div>
              </section>
            )}
            {d.myJobs && (
              <section>
                <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">My jobs</h2>
                {Object.keys(d.myJobs).length === 0 ? <Card><EmptyState title="No active jobs assigned to you" /></Card> : (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {Object.entries(d.myJobs).map(([s, n]) => <Stat key={s} label={REQUEST_STATUS_LABELS_STAFF[s as RequestStatus]} value={n} to={`/staff/requests?status=${s}`} />)}
                  </div>
                )}
              </section>
            )}
            {d.finance && (
              <section>
                <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Money</h2>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Outstanding service charges" value={money(d.finance.outstandingServiceMinor)} tone={d.finance.outstandingServiceMinor ? 'amber' : 'slate'} to="/staff/reports?tab=outstanding" />
                  <Stat label="Unpaid orders" value={d.finance.unpaidOrders} hint={money(d.finance.unpaidOrdersMinor)} to="/staff/orders?status=PENDING_PAYMENT" />
                  <Stat label="Product sales this month" value={money(d.finance.productSalesThisMonthMinor)} tone="teal" />
                  <Stat label="Payments to verify" value={d.finance.paymentsAwaitingVerification} tone={d.finance.paymentsAwaitingVerification ? 'red' : 'slate'} to="/staff/payments?status=PENDING" />
                </div>
              </section>
            )}
            {d.store && (
              <section>
                <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Store</h2>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Low-stock products" value={d.store.lowStockProducts} tone={d.store.lowStockProducts ? 'red' : 'slate'} to="/staff/inventory?lowStock=true" />
                  <Stat label="Orders to prepare" value={d.store.ordersToFulfil} to="/staff/orders?status=PAID" />
                  <Stat label="Awaiting handover" value={d.store.ordersAwaitingHandover} to="/staff/orders?status=READY_FOR_COLLECTION" />
                  <Stat label="Orders this month" value={d.store.ordersThisMonth} />
                </div>
              </section>
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}

export function RequestQueuePage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const set = (k: string, v?: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== 'page') n.delete('page');
    setParams(n, { replace: true });
  };
  const page = Number(params.get('page') ?? 1);
  const techs = useQuery({ queryKey: ['technicians'], queryFn: () => api<Technician[]>('/staff/technicians'), enabled: can('requests.assign', 'requests.view_all') });
  const q = useQuery({
    queryKey: ['requests', 'staff', params.toString()],
    queryFn: () => apiPage<RequestSummary>('/requests', { query: {
      status: params.get('status'), statusGroup: params.get('status') ? undefined : params.get('statusGroup') ?? 'open', serviceType: params.get('serviceType'),
      urgency: params.get('urgency'), technicianId: params.get('technicianId'), q: params.get('q'), page, pageSize: 25,
    } }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  return (
    <div>
      <PageHeader title={can('requests.view_all') ? 'Service requests' : 'My jobs'} subtitle="Most urgent first" />
      <Card padded={false}>
        <div className="grid gap-3 border-b border-ink-100 p-4 md:grid-cols-6">
          <form className="relative md:col-span-2" onSubmit={(e) => { e.preventDefault(); set('q', search || undefined); }}>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Reference, title or contact" aria-label="Search requests" value={search} onChange={(e) => setSearch(e.target.value)} />
          </form>
          <Select aria-label="Status" value={params.get('status') ?? `group:${params.get('statusGroup') ?? 'open'}`}
            onChange={(e) => { const v = e.target.value; if (v.startsWith('group:')) { const n = new URLSearchParams(params); n.delete('status'); n.set('statusGroup', v.slice(6)); setParams(n); } else set('status', v); }}
            options={[{ value: 'group:open', label: 'All open' }, { value: 'group:active', label: 'In progress' }, { value: 'group:closed', label: 'Completed / closed' }, { value: 'group:all', label: 'Everything' },
              ...REQUEST_STATUSES.map((s) => ({ value: s, label: REQUEST_STATUS_LABELS_STAFF[s] }))]} />
          <Select aria-label="Service type" value={params.get('serviceType') ?? ''} onChange={(e) => set('serviceType', e.target.value || undefined)} placeholder="All services"
            options={(Object.keys(SERVICE_TYPE_LABELS) as ServiceType[]).map((t) => ({ value: t, label: SERVICE_TYPE_LABELS[t] }))} />
          <Select aria-label="Urgency" value={params.get('urgency') ?? ''} onChange={(e) => set('urgency', e.target.value || undefined)} placeholder="Any urgency"
            options={['CRITICAL', 'HIGH', 'NORMAL', 'LOW'].map((u) => ({ value: u, label: humanize(u) }))} />
          {techs.data && can('requests.view_all') && (
            <Select aria-label="Technician" value={params.get('technicianId') ?? ''} onChange={(e) => set('technicianId', e.target.value || undefined)} placeholder="Any technician"
              options={techs.data.map((t) => ({ value: t.userId, label: t.name }))} />
          )}
        </div>
        <QueryState query={q}>
          {(d) => d.items.length === 0 ? <EmptyState title="No requests match these filters" /> : (
            <>
              <Table head={['Request', 'Customer', 'Service', 'Technician', 'Status', 'Updated']}>
                {d.items.map((r) => (
                  <tr key={r.id} className="hover:bg-ink-50/60">
                    <td className="px-4 py-3">
                      <Link to={`/staff/requests/${r.id}`} className="font-semibold text-ink-900 hover:underline">{r.title}</Link>
                      <p className="text-xs text-slate-500">{r.reference} · {r.category} {r.urgency !== 'NORMAL' && <Badge color={r.urgency === 'CRITICAL' ? 'red' : r.urgency === 'HIGH' ? 'amber' : 'slate'}>{humanize(r.urgency)}</Badge>}</p>
                    </td>
                    <td className="px-4 py-3 text-sm">{r.contactName}{r.organizationName && <span className="block text-xs text-slate-500">{r.organizationName}{r.department ? ` · ${r.department}` : ''}</span>}</td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">{SERVICE_TYPE_LABELS[r.serviceType]}</td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">{r.technicianName ?? <span className="text-slate-400">Unassigned</span>}</td>
                    <td className="px-4 py-3"><RequestStatusBadge staff status={r.status} /></td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap text-slate-500">{timeAgo(r.updatedAt)}</td>
                  </tr>
                ))}
              </Table>
              <Pagination page={d.meta.page} pageSize={d.meta.pageSize} total={d.meta.total} onPage={(p) => set('page', String(p))} />
            </>
          )}
        </QueryState>
      </Card>
    </div>
  );
}

export function TechniciansPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['technicians'], queryFn: () => api<Technician[]>('/staff/technicians') });
  const toggle = useMutation({
    mutationFn: (t: Technician) => api(`/staff/technicians/${t.userId}`, { method: 'PATCH', body: { isAvailable: !t.isAvailable } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['technicians'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div>
      <PageHeader title="Technicians" subtitle="Workload and availability. Performance figures are under Reports." />
      <Card padded={false}>
        <QueryState query={q}>
          {(list) => (
            <Table head={['Technician', 'Specialities', 'Active jobs', 'Availability', '']}>
              {list.map((t) => (
                <tr key={t.userId}>
                  <td className="px-4 py-3"><p className="font-medium">{t.name}</p><p className="text-xs text-slate-500">{t.email}</p></td>
                  <td className="px-4 py-3 text-sm">{t.specialties ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-28 overflow-hidden rounded-full bg-ink-100"><div className={`h-full ${t.activeJobs >= t.maxActiveJobs ? 'bg-rose-500' : 'bg-brand-600'}`} style={{ width: `${Math.min(100, (t.activeJobs / t.maxActiveJobs) * 100)}%` }} /></div>
                      <span className="text-sm">{t.activeJobs}/{t.maxActiveJobs}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">{t.isAvailable ? <Badge color="green">Available</Badge> : <Badge color="slate">Unavailable</Badge>}</td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/staff/requests?technicianId=${t.userId}&statusGroup=active`} className="link mr-3 text-sm">Jobs</Link>
                    {can('requests.assign', 'users.manage') && <button className="link text-sm" onClick={() => toggle.mutate(t)}>{t.isAvailable ? 'Mark unavailable' : 'Mark available'}</button>}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </QueryState>
      </Card>
    </div>
  );
}
