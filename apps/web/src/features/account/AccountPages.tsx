import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Bell, Headset, History, Laptop, Package, Plus, UserPlus } from 'lucide-react';
import { addressSchema, changePasswordSchema, DEVICE_TYPE_LABELS, DEVICE_TYPES, deviceSchema, inviteMemberSchema, PAYMENT_METHOD_LABELS, REQUEST_STATUS_LABELS, type AuthTokens } from '@dante/shared';
import { api, apiPage, setAccessToken } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { applyServerErrors } from '../../lib/forms';
import { fmtDate, fmtDateTime, humanize, timeAgo } from '../../lib/format';
import { useMoney } from '../../lib/settings';
import type { Address, Device, NotificationItem, OrderSummary, Payment, RequestSummary } from '../../lib/types';
import { useToast } from '../../components/toast';
import {
  Alert, Badge, Button, ButtonLink, Card, EmptyState, Input, Modal, OrderStatusBadge, PageHeader, Pagination, QueryState, RequestStatusBadge, Select, Stat, Table, errorMessage,
} from '../../components/ui';

/* ---------------- overview ---------------- */

export function OverviewPage() {
  const { user } = useAuth();
  const money = useMoney();
  const open = useQuery({ queryKey: ['requests', 'mine', 'open', 1], queryFn: () => apiPage<RequestSummary>('/requests', { query: { statusGroup: 'open', pageSize: 5 } }) });
  const orders = useQuery({ queryKey: ['orders', 'mine', 1], queryFn: () => apiPage<OrderSummary>('/orders', { query: { pageSize: 3 } }) });
  const needsMe = open.data?.items.filter((r) => ['AWAITING_CUSTOMER', 'AWAITING_QUOTATION_APPROVAL', 'AWAITING_PAYMENT', 'READY_FOR_COLLECTION'].includes(r.status)) ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title={`Hello, ${user?.firstName}`} subtitle={user?.organization ? `${user.organization.name} · ${user.organization.orgRole === 'ORG_ADMIN' ? 'Organisation administrator' : 'Member'}` : 'Your ICT support account'}
        actions={<><ButtonLink to="/support/new" icon={<Plus className="size-4" />}>Request support</ButtonLink><ButtonLink to="/shop" variant="secondary">Shop</ButtonLink></>} />
      {needsMe.length > 0 && (
        <Alert kind="warning" title="Waiting for you">
          <ul className="mt-1 space-y-0.5">{needsMe.map((r) => <li key={r.id}><Link className="link" to={`/account/requests/${r.id}`}>{r.reference} — {r.title}</Link>: {REQUEST_STATUS_LABELS[r.status].toLowerCase()}</li>)}</ul>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Open requests" value={open.data?.meta.total ?? '—'} to="/account/requests" />
        <Stat label="Need your action" value={needsMe.length} tone={needsMe.length ? 'amber' : 'slate'} />
        <Stat label="Orders" value={orders.data?.meta.total ?? '—'} to="/account/orders" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Open requests" actions={<Link className="link text-sm" to="/account/requests">View all</Link>} padded={false}>
          <QueryState query={open}>
            {(d) => d.items.length === 0 ? <EmptyState title="No open requests" icon={<Headset className="size-6" />} /> : (
              <ul className="divide-y divide-ink-100">{d.items.map((r) => (
                <li key={r.id}><Link to={`/account/requests/${r.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-ink-50/70"><span className="min-w-0"><span className="block truncate font-medium">{r.title}</span><span className="text-xs text-slate-500">{r.reference}</span></span><RequestStatusBadge status={r.status} /></Link></li>
              ))}</ul>
            )}
          </QueryState>
        </Card>
        <Card title="Recent orders" actions={<Link className="link text-sm" to="/account/orders">View all</Link>} padded={false}>
          <QueryState query={orders}>
            {(d) => d.items.length === 0 ? <EmptyState title="No orders yet" icon={<Package className="size-6" />} /> : (
              <ul className="divide-y divide-ink-100">{d.items.map((o) => (
                <li key={o.id}><Link to={`/account/orders/${o.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-ink-50/70"><span><span className="block font-medium">{o.reference}</span><span className="text-xs text-slate-500">{fmtDate(o.placedAt)} · {money(o.totalMinor)}</span></span><OrderStatusBadge status={o.status} /></Link></li>
              ))}</ul>
            )}
          </QueryState>
        </Card>
      </div>
    </div>
  );
}

/* ---------------- devices ---------------- */

export function DevicesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [historyFor, setHistoryFor] = useState<Device | null>(null);
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api<Device[]>('/account/devices') });
  const history = useQuery({
    queryKey: ['device-history', historyFor?.id], enabled: !!historyFor,
    queryFn: () => api<{ id: number; reference: string; title: string; status: keyof typeof REQUEST_STATUS_LABELS; submittedAt: string; outcome: string | null }[]>(`/account/devices/${historyFor!.id}/history`),
  });
  const form = useForm<z.input<typeof deviceSchema>>({ resolver: zodResolver(deviceSchema), defaultValues: { deviceType: 'LAPTOP' } });
  const create = form.handleSubmit(async (v) => {
    try {
      await api('/account/devices', { body: v });
      toast.success('Device registered');
      form.reset({ deviceType: 'LAPTOP' });
      setAdding(false);
      void qc.invalidateQueries({ queryKey: ['devices'] });
    } catch (e) {
      toast.error(applyServerErrors(e, form.setError));
    }
  });
  return (
    <div>
      <PageHeader title="Devices" subtitle={user?.organization ? 'Your devices and your organisation’s shared equipment' : 'Equipment we have helped you with'} actions={<Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add device</Button>} />
      <Card padded={false}>
        <QueryState query={devices}>
          {(list) => list.length === 0 ? <EmptyState title="No devices yet" icon={<Laptop className="size-6" />}>Devices are added automatically when you report a problem, or you can add them here.</EmptyState> : (
            <Table head={['Device', 'Serial / asset', 'Location', '']}>
              {list.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-3"><p className="font-medium">{[d.manufacturer, d.model].filter(Boolean).join(' ') || 'Unnamed device'}</p><p className="text-xs text-slate-500">{DEVICE_TYPE_LABELS[d.deviceType as keyof typeof DEVICE_TYPE_LABELS]}{d.operatingSystem ? ` · ${d.operatingSystem}` : ''}{d.organizationId ? ' · shared' : ''}</p></td>
                  <td className="px-4 py-3 text-sm">{d.serialNumber ?? '—'}{d.assetTag ? <span className="block text-xs text-slate-500">{d.assetTag}</span> : null}</td>
                  <td className="px-4 py-3 text-sm">{[d.department, d.location].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" icon={<History className="size-4" />} onClick={() => setHistoryFor(d)}>History</Button></td>
                </tr>
              ))}
            </Table>
          )}
        </QueryState>
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title="Add a device" footer={<><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button><Button loading={form.formState.isSubmitting} onClick={() => void create()}>Save device</Button></>}>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={create}>
          <Select label="Type" options={DEVICE_TYPES.map((t) => ({ value: t, label: DEVICE_TYPE_LABELS[t] }))} {...form.register('deviceType')} />
          <Input label="Manufacturer" {...form.register('manufacturer')} />
          <Input label="Model" {...form.register('model')} />
          <Input label="Operating system" {...form.register('operatingSystem')} />
          <Input label="Serial number" {...form.register('serialNumber')} />
          <Input label="Asset tag" {...form.register('assetTag')} />
          {user?.organization && <><Input label="Department" {...form.register('department')} /><Input label="Location" {...form.register('location')} /></>}
        </form>
      </Modal>
      <Modal open={!!historyFor} onClose={() => setHistoryFor(null)} title="Service history">
        <QueryState query={history}>
          {(h) => h.length === 0 ? <p className="text-sm text-slate-500">No requests for this device yet.</p> : (
            <ul className="divide-y divide-ink-100 text-sm">{h.map((x) => <li key={x.id} className="flex items-center justify-between gap-3 py-2"><Link className="link" to={`/account/requests/${x.id}`}>{x.reference} — {x.title}</Link><span className="text-xs text-slate-500">{fmtDate(x.submittedAt)}{x.outcome ? ` · ${humanize(x.outcome)}` : ''}</span></li>)}</ul>
          )}
        </QueryState>
      </Modal>
    </div>
  );
}

/* ---------------- organisation ---------------- */

interface Org {
  id: number; name: string; registrationNo: string | null; billingEmail: string | null; phone: string | null; address: string | null; centralBilling: boolean;
  myRole: 'ORG_ADMIN' | 'ORG_MEMBER'; stats: { openRequests: number; totalRequests: number };
  members?: { id: number; email: string; firstName: string; lastName: string; orgRole: 'ORG_ADMIN' | 'ORG_MEMBER'; department: string | null; location: string | null; isActive: boolean; invitePending: boolean }[];
}

export function OrganizationPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [inviting, setInviting] = useState(false);
  const org = useQuery({ queryKey: ['organization'], queryFn: () => api<Org>('/organizations/mine') });
  const invite = useForm<z.input<typeof inviteMemberSchema>>({ resolver: zodResolver(inviteMemberSchema), defaultValues: { orgRole: 'ORG_MEMBER' } });
  const updateMember = useMutation({
    mutationFn: ({ id, ...body }: { id: number; orgRole?: string; active?: boolean }) => api(`/organizations/mine/members/${id}`, { method: 'PATCH', body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['organization'] }); toast.success('Member updated'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const sendInvite = invite.handleSubmit(async (v) => {
    try {
      await api('/organizations/mine/members', { body: v });
      toast.success(`Invitation sent to ${v.email}`);
      invite.reset({ orgRole: 'ORG_MEMBER' });
      setInviting(false);
      void qc.invalidateQueries({ queryKey: ['organization'] });
    } catch (e) {
      toast.error(applyServerErrors(e, invite.setError));
    }
  });
  return (
    <QueryState query={org}>
      {(o) => (
        <div className="space-y-6">
          <PageHeader title={o.name} subtitle={`${o.myRole === 'ORG_ADMIN' ? 'You administer this organisation' : 'Member'}${o.centralBilling ? ' · centralised billing' : ''}`}
            actions={o.myRole === 'ORG_ADMIN' && <Button icon={<UserPlus className="size-4" />} onClick={() => setInviting(true)}>Invite employee</Button>} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Open requests" value={o.stats.openRequests} to="/account/requests" />
            <Stat label="All requests" value={o.stats.totalRequests} />
            <Stat label="Members" value={o.members?.filter((m) => m.isActive).length ?? '—'} />
          </div>
          {o.members && (
            <Card title="Employees" padded={false}>
              <Table head={['Name', 'Department', 'Role', 'Status', '']}>
                {o.members.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-3"><p className="font-medium">{m.firstName} {m.lastName}</p><p className="text-xs text-slate-500">{m.email}</p></td>
                    <td className="px-4 py-3 text-sm">{[m.department, m.location].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="px-4 py-3"><Badge color={m.orgRole === 'ORG_ADMIN' ? 'teal' : 'slate'}>{m.orgRole === 'ORG_ADMIN' ? 'Administrator' : 'Member'}</Badge></td>
                    <td className="px-4 py-3">{m.invitePending ? <Badge color="amber">Invitation pending</Badge> : m.isActive ? <Badge color="green">Active</Badge> : <Badge color="red">Deactivated</Badge>}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => updateMember.mutate({ id: m.id, orgRole: m.orgRole === 'ORG_ADMIN' ? 'ORG_MEMBER' : 'ORG_ADMIN' })}>{m.orgRole === 'ORG_ADMIN' ? 'Make member' : 'Make admin'}</Button>
                      <Button size="sm" variant="ghost" onClick={() => updateMember.mutate({ id: m.id, active: !m.isActive })}>{m.isActive ? 'Deactivate' : 'Reactivate'}</Button>
                    </td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
          <Modal open={inviting} onClose={() => setInviting(false)} title="Invite an employee"
            footer={<><Button variant="secondary" onClick={() => setInviting(false)}>Cancel</Button><Button loading={invite.formState.isSubmitting} onClick={() => void sendInvite()}>Send invitation</Button></>}>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={sendInvite}>
              <Input label="First name" error={invite.formState.errors.firstName?.message} {...invite.register('firstName')} />
              <Input label="Last name" error={invite.formState.errors.lastName?.message} {...invite.register('lastName')} />
              <div className="sm:col-span-2"><Input label="Work e-mail" type="email" error={invite.formState.errors.email?.message} {...invite.register('email')} /></div>
              <Input label="Department" {...invite.register('department')} />
              <Input label="Location" {...invite.register('location')} />
              <Select label="Role" options={[{ value: 'ORG_MEMBER', label: 'Member — own requests' }, { value: 'ORG_ADMIN', label: 'Administrator — all organisation requests' }]} {...invite.register('orgRole')} />
            </form>
            <p className="mt-3 text-xs text-slate-500">They receive an e-mail with a one-time link (valid 7 days) to set their own password.</p>
          </Modal>
        </div>
      )}
    </QueryState>
  );
}

/* ---------------- profile & security ---------------- */

export function ProfilePage() {
  const { user, reload, isCustomer } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [profile, setProfile] = useState({ firstName: user?.firstName ?? '', lastName: user?.lastName ?? '', phone: user?.phone ?? '' });
  const pw = useForm<z.input<typeof changePasswordSchema>>({ resolver: zodResolver(changePasswordSchema) });
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: () => api<Address[]>('/account/addresses'), enabled: isCustomer });
  const addrForm = useForm<z.input<typeof addressSchema>>({ resolver: zodResolver(addressSchema) });
  const saveProfile = useMutation({
    mutationFn: () => api('/account/profile', { method: 'PATCH', body: { firstName: profile.firstName, lastName: profile.lastName, phone: profile.phone || undefined } }),
    onSuccess: async () => { await reload(); toast.success('Profile saved'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const changePw = pw.handleSubmit(async (v) => {
    try {
      const r = await api<{ tokens: AuthTokens }>('/auth/change-password', { body: v });
      setAccessToken(r.tokens.accessToken);
      await reload();
      pw.reset();
      toast.success('Password changed. Other devices have been signed out.');
      if (params.get('mustChange')) navigate(user?.accountType === 'STAFF' ? '/staff' : '/account');
    } catch (e) {
      toast.error(applyServerErrors(e, pw.setError));
    }
  });
  const addAddress = addrForm.handleSubmit(async (v) => {
    try {
      await api('/account/addresses', { body: v });
      addrForm.reset();
      void qc.invalidateQueries({ queryKey: ['addresses'] });
    } catch (e) {
      toast.error(applyServerErrors(e, addrForm.setError));
    }
  });
  const removeAddress = useMutation({ mutationFn: (id: number) => api(`/account/addresses/${id}`, { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['addresses'] }) });
  return (
    <div className="space-y-6">
      <PageHeader title="Profile & security" subtitle={user?.email} />
      {params.get('mustChange') && <Alert kind="warning">Please choose a new password before continuing.</Alert>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Your details">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveProfile.mutate(); }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="First name" value={profile.firstName} onChange={(e) => setProfile({ ...profile, firstName: e.target.value })} />
              <Input label="Last name" value={profile.lastName} onChange={(e) => setProfile({ ...profile, lastName: e.target.value })} />
            </div>
            <Input label="Telephone" type="tel" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
            <Button type="submit" loading={saveProfile.isPending}>Save</Button>
          </form>
        </Card>
        <Card title="Change password">
          <form className="space-y-3" onSubmit={changePw} noValidate>
            <Input label="Current password" type="password" autoComplete="current-password" error={pw.formState.errors.currentPassword?.message} {...pw.register('currentPassword')} />
            <Input label="New password" type="password" autoComplete="new-password" error={pw.formState.errors.newPassword?.message} {...pw.register('newPassword')} />
            <Button type="submit" loading={pw.formState.isSubmitting}>Change password</Button>
          </form>
        </Card>
      </div>
      {isCustomer && (
        <Card title="Delivery addresses">
          <QueryState query={addresses}>
            {(list) => (
              <ul className="mb-4 space-y-2 text-sm">
                {list.length === 0 && <li className="text-slate-500">No saved addresses.</li>}
                {list.map((a) => <li key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-ink-100 px-3 py-2"><span><strong>{a.label}</strong>{a.isDefault && <Badge color="teal" className="ml-2">Default</Badge>} — {a.line1}, {a.city}, {a.country}</span><button className="text-rose-600 hover:underline" onClick={() => removeAddress.mutate(a.id)}>Remove</button></li>)}
              </ul>
            )}
          </QueryState>
          <form className="grid gap-3 sm:grid-cols-4" onSubmit={addAddress} noValidate>
            <Input label="Label" error={addrForm.formState.errors.label?.message} {...addrForm.register('label')} />
            <Input label="Street" error={addrForm.formState.errors.line1?.message} {...addrForm.register('line1')} />
            <Input label="City" error={addrForm.formState.errors.city?.message} {...addrForm.register('city')} />
            <Input label="Country" error={addrForm.formState.errors.country?.message} {...addrForm.register('country')} />
            <div className="sm:col-span-4"><Button type="submit" variant="secondary" size="sm" loading={addrForm.formState.isSubmitting}>Add address</Button></div>
          </form>
        </Card>
      )}
    </div>
  );
}

/* ---------------- payments ---------------- */

export function MyPaymentsPage() {
  const money = useMoney();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['payments', 'mine', page], queryFn: () => apiPage<Payment>('/payments', { query: { page } }) });
  return (
    <div>
      <PageHeader title="Payments" subtitle="Your payment records for services and purchases" />
      <Card padded={false}>
        <QueryState query={q}>
          {(d) => d.items.length === 0 ? <EmptyState title="No payments yet" /> : (
            <>
              <Table head={['Reference', 'For', 'Method', 'Amount', 'Status', 'Date']}>
                {d.items.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-medium">{p.reference}</td>
                    <td className="px-4 py-3 text-sm"><Link className="link" to={p.payableType === 'SALES_ORDER' ? `/account/orders/${p.payableId}` : `/account/requests/${p.payableId}`}>{p.payableReference}</Link></td>
                    <td className="px-4 py-3 text-sm">{PAYMENT_METHOD_LABELS[p.method]}</td>
                    <td className="px-4 py-3 text-sm font-semibold">{money(p.amountMinor)}</td>
                    <td className="px-4 py-3"><Badge color={p.status === 'SUCCEEDED' ? 'green' : p.status === 'PENDING' ? 'amber' : 'slate'}>{humanize(p.status)}</Badge></td>
                    <td className="px-4 py-3 text-sm text-slate-500">{fmtDate(p.succeededAt ?? p.createdAt)}</td>
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

/* ---------------- notifications ---------------- */

export function NotificationsPage() {
  const qc = useQueryClient();
  const { isStaff } = useAuth();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ items: NotificationItem[]; unreadCount: number }>('/notifications') });
  const mark = useMutation({
    mutationFn: (body: { ids?: number[]; all?: boolean }) => api('/notifications/read', { body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  return (
    <div>
      <PageHeader title="Notifications" actions={!!q.data?.unreadCount && <Button variant="secondary" size="sm" onClick={() => mark.mutate({ all: true })}>Mark all as read</Button>} />
      <Card padded={false}>
        <QueryState query={q}>
          {(d) => d.items.length === 0 ? <EmptyState title="You're all caught up" icon={<Bell className="size-6" />} /> : (
            <ul className="divide-y divide-ink-100">
              {d.items.map((n) => {
                const link = n.link && isStaff ? n.link.replace(/^\/account\//, '/staff/') : n.link;
                return (
                  <li key={n.id} className={n.readAt ? '' : 'bg-brand-50/50'}>
                    <Link to={link ?? '#'} onClick={() => !n.readAt && mark.mutate({ ids: [n.id] })} className="block px-5 py-3.5 hover:bg-ink-50/70">
                      <p className="flex items-center gap-2 text-sm font-semibold">{!n.readAt && <span className="size-2 rounded-full bg-brand-600" aria-label="Unread" />}{n.title}</p>
                      <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>
                      <p className="mt-1 text-xs text-slate-400">{timeAgo(n.createdAt)} · {fmtDateTime(n.createdAt)}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </QueryState>
      </Card>
    </div>
  );
}
