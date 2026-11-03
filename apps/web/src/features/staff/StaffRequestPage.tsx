import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, MonitorSmartphone, PlugZap, Plus, RefreshCw, Trash2, Wrench } from 'lucide-react';
import { DEVICE_TYPE_LABELS, QUOTATION_ITEM_TYPES, REQUEST_STATUS_LABELS_STAFF, SERVICE_TYPE_LABELS, SERVICE_TYPES, computeTotals, type QuotationItemType, type RequestStatus } from '@dante/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDateTime, humanize } from '../../lib/format';
import { majorToMinor, useMoney, useSettings } from '../../lib/settings';
import type { Product, RemoteSession, RequestDetail, ServiceCategory } from '../../lib/types';
import { useToast } from '../../components/toast';
import { Alert, Badge, Button, Card, Checkbox, DescriptionList, Input, Modal, PageHeader, QueryState, RequestStatusBadge, Select, Textarea, errorMessage } from '../../components/ui';
import { AttachmentList, AttachmentUploader } from '../support/attachments';
import { MessagesPanel, PaymentList, QuotationView, ReportView, Timeline } from '../support/components';
import { RecordPaymentButton } from './RecordPayment';
import type { Technician } from './StaffPages';

export function StaffRequestPage() {
  const id = Number(useParams().id);
  const q = useQuery({ queryKey: ['request', id], queryFn: () => api<RequestDetail>(`/requests/${id}`), refetchInterval: 20_000 });
  return (
    <QueryState query={q}>
      {(r) => <Workspace r={r} refetch={() => void q.refetch()} />}
    </QueryState>
  );
}

function Workspace({ r, refetch }: { r: RequestDetail; refetch: () => void }) {
  const closed = ['CLOSED', 'CANCELLED'].includes(r.status);
  const hardware = r.serviceType === 'HARDWARE_REPAIR' || r.serviceType === 'ONSITE_SUPPORT';
  const [tab, setTab] = useState<'work' | 'conversation' | 'notes'>('work');
  return (
    <div className="space-y-6">
      <PageHeader back={{ to: '/staff/requests', label: 'Requests' }} title={r.title}
        subtitle={<>{r.reference} · {SERVICE_TYPE_LABELS[r.serviceType]} · {r.category.name} · submitted {fmtDateTime(r.dates.submittedAt)}</>}
        actions={<><Badge color={r.urgency === 'CRITICAL' ? 'red' : r.urgency === 'HIGH' ? 'amber' : 'slate'}>{humanize(r.urgency)}</Badge><RequestStatusBadge staff status={r.status} /></>} />
      {!closed && <ControlBar r={r} onChange={refetch} />}
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <div className="flex gap-2" role="tablist">
            {(['work', 'conversation', ...(r.permissions.canViewInternalNotes ? ['notes'] as const : [])] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-xl px-3.5 py-1.5 text-sm font-medium ${tab === t ? 'bg-ink-900 text-white' : 'bg-white text-slate-600'}`}>
                {{ work: 'Work', conversation: 'Customer conversation', notes: 'Internal notes' }[t]}
              </button>
            ))}
          </div>
          {tab === 'work' && (
            <>
              <RemoteConsole r={r} onChange={refetch} />
              {hardware && <IntakeCard r={r} onChange={refetch} />}
              <DiagnosisAndWork r={r} onChange={refetch} />
              <QuotationsCard r={r} onChange={refetch} />
              {(r.parts.length > 0 || hardware) && <PartsCard r={r} onChange={refetch} />}
              <ReportCard r={r} onChange={refetch} />
            </>
          )}
          {tab === 'conversation' && <Card title="Messages with the customer"><MessagesPanel requestId={r.id} closed={closed} mine="staff" /></Card>}
          {tab === 'notes' && <NotesCard requestId={r.id} />}
        </div>
        <div className="space-y-6">
          <Card title="Customer & device">
            <DescriptionList items={[
              { label: 'Customer', value: <>{r.customer?.name}{r.organization && <span className="block text-xs text-slate-500">{r.organization.name}</span>}</> },
              { label: 'Contact', value: <>{r.contact.name}<span className="block text-xs">{r.contact.phone} · {r.contact.email}</span></> },
              { label: 'Prefers', value: humanize(r.preferredContact) },
              { label: 'Department / location', value: [r.contact.department, r.contact.location].filter(Boolean).join(' · ') || '—' },
              { label: 'Device', value: r.device ? <>{DEVICE_TYPE_LABELS[r.device.deviceType as keyof typeof DEVICE_TYPE_LABELS]} {[r.device.manufacturer, r.device.model].filter(Boolean).join(' ')}<span className="block text-xs">{[r.device.operatingSystem, r.device.serialNumber && `S/N ${r.device.serialNumber}`, r.device.assetTag].filter(Boolean).join(' · ')}</span></> : 'Not specified' },
              ...(r.siteAddress ? [{ label: 'Site', value: <>{r.siteAddress}{r.preferredVisitDate && <span className="block text-xs">Preferred {r.preferredVisitDate}</span>}</> }] : []),
              { label: 'Technician', value: r.technician?.name ?? 'Unassigned' },
            ]} />
            <p className="mt-4 text-xs font-semibold tracking-wide text-slate-500 uppercase">Problem</p>
            <p className="mt-1 text-sm whitespace-pre-line">{r.description}</p>
            {r.errorMessages && <pre className="mt-2 overflow-x-auto rounded-lg bg-ink-50 p-2 text-xs whitespace-pre-wrap">{r.errorMessages}</pre>}
          </Card>
          <Card title="Charges & payments">
            <DescriptionList items={[
              { label: 'Approved', value: <Money v={r.balance.dueMinor} /> },
              { label: 'Paid', value: <Money v={r.balance.paidMinor} /> },
              { label: 'Outstanding', value: <span className={r.balance.outstandingMinor ? 'font-semibold text-amber-700' : ''}><Money v={r.balance.outstandingMinor} /></span> },
            ]} />
            <div className="mt-3"><PaymentList payments={r.payments} /></div>
            <PaymentAction r={r} onChange={refetch} />
          </Card>
          <Card title="Files" actions={!closed && (
            <div className="flex flex-wrap gap-2">
              <AttachmentUploader requestId={r.id} onDone={refetch} label="Shared file" />
              <AttachmentUploader requestId={r.id} context="INTERNAL" onDone={refetch} label="Internal file" />
            </div>
          )}>
            <AttachmentList items={r.attachments} />
          </Card>
          <Card title="Timeline"><Timeline items={r.timeline} staff /></Card>
        </div>
      </div>
    </div>
  );
}

function Money({ v }: { v: number }) {
  const money = useMoney();
  return <>{money(v)}</>;
}

function PaymentAction({ r, onChange }: { r: RequestDetail; onChange: () => void }) {
  const { can } = useAuth();
  if (!can('payments.record') || r.balance.outstandingMinor <= 0 || r.status === 'CANCELLED') return null;
  return <div className="mt-3"><RecordPaymentButton payableType="SUPPORT_REQUEST" payableId={r.id} outstandingMinor={r.balance.outstandingMinor} onDone={onChange} /></div>;
}

/* ---------------- triage, assignment, status ---------------- */

function ControlBar({ r, onChange }: { r: RequestDetail; onChange: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState<RequestStatus | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const reviewable = r.permissions.canManage && ['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_CUSTOMER'].includes(r.status) && !r.dates.acceptedAt;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        {reviewable && <Button variant="accent" onClick={() => setReviewOpen(true)}>Review request</Button>}
        {r.permissions.canAssign && !['SUBMITTED', 'UNDER_REVIEW'].includes(r.status) && <Button variant={r.technician ? 'secondary' : 'accent'} onClick={() => setAssignOpen(true)}>{r.technician ? 'Reassign' : 'Assign technician'}</Button>}
        {r.permissions.nextStatuses.filter((s) => !(reviewable && ['UNDER_REVIEW', 'ACCEPTED', 'AWAITING_CUSTOMER'].includes(s))).map((s) => (
          <Button key={s} size="sm" variant={s === 'CANCELLED' ? 'ghost' : 'secondary'} className={s === 'CANCELLED' ? 'text-rose-600' : ''} onClick={() => setStatusOpen(s)}>
            {s === 'CANCELLED' ? 'Cancel request' : `→ ${REQUEST_STATUS_LABELS_STAFF[s]}`}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setUpdateOpen(true)}>Post update</Button>
      </div>
      {reviewOpen && <ReviewDialog r={r} onClose={() => setReviewOpen(false)} onDone={onChange} />}
      {assignOpen && can('requests.assign') && <AssignDialog r={r} onClose={() => setAssignOpen(false)} onDone={onChange} />}
      {statusOpen && <StatusDialog r={r} to={statusOpen} onClose={() => setStatusOpen(null)} onDone={() => { toast.success('Status updated'); onChange(); }} />}
      {updateOpen && <UpdateDialog r={r} onClose={() => setUpdateOpen(false)} onDone={onChange} />}
    </Card>
  );
}

function ReviewDialog({ r, onClose, onDone }: { r: RequestDetail; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const cats = useQuery({ queryKey: ['service-categories'], queryFn: () => api<ServiceCategory[]>('/settings/service-categories') });
  const [categoryId, setCategoryId] = useState(String(r.category.id));
  const [serviceType, setServiceType] = useState<string>(r.serviceType);
  const [urgency, setUrgency] = useState(r.urgency);
  const [message, setMessage] = useState('');
  const go = useMutation({
    mutationFn: (decision: 'ACCEPT' | 'REQUEST_INFO' | 'REJECT') => api(`/requests/${r.id}/review`, { body: { decision, categoryId: Number(categoryId), serviceType, urgency, message: message || undefined } }),
    onSuccess: () => { toast.success('Review recorded'); onClose(); onDone(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={`Review ${r.reference}`}
      footer={<>
        <Button variant="ghost" className="text-rose-600" loading={go.isPending && go.variables === 'REJECT'} disabled={!message} onClick={() => go.mutate('REJECT')}>Decline</Button>
        <Button variant="secondary" loading={go.isPending && go.variables === 'REQUEST_INFO'} disabled={!message} onClick={() => go.mutate('REQUEST_INFO')}>Ask customer</Button>
        <Button variant="accent" loading={go.isPending && go.variables === 'ACCEPT'} onClick={() => go.mutate('ACCEPT')}>Accept</Button>
      </>}>
      <div className="space-y-3">
        <Select label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} options={(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <Select label="Service type" value={serviceType} onChange={(e) => setServiceType(e.target.value)} options={Object.values(SERVICE_TYPES).map((t) => ({ value: t, label: SERVICE_TYPE_LABELS[t] }))} />
        <Select label="Urgency" value={urgency} onChange={(e) => setUrgency(e.target.value)} options={['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].map((u) => ({ value: u, label: humanize(u) }))} />
        <Textarea label="Message to the customer" hint="Required when asking for information or declining" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>
    </Modal>
  );
}

function AssignDialog({ r, onClose, onDone }: { r: RequestDetail; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const techs = useQuery({ queryKey: ['technicians'], queryFn: () => api<Technician[]>('/staff/technicians') });
  const [tech, setTech] = useState<number | null>(r.technician?.id ?? null);
  const [note, setNote] = useState('');
  const go = useMutation({
    mutationFn: () => api(`/requests/${r.id}/assign`, { body: { technicianUserId: tech, note: note || undefined } }),
    onSuccess: () => { toast.success('Technician assigned'); onClose(); onDone(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title="Assign a technician" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!tech} loading={go.isPending} onClick={() => go.mutate()}>Assign</Button></>}>
      <ul className="space-y-2">
        {techs.data?.map((t) => (
          <li key={t.userId}>
            <label className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 ${tech === t.userId ? 'border-brand-500 bg-brand-50' : 'border-ink-100'}`}>
              <span className="flex items-center gap-3">
                <input type="radio" name="tech" checked={tech === t.userId} onChange={() => setTech(t.userId)} className="accent-brand-600" />
                <span><span className="block font-medium">{t.name}</span><span className="text-xs text-slate-500">{t.specialties ?? 'General'}</span></span>
              </span>
              <span className="text-right text-xs">{t.activeJobs}/{t.maxActiveJobs} jobs{!t.isAvailable && <Badge color="slate" className="ml-1">Unavailable</Badge>}</span>
            </label>
          </li>
        ))}
      </ul>
      <Input className="mt-3" aria-label="Note" placeholder="Note for the technician (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}

function StatusDialog({ r, to, onClose, onDone }: { r: RequestDetail; to: RequestStatus; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [visible, setVisible] = useState(true);
  const go = useMutation({
    mutationFn: () => api(`/requests/${r.id}/status`, { body: { status: to, note: note || undefined, visibleToCustomer: visible } }),
    onSuccess: () => { onClose(); onDone(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const needsNote = to === 'CANCELLED' || (to === 'COMPLETED' && r.balance.outstandingMinor > 0) || (to === 'REPAIR_IN_PROGRESS' && !r.quotations.some((q) => q.status === 'APPROVED'));
  return (
    <Modal open onClose={onClose} title={`Move to “${REQUEST_STATUS_LABELS_STAFF[to]}”`} footer={<><Button variant="secondary" onClick={onClose}>Back</Button><Button variant={to === 'CANCELLED' ? 'danger' : 'primary'} loading={go.isPending} disabled={needsNote && !note} onClick={() => go.mutate()}>Confirm</Button></>}>
      {to === 'COMPLETED' && !r.report && <Alert kind="warning">Submit the final service report first.</Alert>}
      {to === 'COMPLETED' && r.balance.outstandingMinor > 0 && <Alert kind="warning">There is an outstanding balance. Managers may complete anyway with a reason.</Alert>}
      {to === 'REPAIR_IN_PROGRESS' && !r.quotations.some((q) => q.status === 'APPROVED') && r.serviceType !== 'REMOTE_SUPPORT' && <Alert kind="warning">No approved quotation. Only no-charge work (e.g. warranty) may start without one — give the reason.</Alert>}
      <Textarea className="mt-3" label={needsNote ? 'Reason (required)' : 'Note (optional)'} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mt-3"><Checkbox checked={visible} onChange={(e) => setVisible(e.target.checked)} label="Show this change and note to the customer" /></div>
    </Modal>
  );
}

function UpdateDialog({ r, onClose, onDone }: { r: RequestDetail; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(true);
  const go = useMutation({
    mutationFn: () => api(`/requests/${r.id}/updates`, { body: { message, visibleToCustomer: visible } }),
    onSuccess: () => { onClose(); onDone(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title="Post a progress update" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!message.trim()} loading={go.isPending} onClick={() => go.mutate()}>Post</Button></>}>
      <Textarea aria-label="Update" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Waiting for the supplier to deliver the replacement screen" />
      <div className="mt-3"><Checkbox checked={visible} onChange={(e) => setVisible(e.target.checked)} label="Visible to the customer" /></div>
    </Modal>
  );
}

/* ---------------- AnyDesk console ---------------- */

function RemoteConsole({ r, onChange }: { r: RequestDetail; onChange: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const [instructions, setInstructions] = useState('');
  const [completeFor, setCompleteFor] = useState<RemoteSession | null>(null);
  const open = r.remoteSessions.find((s) => ['REQUESTED', 'AUTHORIZED', 'INITIATED', 'ACTIVE'].includes(s.status));
  const canOperate = can('remote.operate') && !!r.technician;
  const call = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api<{ anydeskUrl?: string; matched?: boolean }>(path, { body: body ?? {} }),
    onSuccess: (res, v) => {
      if (res?.anydeskUrl && v.path.endsWith('/initiate')) window.location.href = res.anydeskUrl; // launches the technician's AnyDesk client
      if (v.path.endsWith('/sync')) toast[res?.matched ? 'success' : 'error'](res?.matched ? 'Session data synchronised from AnyDesk' : 'No matching AnyDesk session found yet');
      onChange();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!open && r.serviceType !== 'REMOTE_SUPPORT' && r.remoteSessions.length === 0) {
    return canOperate && !['SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'COMPLETED', 'CLOSED', 'CANCELLED'].includes(r.status)
      ? <div><Button size="sm" variant="ghost" icon={<MonitorSmartphone className="size-4" />} onClick={() => call.mutate({ path: '/remote-sessions', body: { supportRequestId: r.id } })}>Offer a remote session</Button></div>
      : null;
  }
  return (
    <Card title={<span className="flex items-center gap-2"><MonitorSmartphone className="size-5 text-brand-700" /> Remote support (AnyDesk)</span>}>
      {!open && canOperate && !['COMPLETED', 'CLOSED', 'CANCELLED', 'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED'].includes(r.status) && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Ask the customer to install AnyDesk, share their AnyDesk ID and authorise the session. You can connect only after they authorise.</p>
          <Textarea aria-label="Instructions for the customer" rows={2} placeholder="Instructions for the customer (optional)" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          <Button variant="accent" loading={call.isPending} onClick={() => call.mutate({ path: '/remote-sessions', body: { supportRequestId: r.id, instructions: instructions || undefined } })}>Request remote session</Button>
        </div>
      )}
      {!open && !canOperate && <p className="text-sm text-slate-500">{r.technician ? 'Only the assigned technician can run remote sessions.' : 'Assign a technician to start a remote session.'}</p>}
      {open && (
        <div className="space-y-4">
          <ol className="flex flex-wrap gap-2 text-xs">
            {(['REQUESTED', 'AUTHORIZED', 'INITIATED', 'ACTIVE', 'COMPLETED'] as const).map((s) => {
              const order = ['REQUESTED', 'AUTHORIZED', 'INITIATED', 'ACTIVE', 'COMPLETED'];
              const done = order.indexOf(open.status) >= order.indexOf(s);
              return <li key={s}><Badge color={done ? (s === open.status ? 'teal' : 'green') : 'slate'}>{humanize(s)}</Badge></li>;
            })}
          </ol>
          {open.status === 'REQUESTED' && <Alert kind="info">Waiting for the customer to enter their AnyDesk ID and authorise (requested {fmtDateTime(open.requestedAt)}).</Alert>}
          {open.anydeskUrl && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-ink-900 p-4 text-white">
              <div className="mr-auto">
                <p className="text-xs text-ink-100/70">Customer AnyDesk ID · authorised {fmtDateTime(open.authorizedAt)}</p>
                <p className="font-mono text-xl tracking-wider">{open.anydeskAddress}</p>
              </div>
              <button className="rounded-lg p-2 hover:bg-white/10" aria-label="Copy AnyDesk ID" onClick={() => void navigator.clipboard?.writeText(open.anydeskAddress ?? '').then(() => toast.success('Copied'))}><Copy className="size-4" /></button>
              <Button variant="accent" icon={<ExternalLink className="size-4" />} loading={call.isPending && call.variables?.path.endsWith('/initiate')} onClick={() => call.mutate({ path: `/remote-sessions/${open.id}/initiate` })}>
                Connect using AnyDesk
              </Button>
            </div>
          )}
          {open.status === 'INITIATED' && (
            <p className="text-sm text-slate-600">
              AnyDesk should have opened on your computer — your browser may first ask permission to open it. When the customer accepts, mark the session active.
              If nothing opened, check AnyDesk is installed, then <a className="link" href={open.anydeskUrl}>open AnyDesk again</a> (<code>{open.anydeskUrl}</code>).
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {open.status === 'INITIATED' && <Button size="sm" variant="secondary" icon={<PlugZap className="size-4" />} onClick={() => call.mutate({ path: `/remote-sessions/${open.id}/status`, body: { status: 'ACTIVE' } })}>Customer accepted — mark active</Button>}
            {['INITIATED', 'ACTIVE'].includes(open.status) && <Button size="sm" onClick={() => setCompleteFor(open)}>Complete session</Button>}
            {['INITIATED', 'ACTIVE'].includes(open.status) && <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => call.mutate({ path: `/remote-sessions/${open.id}/sync` })}>Sync from AnyDesk API</Button>}
            {['REQUESTED', 'AUTHORIZED', 'INITIATED'].includes(open.status) && <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => call.mutate({ path: `/remote-sessions/${open.id}/status`, body: { status: 'CANCELLED' } })}>Cancel session</Button>}
          </div>
          {open.evidence.source !== 'NONE' && <p className="text-xs text-slate-500">Evidence: {open.evidence.source === 'ANYDESK_API' ? 'AnyDesk API' : 'manual'} · session {open.evidence.anydeskSessionId ?? '—'}</p>}
        </div>
      )}
      {r.remoteSessions.filter((s) => s !== open).length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium text-slate-600">Previous sessions ({r.remoteSessions.filter((s) => s !== open).length})</summary>
          <ul className="mt-2 space-y-2">
            {r.remoteSessions.filter((s) => s !== open).map((s) => (
              <li key={s.id} className="rounded-xl border border-ink-100 p-3">
                <p><Badge color={s.status === 'COMPLETED' ? 'green' : 'slate'}>{humanize(s.status)}</Badge> {s.outcome && <span className="ml-1">{humanize(s.outcome)}</span>}</p>
                <p className="mt-1 text-xs text-slate-500">Requested {fmtDateTime(s.requestedAt)}{s.initiatedAt ? ` · initiated ${fmtDateTime(s.initiatedAt)}` : ''}{s.completedAt ? ` · completed ${fmtDateTime(s.completedAt)}` : ''}{s.revokedAt ? ` · revoked by customer ${fmtDateTime(s.revokedAt)}` : ''}</p>
                {s.workPerformed && <p className="mt-1 whitespace-pre-line">{s.workPerformed}</p>}
                {s.evidence.source !== 'NONE' && <p className="mt-1 text-xs text-slate-500">{s.evidence.source === 'ANYDESK_API' ? 'Verified by AnyDesk API' : 'Recorded manually'} · session {s.evidence.anydeskSessionId ?? '—'}{s.evidence.durationSeconds ? ` · ${Math.round(s.evidence.durationSeconds / 60)} min` : ''}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {completeFor && <CompleteSessionDialog s={completeFor} onClose={() => setCompleteFor(null)} onDone={onChange} />}
    </Card>
  );
}

function CompleteSessionDialog({ s, onClose, onDone }: { s: RemoteSession; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [outcome, setOutcome] = useState('RESOLVED');
  const [work, setWork] = useState('');
  const [sid, setSid] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const toIso = (v: string) => (v ? new Date(v).toISOString() : undefined);
  const go = useMutation({
    mutationFn: () => api(`/remote-sessions/${s.id}/complete`, { body: { outcome, workPerformed: work, anydeskSessionId: sid || undefined, startedAt: toIso(start), endedAt: toIso(end) } }),
    onSuccess: () => { toast.success('Session completed'); onClose(); onDone(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title="Complete remote session" wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={go.isPending} disabled={!work.trim()} onClick={() => go.mutate()}>Complete</Button></>}>
      <div className="space-y-3">
        <Select label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} options={['RESOLVED', 'PARTIALLY_RESOLVED', 'NOT_RESOLVED', 'FOLLOW_UP_REQUIRED'].map((o) => ({ value: o, label: humanize(o) }))} />
        <Textarea label="Work performed" required rows={4} value={work} onChange={(e) => setWork(e.target.value)} />
        <p className="text-sm text-slate-600">If the AnyDesk REST API is configured the session details are filled in automatically. Otherwise record them from your AnyDesk session list (optional):</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="AnyDesk session ID" value={sid} onChange={(e) => setSid(e.target.value)} />
          <Input label="Started" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          <Input label="Ended" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- intake / diagnosis / work ---------------- */

function IntakeCard({ r, onChange }: { r: RequestDetail; onChange: () => void }) {
  const toast = useToast();
  const { data: settings } = useSettings();
  const j = r.repairJob;
  const [editing, setEditing] = useState(!j);
  const [f, setF] = useState({ intakeType: j?.intakeType ?? (r.serviceType === 'ONSITE_SUPPORT' ? 'ONSITE' : 'WORKSHOP'), conditionNotes: j?.conditionNotes ?? '', accessories: j?.accessories ?? '', serialNumber: j?.serialNumber ?? r.device?.serialNumber ?? '', customerAcknowledged: !!j?.customerAcknowledgedAt, acknowledgedByName: j?.acknowledgedByName ?? r.contact.name });
  const save = useMutation({
    mutationFn: () => api(`/repairs/${r.id}/intake`, { method: 'PUT', body: { ...f, accessories: f.accessories || undefined, serialNumber: f.serialNumber || undefined, acknowledgedByName: f.acknowledgedByName || undefined } }),
    onSuccess: () => { toast.success('Intake recorded'); setEditing(false); onChange(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const returned = useMutation({
    mutationFn: () => api(`/repairs/${r.id}/return`, { body: { returnedTo: r.contact.name } }),
    onSuccess: () => { toast.success('Return recorded'); onChange(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const photos = r.attachments.filter((a) => a.context === 'INTAKE_PHOTO');
  return (
    <Card title={r.serviceType === 'ONSITE_SUPPORT' ? 'On-site visit' : 'Device intake'} actions={j && !editing && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>}>
      {editing ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Type" value={f.intakeType} onChange={(e) => setF({ ...f, intakeType: e.target.value as 'WORKSHOP' })} options={[{ value: 'WORKSHOP', label: 'Received at workshop' }, { value: 'ONSITE', label: 'On-site visit' }]} />
            <Input label="Serial number" value={f.serialNumber} onChange={(e) => setF({ ...f, serialNumber: e.target.value })} />
          </div>
          <Textarea label="Condition at intake" required rows={3} placeholder="Scratches, cracks, missing keys, power state…" value={f.conditionNotes} onChange={(e) => setF({ ...f, conditionNotes: e.target.value })} />
          <Input label="Accessories received" placeholder="Charger, bag, cables…" value={f.accessories} onChange={(e) => setF({ ...f, accessories: e.target.value })} />
          <details className="rounded-xl bg-ink-50 p-3 text-xs text-slate-600"><summary className="cursor-pointer font-medium">Handover terms shown to the customer</summary><p className="mt-2 whitespace-pre-line">{settings?.intakeTermsText}</p></details>
          <Checkbox checked={f.customerAcknowledged} onChange={(e) => setF({ ...f, customerAcknowledged: e.target.checked })} label="The customer confirmed these details and the handover terms in person" />
          {f.customerAcknowledged && <Input label="Acknowledged by" value={f.acknowledgedByName} onChange={(e) => setF({ ...f, acknowledgedByName: e.target.value })} />}
          <Button type="submit" loading={save.isPending} disabled={!f.conditionNotes.trim()}>Save intake</Button>
        </form>
      ) : j && (
        <div className="space-y-3">
          <DescriptionList items={[
            { label: 'Received', value: `${fmtDateTime(j.receivedAt)} (${j.intakeType === 'WORKSHOP' ? 'workshop' : 'on-site'})` },
            { label: 'Serial', value: j.serialNumber },
            { label: 'Condition', value: j.conditionNotes },
            { label: 'Accessories', value: j.accessories ?? 'None' },
            { label: 'Customer acknowledgment', value: j.customerAcknowledgedAt ? `${j.acknowledgedByName ?? ''} · ${fmtDateTime(j.customerAcknowledgedAt)}` : <Badge color="amber">Pending</Badge> },
            { label: 'Returned', value: j.returnedAt ? `${j.returnedTo} · ${fmtDateTime(j.returnedAt)}` : '—' },
          ]} />
          <div className="flex flex-wrap items-center gap-2">
            <AttachmentUploader requestId={r.id} context="INTAKE_PHOTO" onDone={onChange} label="Add intake photos" accept="image/jpeg,image/png,image/webp" />
            <span className="text-xs text-slate-500">{photos.length} photo(s)</span>
            {!j.returnedAt && j.intakeType === 'WORKSHOP' && ['READY_FOR_COLLECTION', 'AWAITING_PAYMENT', 'TESTING_QC'].includes(r.status) && <Button size="sm" variant="secondary" loading={returned.isPending} onClick={() => returned.mutate()}>Record device returned</Button>}
          </div>
        </div>
      )}
    </Card>
  );
}

function DiagnosisAndWork({ r, onChange }: { r: RequestDetail; onChange: () => void }) {
  const toast = useToast();
  const [diag, setDiag] = useState({ findings: '', rootCause: '', recommendedAction: '', visibleToCustomer: true });
  const [log, setLog] = useState({ activity: '', minutesSpent: 0, visibleToCustomer: false });
  const working = !['SUBMITTED', 'UNDER_REVIEW', 'CLOSED', 'CANCELLED'].includes(r.status);
  const addDiag = useMutation({
    mutationFn: () => api(`/repairs/${r.id}/diagnostics`, { body: { ...diag, rootCause: diag.rootCause || undefined, recommendedAction: diag.recommendedAction || undefined } }),
    onSuccess: () => { setDiag({ findings: '', rootCause: '', recommendedAction: '', visibleToCustomer: true }); onChange(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const addLog = useMutation({
    mutationFn: () => api(`/repairs/${r.id}/work-logs`, { body: log }),
    onSuccess: () => { setLog({ activity: '', minutesSpent: 0, visibleToCustomer: false }); onChange(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card title="Diagnosis & troubleshooting log">
      <div className="space-y-4">
        {r.diagnostics.map((d) => (
          <div key={d.id} className="rounded-xl border border-ink-100 p-3 text-sm">
            <p className="whitespace-pre-line">{d.findings}</p>
            {d.rootCause && <p className="mt-1 text-slate-600">Root cause: {d.rootCause}</p>}
            {d.recommendedAction && <p className="text-slate-600">Recommended: {d.recommendedAction}</p>}
            <p className="mt-1 text-xs text-slate-500">{d.technician} · {fmtDateTime(d.createdAt)} {!d.visibleToCustomer && <Badge color="amber">Internal</Badge>}</p>
          </div>
        ))}
        {r.workLogs.map((w) => (
          <div key={w.id} className="flex gap-3 text-sm">
            <Wrench className="mt-0.5 size-4 shrink-0 text-slate-400" />
            <div><p className="whitespace-pre-line">{w.activity}</p><p className="text-xs text-slate-500">{w.technician} · {fmtDateTime(w.createdAt)}{w.minutesSpent ? ` · ${w.minutesSpent} min` : ''} {!w.visibleToCustomer && <Badge color="amber">Internal</Badge>}</p></div>
          </div>
        ))}
        {working && (
          <div className="grid gap-4 border-t border-ink-100 pt-4 lg:grid-cols-2">
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); addDiag.mutate(); }}>
              <p className="text-sm font-semibold">Record diagnosis</p>
              <Textarea aria-label="Findings" rows={3} placeholder="Findings" value={diag.findings} onChange={(e) => setDiag({ ...diag, findings: e.target.value })} />
              <Input aria-label="Root cause" placeholder="Root cause (optional)" value={diag.rootCause} onChange={(e) => setDiag({ ...diag, rootCause: e.target.value })} />
              <Input aria-label="Recommended action" placeholder="Recommended action (optional)" value={diag.recommendedAction} onChange={(e) => setDiag({ ...diag, recommendedAction: e.target.value })} />
              <Checkbox checked={diag.visibleToCustomer} onChange={(e) => setDiag({ ...diag, visibleToCustomer: e.target.checked })} label="Visible to customer" />
              <Button type="submit" size="sm" loading={addDiag.isPending} disabled={!diag.findings.trim()}>Save diagnosis</Button>
            </form>
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); addLog.mutate(); }}>
              <p className="text-sm font-semibold">Log work / troubleshooting step</p>
              <Textarea aria-label="Activity" rows={3} placeholder="What did you do?" value={log.activity} onChange={(e) => setLog({ ...log, activity: e.target.value })} />
              <Input aria-label="Minutes spent" type="number" min={0} placeholder="Minutes" value={log.minutesSpent || ''} onChange={(e) => setLog({ ...log, minutesSpent: Number(e.target.value) || 0 })} />
              <Checkbox checked={log.visibleToCustomer} onChange={(e) => setLog({ ...log, visibleToCustomer: e.target.checked })} label="Visible to customer" />
              <Button type="submit" size="sm" loading={addLog.isPending} disabled={!log.activity.trim()}>Add to log</Button>
            </form>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ---------------- quotations ---------------- */

interface Line { itemType: QuotationItemType; description: string; productId?: number; quantity: number; price: string }

function QuotationsCard({ r, onChange }: { r: RequestDetail; onChange: () => void }) {
  const { can } = useAuth();
  const [building, setBuilding] = useState(false);
  const canQuote = can('quotations.prepare') && ['ASSIGNED', 'AWAITING_CUSTOMER', 'DIAGNOSIS_IN_PROGRESS', 'APPROVED', 'AWAITING_PARTS', 'REPAIR_IN_PROGRESS', 'TESTING_QC'].includes(r.status);
  const approved = r.quotations.some((q) => q.status === 'APPROVED');
  return (
    <Card title="Quotations" actions={canQuote && !building && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setBuilding(true)}>{approved ? 'Revised quotation' : 'New quotation'}</Button>}>
      {building && <QuotationBuilder r={r} onClose={() => setBuilding(false)} onDone={() => { setBuilding(false); onChange(); }} />}
      {!building && r.quotations.length === 0 && <p className="text-sm text-slate-500">No quotation yet. Simple remote fixes may not need one; chargeable work and parts always do.</p>}
      <div className="space-y-3">{r.quotations.map((q) => <QuotationView key={q.id} q={q} />)}</div>
    </Card>
  );
}

function QuotationBuilder({ r, onClose, onDone }: { r: RequestDetail; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const money = useMoney();
  const { data: s } = useSettings();
  const digits = s?.currencyMinorDigits ?? 2;
  const [lines, setLines] = useState<Line[]>([{ itemType: 'DIAGNOSIS', description: 'Diagnostic fee', quantity: 1, price: '' }]);
  const [search, setSearch] = useState('');
  const [days, setDays] = useState('');
  const [valid, setValid] = useState(String(14));
  const [notes, setNotes] = useState('');
  const parts = useQuery({ queryKey: ['parts-search', search], queryFn: () => api<Product[]>('/catalog/products', { query: { q: search, pageSize: 8 } }), enabled: search.length >= 2 });
  const totals = computeTotals(lines.map((l) => l.quantity * majorToMinor(l.price || 0, digits)), s?.taxRateBasisPoints ?? 0, s?.taxInclusive ?? false);
  const send = useMutation({
    mutationFn: () => api(`/repairs/${r.id}/quotations`, { body: {
      items: lines.map((l) => ({ itemType: l.itemType, description: l.description, productId: l.productId, quantity: l.quantity, unitPriceMinor: majorToMinor(l.price || 0, digits) })),
      expectedDurationDays: days ? Number(days) : undefined, validDays: Number(valid) || 14, notes: notes || undefined, send: true,
    } }),
    onSuccess: () => { toast.success('Quotation sent to the customer'); onDone(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="mb-4 space-y-4 rounded-xl border border-brand-500/40 bg-brand-50/30 p-4">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500"><tr><th className="pb-1">Type</th><th className="pb-1">Description</th><th className="w-20 pb-1">Qty</th><th className="w-32 pb-1">Unit price</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="align-top">
              <td className="pr-2 pb-2"><Select aria-label="Type" value={l.itemType} onChange={(e) => update(i, { itemType: e.target.value as QuotationItemType })} options={QUOTATION_ITEM_TYPES.filter((t) => t !== 'PART' || l.productId).map((t) => ({ value: t, label: humanize(t) }))} /></td>
              <td className="pr-2 pb-2"><Input aria-label="Description" value={l.description} disabled={!!l.productId} onChange={(e) => update(i, { description: e.target.value })} /></td>
              <td className="pr-2 pb-2"><Input aria-label="Quantity" type="number" min={1} value={l.quantity} onChange={(e) => update(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} /></td>
              <td className="pr-2 pb-2"><Input aria-label="Unit price" inputMode="decimal" value={l.price} onChange={(e) => update(i, { price: e.target.value })} /></td>
              <td className="pb-2"><button type="button" className="p-2 text-slate-400 hover:text-rose-600" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setLines((ls) => [...ls, { itemType: 'LABOUR', description: 'Labour', quantity: 1, price: '' }])}>+ Labour / service line</Button>
        <div className="relative min-w-64 flex-1">
          <Input aria-label="Search spare parts" placeholder="Add a part: search stock by name or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search.length >= 2 && parts.data && (
            <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-ink-100 bg-white shadow-xl">
              {parts.data.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No products found</li>}
              {parts.data.map((p) => (
                <li key={p.id}>
                  <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-ink-50"
                    onClick={() => { setLines((ls) => [...ls, { itemType: 'PART', description: p.name, productId: p.id, quantity: 1, price: (p.priceMinor / 10 ** digits).toFixed(digits) }]); setSearch(''); }}>
                    <span><span className="font-medium">{p.name}</span><span className="block text-xs text-slate-500">{p.sku} · {money(p.priceMinor)}</span></span>
                    <Badge color={p.stock.available > 0 ? 'green' : 'red'}>{p.stock.available} available</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="Expected duration (days)" type="number" min={0} value={days} onChange={(e) => setDays(e.target.value)} />
        <Input label="Valid for (days)" type="number" min={1} value={valid} onChange={(e) => setValid(e.target.value)} />
        <div className="text-right text-sm sm:pt-6">
          {totals.taxMinor > 0 && <p className="text-slate-500">{s?.taxLabel} {money(totals.taxMinor)}</p>}
          <p className="font-display text-lg font-semibold">Total {money(totals.totalMinor)}</p>
        </div>
      </div>
      <Textarea label="Notes for the customer (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <p className="text-xs text-slate-500">Parts are reserved in stock only when the customer approves. Parts that are short will put the job into “Awaiting parts”.</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="accent" loading={send.isPending} disabled={!lines.length || lines.some((l) => !l.description.trim() || l.price === '')} onClick={() => send.mutate()}>Send to customer</Button>
      </div>
    </div>
  );
}

/* ---------------- parts ---------------- */

function PartsCard({ r, onChange }: { r: RequestDetail; onChange: () => void }) {
  const toast = useToast();
  const [requestOpen, setRequestOpen] = useState(false);
  const act = useMutation({
    mutationFn: (path: string) => api(path, { body: {} }),
    onSuccess: () => onChange(),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const waiting = r.parts.filter((p) => p.stockState === 'NONE').length;
  return (
    <Card title="Parts" actions={<>
      {waiting > 0 && <Button size="sm" variant="secondary" onClick={() => act.mutate(`/repairs/${r.id}/parts/allocate`)}>Allocate waiting parts</Button>}
      <Button size="sm" variant="ghost" onClick={() => setRequestOpen(true)}>Request no-charge part</Button>
    </>}>
      {r.parts.length === 0 ? <p className="text-sm text-slate-500">No parts allocated. Chargeable parts come from an approved quotation.</p> : (
        <ul className="divide-y divide-ink-100 text-sm">
          {r.parts.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{p.quantity} × {p.productName} <span className="text-xs text-slate-500">({p.sku}){!p.chargeable && ' · no charge'}</span></span>
              <span className="flex items-center gap-2">
                <Badge color={p.stockState === 'CONSUMED' ? 'green' : p.stockState === 'RESERVED' ? 'teal' : p.stockState === 'RELEASED' ? 'slate' : 'amber'}>
                  {p.stockState === 'NONE' ? 'Awaiting stock' : p.stockState === 'CONSUMED' ? 'Installed' : humanize(p.stockState)}
                </Badge>
                {p.stockState === 'RESERVED' && <Button size="sm" onClick={() => act.mutate(`/repairs/${r.id}/parts/${p.id}/install`)}>Mark installed</Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {requestOpen && <RequestPartDialog r={r} onClose={() => setRequestOpen(false)} onDone={onChange} />}
    </Card>
  );
}

function RequestPartDialog({ r, onClose, onDone }: { r: RequestDetail; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const results = useQuery({ queryKey: ['parts-search', search], queryFn: () => api<Product[]>('/catalog/products', { query: { q: search, pageSize: 8 } }), enabled: search.length >= 2 });
  const go = useMutation({
    mutationFn: () => api<{ reserved: boolean }>(`/repairs/${r.id}/parts`, { body: { productId: product!.id, quantity: qty, note } }),
    onSuccess: (res) => { toast.success(res.reserved ? 'Part reserved' : 'Part requested — awaiting stock'); onClose(); onDone(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title="Request a no-charge part" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!product || note.trim().length < 3} loading={go.isPending} onClick={() => go.mutate()}>Request part</Button></>}>
      <div className="space-y-3">
        <Alert kind="info">For warranty or goodwill replacements only. Chargeable parts must be on a quotation the customer approved.</Alert>
        <Input label="Search stock" value={search} onChange={(e) => { setSearch(e.target.value); setProduct(null); }} />
        <ul className="space-y-1">
          {results.data?.map((p) => (
            <li key={p.id}><button type="button" onClick={() => setProduct(p)} className={`flex w-full justify-between rounded-lg px-3 py-2 text-left text-sm ${product?.id === p.id ? 'bg-brand-50 ring-1 ring-brand-500' : 'hover:bg-ink-50'}`}><span>{p.name} <span className="text-xs text-slate-500">{p.sku}</span></span><span className="text-xs">{p.stock.available} available</span></button></li>
          ))}
        </ul>
        <Input label="Quantity" type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
        <Input label="Reason" required placeholder="e.g. Warranty replacement under SR-…" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}

/* ---------------- final report ---------------- */

function ReportCard({ r, onChange }: { r: RequestDetail; onChange: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const rep = r.report;
  const [f, setF] = useState({
    originalProblem: rep?.originalProblem ?? r.description, diagnosis: rep?.diagnosis ?? r.diagnostics.at(-1)?.findings ?? '', actionsPerformed: rep?.actionsPerformed ?? '',
    changesMade: rep?.changesMade ?? '', testingResults: rep?.testingResults ?? '', recommendations: rep?.recommendations ?? '', warrantyDays: rep?.warrantyDays ?? 0,
    warrantyTerms: rep?.warrantyTerms ?? '', outcome: rep?.outcome ?? 'RESOLVED',
  });
  const save = useMutation({
    mutationFn: () => api(`/repairs/${r.id}/report`, { method: 'PUT', body: { ...f, changesMade: f.changesMade || undefined, recommendations: f.recommendations || undefined, warrantyTerms: f.warrantyTerms || undefined } }),
    onSuccess: () => { toast.success('Service report saved'); setEditing(false); onChange(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const canReport = ['DIAGNOSIS_IN_PROGRESS', 'APPROVED', 'REPAIR_IN_PROGRESS', 'TESTING_QC', 'AWAITING_PAYMENT', 'READY_FOR_COLLECTION', 'AWAITING_CUSTOMER'].includes(r.status);
  return (
    <Card title="Final service report" actions={canReport && !editing && <Button size="sm" variant={rep ? 'ghost' : 'primary'} onClick={() => setEditing(true)}>{rep ? 'Edit report' : 'Write report'}</Button>}>
      {editing ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Textarea label="Original problem" required rows={2} value={f.originalProblem} onChange={(e) => setF({ ...f, originalProblem: e.target.value })} />
          <Textarea label="Diagnosis" required rows={2} value={f.diagnosis} onChange={(e) => setF({ ...f, diagnosis: e.target.value })} />
          <Textarea label="Actions performed" required rows={3} value={f.actionsPerformed} onChange={(e) => setF({ ...f, actionsPerformed: e.target.value })} />
          <Textarea label="Configuration / components changed" rows={2} value={f.changesMade} onChange={(e) => setF({ ...f, changesMade: e.target.value })} />
          <Textarea label="Testing results" required rows={2} value={f.testingResults} onChange={(e) => setF({ ...f, testingResults: e.target.value })} />
          <Textarea label="Recommendations" rows={2} value={f.recommendations} onChange={(e) => setF({ ...f, recommendations: e.target.value })} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Outcome" value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} options={['RESOLVED', 'PARTIALLY_RESOLVED', 'NOT_RESOLVED', 'NOT_REPAIRABLE'].map((o) => ({ value: o, label: humanize(o) }))} />
            <Input label="Warranty (days)" type="number" min={0} value={f.warrantyDays} onChange={(e) => setF({ ...f, warrantyDays: Number(e.target.value) || 0 })} />
            <Input label="Warranty terms" value={f.warrantyTerms} onChange={(e) => setF({ ...f, warrantyTerms: e.target.value })} />
          </div>
          <p className="text-xs text-slate-500">Installed parts and remote-session evidence are added to the report automatically.</p>
          <div className="flex gap-2"><Button type="submit" loading={save.isPending}>Submit report</Button><Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button></div>
        </form>
      ) : rep ? <ReportView report={rep} warranty={r.warranty} /> : <p className="text-sm text-slate-500">Required before the job can be completed.</p>}
    </Card>
  );
}

/* ---------------- internal notes ---------------- */

function NotesCard({ requestId }: { requestId: number }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const notes = useQuery({ queryKey: ['notes', requestId], queryFn: () => api<{ id: number; body: string; createdAt: string; author: string }[]>(`/requests/${requestId}/notes`) });
  const add = useMutation({
    mutationFn: () => api(`/requests/${requestId}/notes`, { body: { body } }),
    onSuccess: () => { setBody(''); void qc.invalidateQueries({ queryKey: ['notes', requestId] }); },
  });
  return (
    <Card title="Internal notes" actions={<Badge color="amber">Never shown to the customer</Badge>}>
      <ul className="mb-4 space-y-3">
        {notes.data?.length === 0 && <li className="text-sm text-slate-500">No internal notes yet.</li>}
        {notes.data?.map((n) => <li key={n.id} className="rounded-xl bg-spark-100/60 p-3 text-sm"><p className="whitespace-pre-line">{n.body}</p><p className="mt-1 text-xs text-slate-500">{n.author} · {fmtDateTime(n.createdAt)}</p></li>)}
      </ul>
      <form onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate(); }} className="space-y-2">
        <Textarea aria-label="New note" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Private note for the team…" />
        <Button type="submit" size="sm" loading={add.isPending} disabled={!body.trim()}>Add note</Button>
      </form>
      <p className="mt-3 text-xs text-slate-500"><Link to="/staff/requests" className="link">Back to queue</Link></p>
    </Card>
  );
}
