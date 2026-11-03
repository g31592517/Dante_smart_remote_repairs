import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus } from 'lucide-react';
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, REQUEST_STATUS_LABELS_STAFF, ROLES, SERVICE_TYPE_LABELS, SERVICE_TYPES, STAFF_ROLES, type PaymentMethod, type RequestStatus, type ServiceType } from '@dante/shared';
import { api, apiPage, downloadFile } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate, fmtDateTime, humanize } from '../../lib/format';
import { majorToMinor, useMoney } from '../../lib/settings';
import type { Payment, ServiceCategory } from '../../lib/types';
import { useToast } from '../../components/toast';
import { Alert, Badge, Button, Card, Checkbox, DescriptionList, EmptyState, Input, Modal, OrderStatusBadge, PageHeader, Pagination, QueryState, RequestStatusBadge, Select, Stat, Table, Textarea, errorMessage } from '../../components/ui';

/* ---------------- payments ---------------- */

export function PaymentsAdminPage() {
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [refundFor, setRefundFor] = useState<Payment | null>(null);
  const [trailFor, setTrailFor] = useState<Payment | null>(null);
  const [reason, setReason] = useState('');
  const status = params.get('status') ?? '';
  const list = useQuery({ queryKey: ['payments', 'staff', status, page], queryFn: () => apiPage<Payment>('/payments', { query: { status, page } }), placeholderData: keepPreviousData });
  const trail = useQuery({ queryKey: ['payment-trail', trailFor?.id], enabled: !!trailFor, queryFn: () => api<{ id: number; eventType: string; statusAfter: string; amountMinor: number | null; actor: string | null; createdAt: string }[]>(`/payments/${trailFor!.id}/transactions`) });
  const verify = useMutation({
    mutationFn: ({ id, approve }: { id: number; approve: boolean }) => api(`/payments/${id}/verify`, { body: { approve } }),
    onSuccess: () => { toast.success('Payment updated'); void qc.invalidateQueries({ queryKey: ['payments'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const refund = useMutation({
    mutationFn: () => api(`/payments/${refundFor!.id}/refund`, { body: { reason } }),
    onSuccess: () => { toast.success('Refund recorded'); setRefundFor(null); setReason(''); void qc.invalidateQueries({ queryKey: ['payments'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div>
      <PageHeader title="Payments" subtitle="Every payment, its source and its audit trail. Offline payments are recorded from the order or request page." />
      <Card padded={false}>
        <div className="flex gap-2 border-b border-ink-100 p-4">
          {['', 'PENDING', 'SUCCEEDED', 'REFUNDED', 'FAILED'].map((s) => (
            <button key={s} onClick={() => { setParams(s ? { status: s } : {}); setPage(1); }} className={`rounded-xl px-3 py-1.5 text-sm font-medium ${status === s ? 'bg-ink-900 text-white' : 'bg-ink-50 text-slate-600'}`}>{s ? (s === 'PENDING' ? 'To verify / pending' : humanize(s)) : 'All'}</button>
          ))}
        </div>
        <QueryState query={list}>
          {(d) => d.items.length === 0 ? <EmptyState title="No payments" /> : (
            <>
              <Table head={['Payment', 'For', 'Customer', 'Method', 'Amount', 'Status', '']}>
                {d.items.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3"><p className="font-medium">{p.reference}</p><p className="text-xs text-slate-500">{fmtDateTime(p.createdAt)} · {p.providerReference}</p></td>
                    <td className="px-4 py-3 text-sm"><Link className="link" to={p.payableType === 'SALES_ORDER' ? `/staff/orders/${p.payableId}` : `/staff/requests/${p.payableId}`}>{p.payableReference}</Link></td>
                    <td className="px-4 py-3 text-sm">{p.customerName}</td>
                    <td className="px-4 py-3 text-sm">{PAYMENT_METHOD_LABELS[p.method]}</td>
                    <td className="px-4 py-3 text-sm font-semibold">{money(p.amountMinor)}</td>
                    <td className="px-4 py-3"><Badge color={p.status === 'SUCCEEDED' ? 'green' : p.status === 'PENDING' ? 'amber' : p.status === 'REFUNDED' ? 'violet' : 'red'}>{humanize(p.status)}</Badge></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {p.status === 'PENDING' && p.provider === 'OFFLINE' && can('payments.record') && <>
                        <Button size="sm" variant="accent" onClick={() => verify.mutate({ id: p.id, approve: true })}>Verify</Button>{' '}
                        <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => verify.mutate({ id: p.id, approve: false })}>Reject</Button>
                      </>}
                      {p.status === 'SUCCEEDED' && can('payments.refund') && <Button size="sm" variant="ghost" onClick={() => setRefundFor(p)}>Refund</Button>}
                      <Button size="sm" variant="ghost" onClick={() => setTrailFor(p)}>Trail</Button>
                    </td>
                  </tr>
                ))}
              </Table>
              <Pagination page={d.meta.page} pageSize={d.meta.pageSize} total={d.meta.total} onPage={setPage} />
            </>
          )}
        </QueryState>
      </Card>
      <Modal open={!!refundFor} onClose={() => setRefundFor(null)} title={`Refund ${refundFor?.reference ?? ''}`}
        footer={<><Button variant="secondary" onClick={() => setRefundFor(null)}>Cancel</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={refund.isPending} onClick={() => refund.mutate()}>Record refund</Button></>}>
        <p className="mb-3 text-sm text-slate-600">{refundFor?.method === 'GATEWAY' ? 'The refund is sent to the payment provider.' : 'Offline payment: return the money to the customer, then record the refund here.'}</p>
        <Textarea label="Reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
      <Modal open={!!trailFor} onClose={() => setTrailFor(null)} title={`Audit trail ${trailFor?.reference ?? ''}`}>
        <QueryState query={trail}>
          {(t) => <ul className="space-y-2 text-sm">{t.map((x) => <li key={x.id}><strong>{humanize(x.eventType)}</strong> → {humanize(x.statusAfter)}{x.amountMinor ? ` · ${money(x.amountMinor)}` : ''}<span className="block text-xs text-slate-500">{fmtDateTime(x.createdAt)}{x.actor ? ` · ${x.actor}` : ''}</span></li>)}</ul>}
        </QueryState>
      </Modal>
    </div>
  );
}

/* ---------------- customers & organisations ---------------- */

interface UserRow { id: number; email: string; firstName: string; lastName: string; phone: string | null; accountType: string; isActive: boolean; lastLoginAt: string | null; createdAt: string; invitePending: boolean; roles: string[]; organization: { id: number; name: string; orgRole: string } | null }

export function CustomersPage() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery({ queryKey: ['customers', q, page], queryFn: () => apiPage<UserRow>('/staff/users', { query: { kind: 'customers', q, page } }), placeholderData: keepPreviousData });
  return (
    <div>
      <PageHeader title="Customers" />
      <Card padded={false}>
        <div className="border-b border-ink-100 p-4"><input className="input max-w-sm" placeholder="Search name or e-mail" aria-label="Search customers" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        <QueryState query={list}>
          {(d) => (
            <>
              <Table head={['Customer', 'Type', 'Organisation', 'Joined', 'Status']}>
                {d.items.map((u) => (
                  <tr key={u.id} className="hover:bg-ink-50/60">
                    <td className="px-4 py-3"><Link className="font-semibold hover:underline" to={`/staff/customers/${u.id}`}>{u.firstName} {u.lastName}</Link><p className="text-xs text-slate-500">{u.email}</p></td>
                    <td className="px-4 py-3 text-sm">{humanize(u.accountType)}</td>
                    <td className="px-4 py-3 text-sm">{u.organization ? `${u.organization.name} (${u.organization.orgRole === 'ORG_ADMIN' ? 'admin' : 'member'})` : '—'}</td>
                    <td className="px-4 py-3 text-sm">{fmtDate(u.createdAt)}</td>
                    <td className="px-4 py-3">{u.isActive ? <Badge color="green">Active</Badge> : <Badge color="red">Deactivated</Badge>}</td>
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

export function CustomerDetailPage() {
  const id = Number(useParams().id);
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => api<UserRow & { requests: { id: number; reference: string; title: string; status: RequestStatus; submittedAt: string }[]; orders: { id: number; reference: string; status: 'PAID'; totalMinor: number; placedAt: string }[] }>(`/staff/users/${id}`) });
  const toggle = useMutation({
    mutationFn: (active: boolean) => api(`/staff/users/${id}/active`, { method: 'PUT', body: { active } }),
    onSuccess: () => { toast.success('Account updated'); void qc.invalidateQueries({ queryKey: ['customer', id] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <QueryState query={q}>
      {(u) => (
        <div className="space-y-6">
          <PageHeader back={{ to: '/staff/customers', label: 'Customers' }} title={`${u.firstName} ${u.lastName}`} subtitle={u.email}
            actions={can('customers.manage', 'users.manage') && <Button variant={u.isActive ? 'secondary' : 'accent'} loading={toggle.isPending} onClick={() => toggle.mutate(!u.isActive)}>{u.isActive ? 'Deactivate account' : 'Reactivate account'}</Button>} />
          <Card><DescriptionList items={[
            { label: 'Account', value: humanize(u.accountType) }, { label: 'Phone', value: u.phone }, { label: 'Organisation', value: u.organization ? <Link className="link" to="/staff/organizations">{u.organization.name}</Link> : '—' },
            { label: 'Last sign-in', value: fmtDateTime(u.lastLoginAt) }, { label: 'Status', value: u.isActive ? 'Active' : 'Deactivated' },
          ]} /></Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Requests" padded={false}>
              {u.requests.length === 0 ? <EmptyState title="No requests" /> : <ul className="divide-y divide-ink-100">{u.requests.map((r) => <li key={r.id}><Link to={`/staff/requests/${r.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-ink-50/70"><span><span className="block font-medium">{r.title}</span><span className="text-xs text-slate-500">{r.reference} · {fmtDate(r.submittedAt)}</span></span><RequestStatusBadge staff status={r.status} /></Link></li>)}</ul>}
            </Card>
            <Card title="Orders" padded={false}>
              {u.orders.length === 0 ? <EmptyState title="No orders" /> : <ul className="divide-y divide-ink-100">{u.orders.map((o) => <li key={o.id}><Link to={`/staff/orders/${o.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-ink-50/70"><span><span className="block font-medium">{o.reference}</span><span className="text-xs text-slate-500">{fmtDate(o.placedAt)} · {money(o.totalMinor)}</span></span><OrderStatusBadge status={o.status} /></Link></li>)}</ul>}
            </Card>
          </div>
        </div>
      )}
    </QueryState>
  );
}

interface OrgRow { id: number; name: string; registrationNo: string | null; billingEmail: string | null; phone: string | null; centralBilling: boolean; isActive: boolean; memberCount: number; openRequests: number; createdAt: string }

export function OrganizationsAdminPage() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const list = useQuery({ queryKey: ['orgs', q, page], queryFn: () => apiPage<OrgRow>('/organizations', { query: { q, page } }), placeholderData: keepPreviousData });
  const detail = useQuery({ queryKey: ['org', open], enabled: !!open, queryFn: () => api<OrgRow & { deviceCount: number; members: { id: number; email: string; firstName: string; lastName: string; orgRole: string; department: string | null; isActive: boolean }[] }>(`/organizations/${open}`) });
  const toggle = useMutation({
    mutationFn: (o: OrgRow) => api(`/organizations/${o.id}`, { method: 'PATCH', body: { isActive: !o.isActive } }),
    onSuccess: () => { toast.success('Organisation updated'); void qc.invalidateQueries({ queryKey: ['orgs'] }); void qc.invalidateQueries({ queryKey: ['org'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div>
      <PageHeader title="Organisations" subtitle="Corporate customers, their employees and open work" />
      <Card padded={false}>
        <div className="border-b border-ink-100 p-4"><input className="input max-w-sm" placeholder="Search organisations" aria-label="Search organisations" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        <QueryState query={list}>
          {(d) => d.items.length === 0 ? <EmptyState title="No organisations yet" /> : (
            <>
              <Table head={['Organisation', 'Members', 'Open requests', 'Billing', 'Status', '']}>
                {d.items.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-3"><p className="font-semibold">{o.name}</p><p className="text-xs text-slate-500">{o.billingEmail ?? ''}</p></td>
                    <td className="px-4 py-3 text-sm">{o.memberCount}</td>
                    <td className="px-4 py-3 text-sm"><Link className="link" to={`/staff/requests?organizationId=${o.id}`}>{o.openRequests}</Link></td>
                    <td className="px-4 py-3 text-sm">{o.centralBilling ? 'Central' : 'Per employee'}</td>
                    <td className="px-4 py-3">{o.isActive ? <Badge color="green">Active</Badge> : <Badge color="red">Inactive</Badge>}</td>
                    <td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => setOpen(o.id)}>Members</Button>{can('organizations.manage') && <Button size="sm" variant="ghost" onClick={() => toggle.mutate(o)}>{o.isActive ? 'Deactivate' : 'Activate'}</Button>}</td>
                  </tr>
                ))}
              </Table>
              <Pagination page={d.meta.page} pageSize={d.meta.pageSize} total={d.meta.total} onPage={setPage} />
            </>
          )}
        </QueryState>
      </Card>
      <Modal wide open={!!open} onClose={() => setOpen(null)} title={detail.data?.name ?? 'Organisation'}>
        <QueryState query={detail}>
          {(o) => (
            <>
              <p className="mb-3 text-sm text-slate-600">{o.deviceCount} registered device(s)</p>
              <Table head={['Member', 'Department', 'Role', 'Status']}>
                {o.members.map((m) => <tr key={m.id}><td className="px-3 py-2 text-sm">{m.firstName} {m.lastName}<span className="block text-xs text-slate-500">{m.email}</span></td><td className="px-3 py-2 text-sm">{m.department ?? '—'}</td><td className="px-3 py-2 text-sm">{m.orgRole === 'ORG_ADMIN' ? 'Admin' : 'Member'}</td><td className="px-3 py-2">{m.isActive ? <Badge color="green">Active</Badge> : <Badge color="red">Inactive</Badge>}</td></tr>)}
              </Table>
            </>
          )}
        </QueryState>
      </Modal>
    </div>
  );
}

/* ---------------- staff accounts ---------------- */

export function TeamPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const [editRoles, setEditRoles] = useState<UserRow | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', roles: ['TECHNICIAN'] as string[], specialties: '' });
  const list = useQuery({ queryKey: ['staff-users'], queryFn: () => apiPage<UserRow>('/staff/users', { query: { kind: 'staff', pageSize: 100 } }) });
  const create = useMutation({
    mutationFn: () => api('/staff/users', { body: { ...form, phone: form.phone || undefined, specialties: form.specialties || undefined } }),
    onSuccess: () => { toast.success('Staff member created — an invitation e-mail was sent'); setCreating(false); void qc.invalidateQueries({ queryKey: ['staff-users'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveRoles = useMutation({
    mutationFn: () => api(`/staff/users/${editRoles!.id}/roles`, { method: 'PUT', body: { roles } }),
    onSuccess: () => { toast.success('Roles updated'); setEditRoles(null); void qc.invalidateQueries({ queryKey: ['staff-users'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: (u: UserRow) => api(`/staff/users/${u.id}/active`, { method: 'PUT', body: { active: !u.isActive } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['staff-users'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const roleLabel = (r: string) => humanize(r);
  const RolePicker = ({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) => (
    <fieldset className="space-y-2"><legend className="label">Roles</legend>
      {STAFF_ROLES.map((r) => <Checkbox key={r} checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} label={roleLabel(r)} />)}
    </fieldset>
  );
  return (
    <div>
      <PageHeader title="Staff accounts" subtitle="Roles decide what each person can see and do" actions={<Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Add staff member</Button>} />
      <Card padded={false}>
        <QueryState query={list}>
          {(d) => (
            <Table head={['Name', 'Roles', 'Last sign-in', 'Status', '']}>
              {d.items.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3"><p className="font-medium">{u.firstName} {u.lastName}</p><p className="text-xs text-slate-500">{u.email}</p></td>
                  <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r} color={r === ROLES.ADMIN ? 'red' : 'teal'}>{roleLabel(r)}</Badge>)}</div></td>
                  <td className="px-4 py-3 text-sm">{u.invitePending ? <Badge color="amber">Invitation pending</Badge> : fmtDateTime(u.lastLoginAt)}</td>
                  <td className="px-4 py-3">{u.isActive ? <Badge color="green">Active</Badge> : <Badge color="red">Deactivated</Badge>}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => { setEditRoles(u); setRoles(u.roles); }}>Roles</Button>
                    {u.id !== user?.id && <Button size="sm" variant="ghost" onClick={() => toggle.mutate(u)}>{u.isActive ? 'Deactivate' : 'Reactivate'}</Button>}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </QueryState>
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="Add staff member" footer={<Button loading={create.isPending} disabled={!form.email || !form.firstName || !form.roles.length} onClick={() => create.mutate()}>Create & invite</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          <Input label="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          <Input label="E-mail" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <div className="sm:col-span-2"><RolePicker value={form.roles} onChange={(v) => setForm({ ...form, roles: v })} /></div>
          {form.roles.includes('TECHNICIAN') && <div className="sm:col-span-2"><Input label="Specialities" value={form.specialties} onChange={(e) => setForm({ ...form, specialties: e.target.value })} /></div>}
        </div>
      </Modal>
      <Modal open={!!editRoles} onClose={() => setEditRoles(null)} title={`Roles for ${editRoles?.firstName ?? ''}`} footer={<Button loading={saveRoles.isPending} disabled={!roles.length} onClick={() => saveRoles.mutate()}>Save roles</Button>}>
        <RolePicker value={roles} onChange={setRoles} />
      </Modal>
    </div>
  );
}

/* ---------------- reports ---------------- */

type ReportKey = 'requests-by-category' | 'requests-by-period' | 'response-times' | 'technician-performance' | 'service-types' | 'satisfaction' | 'revenue' | 'product-sales' | 'inventory-movements' | 'outstanding';
const REPORTS: { key: ReportKey; label: string; perms: string[] }[] = [
  { key: 'requests-by-category', label: 'Requests by category', perms: ['reports.operational'] },
  { key: 'requests-by-period', label: 'Requests by period', perms: ['reports.operational'] },
  { key: 'response-times', label: 'Response & resolution times', perms: ['reports.operational'] },
  { key: 'technician-performance', label: 'Technician performance', perms: ['reports.operational', 'technicians.performance'] },
  { key: 'service-types', label: 'Remote vs physical', perms: ['reports.operational'] },
  { key: 'satisfaction', label: 'Customer satisfaction', perms: ['reports.operational', 'technicians.performance'] },
  { key: 'revenue', label: 'Revenue', perms: ['reports.financial'] },
  { key: 'product-sales', label: 'Product sales', perms: ['reports.financial', 'reports.inventory'] },
  { key: 'inventory-movements', label: 'Inventory movements', perms: ['reports.inventory'] },
  { key: 'outstanding', label: 'Outstanding payments', perms: ['reports.financial', 'payments.view'] },
];

export function ReportsPage() {
  const { can } = useAuth();
  const money = useMoney();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const available = REPORTS.filter((r) => can(...(r.perms as never[])));
  const tab = (available.find((r) => r.key === params.get('tab'))?.key ?? available[0]?.key) as ReportKey | undefined;
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [granularity, setGranularity] = useState('day');
  const q = useQuery({ queryKey: ['report', tab, from, to, granularity], enabled: !!tab, queryFn: () => api<{ data: any }>(`/reports/${tab}`, { query: { from, to, granularity } }) });
  if (!tab) return <EmptyState title="No reports available for your role" />;
  const mm = (v: number) => money(v);
  return (
    <div>
      <PageHeader title="Reports" actions={<Button variant="secondary" icon={<Download className="size-4" />} onClick={() => downloadFile(`/reports/${tab}`, { from, to, granularity, format: 'csv' }, `${tab}.csv`).catch((e) => toast.error(errorMessage(e)))}>Export CSV</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        {available.map((r) => <button key={r.key} onClick={() => setParams({ tab: r.key })} className={`rounded-xl px-3 py-1.5 text-sm font-medium ${tab === r.key ? 'bg-ink-900 text-white' : 'bg-white text-slate-600'}`}>{r.label}</button>)}
      </div>
      {tab !== 'outstanding' && (
        <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
          <Input label="From" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <Input label="To" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
          {tab === 'requests-by-period' && <Select label="Group by" value={granularity} onChange={(e) => setGranularity(e.target.value)} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />}
        </div>
      )}
      <Card padded={false}>
        <QueryState query={q}>
          {({ data }) => {
            const rows: Record<string, unknown>[] | null = Array.isArray(data) ? data : null;
            if (tab === 'satisfaction') {
              return (
                <div className="space-y-6 p-5">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Stat label="Average rating" value={data.avgRating ?? '—'} hint={`${data.responses} response(s)`} tone="teal" />
                    <Stat label="Issue resolved" value={data.resolvedPercent === null ? '—' : `${data.resolvedPercent}%`} />
                    <Stat label="Response rate" value={data.responseRate === null ? '—' : `${data.responseRate}%`} hint={`${data.completedJobs} completed jobs`} />
                    <Stat label="Communication" value={data.avgCommunication ?? '—'} />
                  </div>
                  <div className="space-y-1">{data.distribution.map((d: { rating: number; count: number }) => (
                    <div key={d.rating} className="flex items-center gap-3 text-sm"><span className="w-12">{d.rating} ★</span><div className="h-3 flex-1 overflow-hidden rounded-full bg-ink-100"><div className="h-full bg-spark-500" style={{ width: `${data.responses ? (d.count / data.responses) * 100 : 0}%` }} /></div><span className="w-8 text-right">{d.count}</span></div>
                  ))}</div>
                  <ul className="divide-y divide-ink-100">{data.recentComments.map((c: { reference: string; rating: number; comment: string; createdAt: string }) => <li key={c.reference} className="py-2 text-sm"><strong>{c.reference}</strong> · {c.rating}/5 · {fmtDate(c.createdAt)}<p className="text-slate-600">“{c.comment}”</p></li>)}</ul>
                </div>
              );
            }
            if (tab === 'service-types') return <ReportTable rows={data.requests} money={mm} />;
            if (tab === 'revenue') return <><ReportTable rows={data.rows} money={mm} /><p className="border-t border-ink-100 px-5 py-3 text-sm">Refunded in period: <strong>{money(data.refundedMinor)}</strong></p></>;
            return rows && rows.length ? <ReportTable rows={rows} money={mm} /> : <EmptyState title="No data for this period" />;
          }}
        </QueryState>
      </Card>
    </div>
  );
}

function ReportTable({ rows, money }: { rows: Record<string, unknown>[]; money: (v: number) => string }) {
  if (!rows.length) return <EmptyState title="No data for this period" />;
  const cols = Object.keys(rows[0]!).filter((c) => !['technicianId', 'id'].includes(c));
  const label = (c: string) => humanize(c.replace(/([A-Z])/g, '_$1').replace(/_minor$/i, '').toUpperCase());
  const cell = (c: string, v: unknown): ReactNode => {
    if (v === null || v === undefined) return '—';
    if (/Minor$/.test(c)) return money(Number(v));
    if (c === 'serviceType') return SERVICE_TYPE_LABELS[v as ServiceType] ?? String(v);
    if (c === 'status') return REQUEST_STATUS_LABELS_STAFF[v as RequestStatus] ?? humanize(String(v));
    if (['movementType', 'source', 'type', 'method'].includes(c)) return humanize(String(v));
    return String(v);
  };
  return (
    <Table head={cols.map(label)}>
      {rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className="px-4 py-2.5 text-sm">{cell(c, r[c])}</td>)}</tr>)}
    </Table>
  );
}

/* ---------------- audit ---------------- */

export function AuditPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['audit', action, page], queryFn: () => apiPage<{ id: number; action: string; entityType: string | null; entityId: number | null; actorEmail: string | null; ip: string | null; metadata: unknown; createdAt: string }>('/reports/audit', { query: { action, page } }), placeholderData: keepPreviousData });
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Sensitive operations: sign-ins, role changes, remote access, quotations, payments, stock adjustments and settings" />
      <Card padded={false}>
        <div className="border-b border-ink-100 p-4"><input className="input max-w-sm" placeholder="Filter by action prefix, e.g. remote. or payment." aria-label="Filter audit log" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} /></div>
        <QueryState query={q}>
          {(d) => (
            <>
              <Table head={['When', 'Action', 'Actor', 'Entity', 'Details']}>
                {d.items.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap">{fmtDateTime(a.createdAt)}</td>
                    <td className="px-4 py-2.5 text-sm font-medium">{a.action}</td>
                    <td className="px-4 py-2.5 text-sm">{a.actorEmail ?? 'System'}<span className="block text-xs text-slate-400">{a.ip}</span></td>
                    <td className="px-4 py-2.5 text-sm">{a.entityType ? `${a.entityType} #${a.entityId}` : '—'}</td>
                    <td className="max-w-md px-4 py-2.5 font-mono text-xs break-all text-slate-600">{a.metadata ? JSON.stringify(a.metadata) : ''}</td>
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

/* ---------------- settings ---------------- */

interface FullSettings extends Record<string, unknown> {
  businessName: string; contactEmail: string; contactPhone: string; contactAddress: string; supportHours: string; currencyCode: string; currencyMinorDigits: number;
  taxRateBasisPoints: number; taxLabel: string; taxInclusive: boolean; deliveryFeeMinor: number; anydeskDownloadUrl: string; remoteConsentText: string; remoteConsentVersion: string;
  intakeTermsText: string; termsOfServiceText: string; privacyNoticeText: string; quotationDefaultValidDays: number; enabledPaymentMethods: PaymentMethod[];
  bankTransferInstructions: string; mobileMoneyInstructions: string;
}

export function SettingsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings', 'all'], queryFn: () => api<FullSettings>('/settings'), enabled: can('settings.manage') });
  const integrations = useQuery({ queryKey: ['integrations'], queryFn: () => api<{ email: { transport: string; configured: boolean; failedDeliveries: number }; sms: { configured: boolean }; whatsapp: { configured: boolean }; anydeskApi: { configured: boolean; baseUrl: string }; paymentGateway: { provider: string; configured: boolean } }>('/settings/integrations'), enabled: can('settings.manage') });
  const [f, setF] = useState<FullSettings | null>(null);
  const [taxPct, setTaxPct] = useState('0');
  const [fee, setFee] = useState('0');
  useEffect(() => {
    if (settings.data) {
      setF(settings.data);
      setTaxPct((settings.data.taxRateBasisPoints / 100).toString());
      setFee((settings.data.deliveryFeeMinor / 10 ** settings.data.currencyMinorDigits).toString());
    }
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () => {
      const { termsVersion: _tv, ...rest } = f as FullSettings & { termsVersion?: string };
      return api('/settings', { method: 'PATCH', body: { ...rest, taxRateBasisPoints: Math.round(Number(taxPct) * 100), deliveryFeeMinor: majorToMinor(fee, f!.currencyMinorDigits) } });
    },
    onSuccess: () => { toast.success('Settings saved'); void qc.invalidateQueries({ queryKey: ['settings'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const anydeskTest = useMutation({
    mutationFn: () => api<{ name: string; license: string }>('/remote-sessions/anydesk/status'),
    onSuccess: (r) => toast.success(`Connected to AnyDesk: ${r.name} (${r.license})`),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const set = <K extends keyof FullSettings>(k: K, v: FullSettings[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const originalConsent = settings.data?.remoteConsentText;
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" actions={f && <Button loading={save.isPending} onClick={() => save.mutate()}>Save settings</Button>} />
      {can('settings.manage') && f && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Business & contact">
              <div className="grid gap-3">
                <Input label="Business name" value={f.businessName} onChange={(e) => set('businessName', e.target.value)} />
                <Input label="Contact e-mail" value={f.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />
                <Input label="Contact phone" value={f.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} />
                <Input label="Address" value={f.contactAddress} onChange={(e) => set('contactAddress', e.target.value)} />
                <Input label="Support hours" value={f.supportHours} onChange={(e) => set('supportHours', e.target.value)} />
              </div>
            </Card>
            <Card title="Currency, tax & delivery">
              <Alert kind="warning">Set these for your operating market before taking real orders. Amounts already quoted keep the rate that applied when they were issued.</Alert>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Input label="Currency (ISO code)" value={f.currencyCode} maxLength={3} onChange={(e) => set('currencyCode', e.target.value.toUpperCase())} />
                <Input label="Decimal places" type="number" min={0} max={3} value={f.currencyMinorDigits} onChange={(e) => set('currencyMinorDigits', Number(e.target.value))} />
                <Input label="Tax rate (%)" inputMode="decimal" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} />
                <Input label="Tax label" value={f.taxLabel} onChange={(e) => set('taxLabel', e.target.value)} />
                <div className="sm:col-span-2"><Checkbox checked={f.taxInclusive} onChange={(e) => set('taxInclusive', e.target.checked)} label="Prices already include tax" /></div>
                <Input label="Delivery fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
                <Input label="Quotation validity (days)" type="number" min={1} value={f.quotationDefaultValidDays} onChange={(e) => set('quotationDefaultValidDays', Number(e.target.value))} />
              </div>
            </Card>
            <Card title="Payment methods">
              <div className="space-y-2">
                {PAYMENT_METHODS.filter((m) => m !== 'GATEWAY').map((m) => (
                  <Checkbox key={m} checked={f.enabledPaymentMethods.includes(m)} label={PAYMENT_METHOD_LABELS[m]}
                    onChange={(e) => set('enabledPaymentMethods', e.target.checked ? [...f.enabledPaymentMethods, m] : f.enabledPaymentMethods.filter((x) => x !== m))} />
                ))}
                <p className="text-xs text-slate-500">Online payment appears automatically when a gateway is configured on the server ({integrations.data?.paymentGateway.configured ? `active: ${integrations.data.paymentGateway.provider}` : 'none configured'}).</p>
              </div>
              <Textarea className="mt-3" label="Bank transfer instructions" rows={3} value={f.bankTransferInstructions} onChange={(e) => set('bankTransferInstructions', e.target.value)} />
              <Textarea className="mt-3" label="Mobile money instructions" rows={3} value={f.mobileMoneyInstructions} onChange={(e) => set('mobileMoneyInstructions', e.target.value)} />
            </Card>
            <Card title="Remote support (AnyDesk)">
              <Input label="AnyDesk download URL" value={f.anydeskDownloadUrl} onChange={(e) => set('anydeskDownloadUrl', e.target.value)} hint="Shown to customers. Keep it pointing at AnyDesk's official site." />
              <Textarea className="mt-3" label="Remote access consent text" rows={6} value={f.remoteConsentText} onChange={(e) => set('remoteConsentText', e.target.value)} />
              <Input className="mt-3" label="Consent version" value={f.remoteConsentVersion} onChange={(e) => set('remoteConsentVersion', e.target.value)} hint="Change the version whenever you change the text, so each recorded consent refers to the exact wording." />
              {originalConsent !== f.remoteConsentText && f.remoteConsentVersion === settings.data?.remoteConsentVersion && <div className="mt-2"><Alert kind="warning">You changed the consent text — give it a new version.</Alert></div>}
              <div className="mt-4 flex items-center gap-3 text-sm">
                REST API: {integrations.data?.anydeskApi.configured ? <Badge color="green">Configured</Badge> : <Badge color="slate">Not configured — manual workflow</Badge>}
                {integrations.data?.anydeskApi.configured && <Button size="sm" variant="secondary" loading={anydeskTest.isPending} onClick={() => anydeskTest.mutate()}>Test connection</Button>}
              </div>
            </Card>
          </div>
          <Card title="Legal texts">
            <Alert kind="info">These are placeholders until you replace them with your own wording. The platform makes no legal or compliance claims of its own.</Alert>
            <div className="mt-3 grid gap-4 lg:grid-cols-3">
              <Textarea label="Device handover terms" rows={8} value={f.intakeTermsText} onChange={(e) => set('intakeTermsText', e.target.value)} />
              <Textarea label="Terms of service" rows={8} value={f.termsOfServiceText} onChange={(e) => set('termsOfServiceText', e.target.value)} />
              <Textarea label="Privacy notice" rows={8} value={f.privacyNoticeText} onChange={(e) => set('privacyNoticeText', e.target.value)} />
            </div>
          </Card>
          {integrations.data && (
            <Card title="Integrations status">
              <DescriptionList items={[
                { label: 'E-mail', value: <>{integrations.data.email.configured ? <Badge color="green">{integrations.data.email.transport === 'log' ? 'Log only (development)' : 'SMTP'}</Badge> : <Badge color="red">Not configured</Badge>}{integrations.data.email.failedDeliveries > 0 && <span className="ml-2 text-rose-600">{integrations.data.email.failedDeliveries} failed deliveries</span>}</> },
                { label: 'SMS', value: integrations.data.sms.configured ? <Badge color="green">Configured</Badge> : <Badge color="slate">Not configured (optional)</Badge> },
                { label: 'WhatsApp', value: integrations.data.whatsapp.configured ? <Badge color="green">Configured</Badge> : <Badge color="slate">Not configured (optional)</Badge> },
                { label: 'Payment gateway', value: integrations.data.paymentGateway.configured ? <Badge color="green">{integrations.data.paymentGateway.provider}</Badge> : <Badge color="slate">None — offline methods only</Badge> },
              ]} />
              <p className="mt-3 text-xs text-slate-500">Credentials are set in the server environment, never in this page. See docs/06_INTEGRATIONS.md.</p>
            </Card>
          )}
        </>
      )}
      {can('categories.manage') && <CategoriesCard />}
    </div>
  );
}

function CategoriesCard() {
  const toast = useToast();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Partial<ServiceCategory> | null>(null);
  const cats = useQuery({ queryKey: ['service-categories', 'all'], queryFn: () => api<ServiceCategory[]>('/settings/service-categories', { query: { all: 'true' } }) });
  const save = useMutation({
    mutationFn: () => api(edit!.id ? `/settings/service-categories/${edit!.id}` : '/settings/service-categories', {
      method: edit!.id ? 'PUT' : 'POST',
      body: { name: edit!.name, description: edit!.description || undefined, defaultServiceType: edit!.defaultServiceType || undefined, icon: edit!.icon || undefined, sortOrder: edit!.sortOrder ?? 100, active: edit!.isActive ?? true },
    }),
    onSuccess: () => { toast.success('Category saved'); setEdit(null); void qc.invalidateQueries({ queryKey: ['service-categories'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card title="Support categories" actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit({ isActive: true, sortOrder: 200 })}>Add category</Button>} padded={false}>
      <QueryState query={cats}>
        {(list) => (
          <Table head={['Category', 'Default service', 'Order', 'Status', '']}>
            {list.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-3"><p className="font-medium">{c.name}</p><p className="text-xs text-slate-500">{c.description}</p></td>
                <td className="px-4 py-3 text-sm">{c.defaultServiceType ? SERVICE_TYPE_LABELS[c.defaultServiceType] : '—'}</td>
                <td className="px-4 py-3 text-sm">{c.sortOrder}</td>
                <td className="px-4 py-3">{c.isActive ? <Badge color="green">Active</Badge> : <Badge color="slate">Hidden</Badge>}</td>
                <td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => setEdit(c)}>Edit</Button></td>
              </tr>
            ))}
          </Table>
        )}
      </QueryState>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit category' : 'New category'} footer={<Button loading={save.isPending} disabled={!edit?.name?.trim()} onClick={() => save.mutate()}>Save</Button>}>
        {edit && (
          <div className="grid gap-3">
            <Input label="Name" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <Textarea label="Description" rows={2} value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            <Select label="Default service type" placeholder="None" value={edit.defaultServiceType ?? ''} onChange={(e) => setEdit({ ...edit, defaultServiceType: (e.target.value || null) as ServiceType | null })} options={Object.values(SERVICE_TYPES).map((t) => ({ value: t, label: SERVICE_TYPE_LABELS[t] }))} />
            <Select label="Icon" value={edit.icon ?? 'help'} onChange={(e) => setEdit({ ...edit, icon: e.target.value })} options={['mail', 'download', 'monitor', 'gauge', 'wifi', 'printer', 'users', 'settings', 'shield', 'wrench', 'help'].map((i) => ({ value: i, label: i }))} />
            <Input label="Sort order" type="number" value={edit.sortOrder ?? 100} onChange={(e) => setEdit({ ...edit, sortOrder: Number(e.target.value) })} />
            <Checkbox checked={edit.isActive ?? true} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} label="Offered to customers" />
          </div>
        )}
      </Modal>
    </Card>
  );
}
