import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, KeyRound, MonitorSmartphone, ShieldCheck, Star } from 'lucide-react';
import clsx from 'clsx';
import { CUSTOMER_CANCELLABLE, DEVICE_TYPE_LABELS, SERVICE_TYPE_LABELS, normalizeAnyDeskAddress, ANYDESK_ADDRESS_RE } from '@dante/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDateTime, humanize } from '../../lib/format';
import type { RemoteSession, RequestDetail } from '../../lib/types';
import { useToast } from '../../components/toast';
import { Alert, Badge, Button, Card, Checkbox, DescriptionList, Input, Modal, PageHeader, QueryState, RequestStatusBadge, Textarea, errorMessage } from '../../components/ui';
import { AttachmentList, AttachmentUploader } from './attachments';
import { MessagesPanel, PaymentList, ProgressTracker, QuotationView, ReportView, Timeline } from './components';
import { PayPanel } from './PayPanel';

export function CustomerRequestPage() {
  const id = Number(useParams().id);
  const [params] = useSearchParams();
  const q = useQuery({ queryKey: ['request', id], queryFn: () => api<RequestDetail>(`/requests/${id}`), refetchInterval: 30_000 });
  return (
    <QueryState query={q}>
      {(r) => (
        <div className="space-y-6">
          <PageHeader back={{ to: '/account/requests', label: 'My requests' }} title={r.title}
            subtitle={<>{r.reference} · {SERVICE_TYPE_LABELS[r.serviceType]} · submitted {fmtDateTime(r.dates.submittedAt)}</>}
            actions={<RequestStatusBadge status={r.status} />} />
          {params.get('payment') === 'success' && <Alert kind="success">Thank you. Your payment is being confirmed by the payment provider; this page updates automatically.</Alert>}
          <Card><ProgressTracker serviceType={r.serviceType} status={r.status} />{r.technician && <p className="mt-3 text-sm text-slate-600">Your technician: <span className="font-semibold text-ink-900">{r.technician.name}</span></p>}</Card>
          <ActionPanels r={r} />
          <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            <div className="space-y-6">
              <Card title="Messages"><MessagesPanel requestId={r.id} closed={['CLOSED', 'CANCELLED'].includes(r.status)} mine="customer" /></Card>
              {r.report && <Card title="Service report"><ReportView report={r.report} warranty={r.warranty} /></Card>}
              {r.quotations.length > 0 && <Card title="Quotations"><div className="space-y-3">{r.quotations.map((qq) => <QuotationView key={qq.id} q={qq} />)}</div></Card>}
              {r.diagnostics.length > 0 && (
                <Card title="Diagnosis">
                  <ul className="space-y-3 text-sm">{r.diagnostics.map((d) => <li key={d.id}><p className="whitespace-pre-line">{d.findings}</p>{d.recommendedAction && <p className="mt-1 text-slate-600">Recommended: {d.recommendedAction}</p>}<p className="mt-1 text-xs text-slate-500">{d.technician} · {fmtDateTime(d.createdAt)}</p></li>)}</ul>
                </Card>
              )}
            </div>
            <div className="space-y-6">
              <Card title="Progress"><Timeline items={r.timeline} /></Card>
              <Card title="Request details">
                <DescriptionList items={[
                  { label: 'Category', value: r.category.name },
                  { label: 'Urgency', value: humanize(r.urgency) },
                  { label: 'Device', value: r.device ? `${DEVICE_TYPE_LABELS[r.device.deviceType as keyof typeof DEVICE_TYPE_LABELS]} ${[r.device.manufacturer, r.device.model].filter(Boolean).join(' ')}` : 'Not specified' },
                  { label: 'Contact', value: `${r.contact.name} · ${r.contact.phone}` },
                  ...(r.siteAddress ? [{ label: 'Site address', value: r.siteAddress }] : []),
                ]} />
                <p className="mt-4 text-xs font-semibold tracking-wide text-slate-500 uppercase">Description</p>
                <p className="mt-1 text-sm whitespace-pre-line">{r.description}</p>
                {r.errorMessages && <><p className="mt-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">Error messages</p><pre className="mt-1 overflow-x-auto rounded-lg bg-ink-50 p-2 text-xs whitespace-pre-wrap">{r.errorMessages}</pre></>}
              </Card>
              <Card title="Files" actions={!['CLOSED', 'CANCELLED'].includes(r.status) && <AttachmentUploader requestId={r.id} onDone={() => void q.refetch()} label="Add files" />}>
                <AttachmentList items={r.attachments} />
              </Card>
              {r.payments.length > 0 && <Card title="Payments"><PaymentList payments={r.payments} /></Card>}
              <CancelRequest r={r} />
            </div>
          </div>
        </div>
      )}
    </QueryState>
  );
}

/** Everything that needs the customer's attention, at the top of the page. */
function ActionPanels({ r }: { r: RequestDetail }) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['request', r.id] });
  const openSession = r.remoteSessions.find((s) => ['REQUESTED', 'AUTHORIZED', 'INITIATED', 'ACTIVE'].includes(s.status));
  const pendingQuote = r.quotations.find((q) => q.status === 'SENT');
  const needsHandover = r.repairJob && !r.repairJob.customerAcknowledgedAt;
  const canPay = r.balance.outstandingMinor > 0 && !['CANCELLED'].includes(r.status);
  const canRate = ['COMPLETED', 'CLOSED'].includes(r.status) && !r.feedback;
  return (
    <>
      {openSession && <RemoteSessionPanel r={r} s={openSession} onChange={refresh} />}
      {pendingQuote && <QuoteDecision r={r} onChange={refresh} />}
      {needsHandover && <HandoverAck r={r} onChange={refresh} />}
      {canPay && <Card title="Payment"><PayPanel payableType="SUPPORT_REQUEST" payableId={r.id} outstandingMinor={r.balance.outstandingMinor} onDone={refresh} /></Card>}
      {canRate && <FeedbackForm r={r} onChange={refresh} />}
      {r.feedback && (
        <Alert kind="success" title="Thank you for your feedback">
          You rated this service {r.feedback.rating}/5{r.feedback.comment ? ` — “${r.feedback.comment}”` : ''}.
        </Alert>
      )}
    </>
  );
}

function RemoteSessionPanel({ r, s, onChange }: { r: RequestDetail; s: RemoteSession; onChange: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const [address, setAddress] = useState('');
  const [agree, setAgree] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [reason, setReason] = useState('');
  const valid = ANYDESK_ADDRESS_RE.test(normalizeAnyDeskAddress(address));
  const authorize = useMutation({
    mutationFn: () => api(`/remote-sessions/${s.id}/authorize`, { body: { anydeskAddress: address, consent: agree, consentVersion: r.remoteConsent.version } }),
    onSuccess: () => { toast.success('Thank you — your technician has been notified'); onChange(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: () => api(`/remote-sessions/${s.id}/revoke`, { body: { reason: reason || undefined } }),
    onSuccess: () => { setRevokeOpen(false); toast.success('Remote access withdrawn'); onChange(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const isRequester = r.customer?.id === user?.id;

  return (
    <section className="card overflow-hidden border-brand-500/40">
      <div className="flex items-center gap-3 bg-ink-900 px-5 py-4 text-white">
        <MonitorSmartphone className="size-6 text-brand-400" />
        <div>
          <h2 className="font-display text-lg font-semibold">Remote support session</h2>
          <p className="text-sm text-ink-100/75">{s.status === 'REQUESTED' ? 'Your technician is ready. Three quick steps and we can start.' : s.status === 'AUTHORIZED' ? 'Authorised — waiting for your technician to connect.' : s.status === 'INITIATED' ? 'Your technician is connecting now.' : 'Session in progress.'}</p>
        </div>
      </div>
      <div className="space-y-5 p-5">
        {s.instructions && <Alert kind="info" title="Note from your technician">{s.instructions}</Alert>}
        {s.status === 'REQUESTED' && isRequester && (
          <ol className="space-y-5">
            <li className="flex gap-3">
              <Step n={1} />
              <div>
                <p className="font-semibold">Install AnyDesk (skip if you already have it)</p>
                <p className="mt-1 text-sm text-slate-600">Download it only from the official AnyDesk website, then open it.</p>
                <a href={r.anydeskDownloadUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"><Download className="size-4" /> Download AnyDesk</a>
              </div>
            </li>
            <li className="flex gap-3">
              <Step n={2} />
              <div className="w-full max-w-md">
                <p className="font-semibold">Enter your AnyDesk ID</p>
                <p className="mt-1 text-sm text-slate-600">It is the 9–10 digit number shown in the AnyDesk window under <em>“Your address”</em> / <em>“This desk”</em>.</p>
                <Input className="mt-2 font-mono tracking-wider" placeholder="123 456 789" inputMode="text" autoComplete="off" value={address} onChange={(e) => setAddress(e.target.value)}
                  aria-label="AnyDesk ID" error={address && !valid ? 'That does not look like an AnyDesk ID' : undefined} />
                <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-rose-700"><KeyRound className="size-3.5" /> Never type a password here. We will never ask for your AnyDesk password.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <Step n={3} />
              <div>
                <p className="font-semibold">Authorise the session</p>
                <div className="mt-2 max-h-40 overflow-y-auto rounded-xl bg-ink-50 p-3 text-sm whitespace-pre-line text-ink-800">{r.remoteConsent.text}</div>
                <div className="mt-3"><Checkbox checked={agree} onChange={(e) => setAgree(e.target.checked)} label="I have read this and I authorise the remote support session for this request." /></div>
                <Button className="mt-3" variant="accent" disabled={!valid || !agree} loading={authorize.isPending} icon={<ShieldCheck className="size-4" />} onClick={() => authorize.mutate()}>Authorise remote session</Button>
              </div>
            </li>
          </ol>
        )}
        {s.status === 'REQUESTED' && !isRequester && <Alert kind="info">The person who raised this request needs to authorise the session from their account.</Alert>}
        {['AUTHORIZED', 'INITIATED', 'ACTIVE'].includes(s.status) && (
          <>
            <ul className="grid gap-3 text-sm sm:grid-cols-3">
              <li className="rounded-xl bg-ink-50 p-3"><p className="text-xs text-slate-500">AnyDesk ID</p><p className="font-mono font-semibold">{s.anydeskAddress}</p></li>
              <li className="rounded-xl bg-ink-50 p-3"><p className="text-xs text-slate-500">Authorised</p><p className="font-semibold">{fmtDateTime(s.authorizedAt)}</p></li>
              <li className="rounded-xl bg-ink-50 p-3"><p className="text-xs text-slate-500">Status</p><Badge color={s.status === 'ACTIVE' ? 'green' : 'blue'}>{humanize(s.status)}</Badge></li>
            </ul>
            <Alert kind="warning" title="When your technician connects">An AnyDesk window will pop up asking you to accept the connection. Click <strong>Accept</strong>. You can watch everything and close AnyDesk at any time to end the session immediately.</Alert>
            {isRequester && <Button variant="secondary" onClick={() => setRevokeOpen(true)}>Withdraw authorisation</Button>}
          </>
        )}
      </div>
      <Modal open={revokeOpen} onClose={() => setRevokeOpen(false)} title="Withdraw remote access?"
        footer={<><Button variant="secondary" onClick={() => setRevokeOpen(false)}>Keep it</Button><Button variant="danger" loading={revoke.isPending} onClick={() => revoke.mutate()}>Withdraw</Button></>}>
        <p className="text-sm text-slate-600">Your technician will be told to disconnect immediately. To end a connection right now, also close the AnyDesk window.</p>
        <Textarea className="mt-3" aria-label="Reason (optional)" placeholder="Reason (optional)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </section>
  );
}

const Step = ({ n }: { n: number }) => <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-100 font-display font-semibold text-brand-700">{n}</span>;

function QuoteDecision({ r, onChange }: { r: RequestDetail; onChange: () => void }) {
  const toast = useToast();
  const q = r.quotations.find((x) => x.status === 'SENT')!;
  const [comment, setComment] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'APPROVE' | 'DECLINE') => api(`/repairs/quotations/${q.id}/decision`, { body: { decision, comment: comment || undefined } }),
    onSuccess: (_d, decision) => { toast.success(decision === 'APPROVE' ? 'Quotation approved — work can continue' : 'Quotation declined'); onChange(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card title={q.revision > 1 ? 'A revised quotation needs your decision' : 'Your quotation is ready'}>
      <p className="mb-4 text-sm text-slate-600">No chargeable work will be done until you approve. {q.revision > 1 && 'Your technician found something additional during the repair.'}</p>
      <QuotationView q={q} />
      <Textarea className="mt-4" aria-label="Comment (optional)" rows={2} placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="accent" loading={decide.isPending && decide.variables === 'APPROVE'} onClick={() => decide.mutate('APPROVE')}>Approve quotation</Button>
        <Button variant="secondary" loading={decide.isPending && decide.variables === 'DECLINE'} onClick={() => decide.mutate('DECLINE')}>Decline</Button>
      </div>
    </Card>
  );
}

function HandoverAck({ r, onChange }: { r: RequestDetail; onChange: () => void }) {
  const toast = useToast();
  const ack = useMutation({
    mutationFn: () => api(`/repairs/${r.id}/intake/acknowledge`, { body: {} }),
    onSuccess: () => { toast.success('Handover confirmed'); onChange(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const j = r.repairJob!;
  return (
    <Card title="Please confirm the device handover">
      <DescriptionList items={[
        { label: 'Received', value: fmtDateTime(j.receivedAt) },
        { label: 'Serial number', value: j.serialNumber },
        { label: 'Condition recorded', value: j.conditionNotes },
        { label: 'Accessories', value: j.accessories ?? 'None' },
      ]} />
      <Button className="mt-4" onClick={() => ack.mutate()} loading={ack.isPending}>Confirm these details</Button>
    </Card>
  );
}

function FeedbackForm({ r, onChange }: { r: RequestDetail; onChange: () => void }) {
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [resolved, setResolved] = useState<boolean | null>(null);
  const [sub, setSub] = useState({ timelinessRating: 0, communicationRating: 0, professionalismRating: 0 });
  const [comment, setComment] = useState('');
  const send = useMutation({
    mutationFn: () => api(`/repairs/${r.id}/feedback`, { body: { rating, issueResolved: resolved, comment: comment || undefined, ...Object.fromEntries(Object.entries(sub).filter(([, v]) => v > 0)) } }),
    onSuccess: () => { toast.success('Thank you for your feedback!'); onChange(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card title="How did we do?">
      <div className="space-y-4">
        <Stars label="Overall" value={rating} onChange={setRating} big />
        <fieldset>
          <legend className="label">Was your problem resolved?</legend>
          <div className="flex gap-2">
            {[true, false].map((v) => (
              <button key={String(v)} type="button" onClick={() => setResolved(v)} className={clsx('rounded-xl border px-4 py-2 text-sm font-medium', resolved === v ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-100')}>{v ? 'Yes' : 'No'}</button>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stars label="Timeliness" value={sub.timelinessRating} onChange={(v) => setSub({ ...sub, timelinessRating: v })} />
          <Stars label="Communication" value={sub.communicationRating} onChange={(v) => setSub({ ...sub, communicationRating: v })} />
          <Stars label="Professionalism" value={sub.professionalismRating} onChange={(v) => setSub({ ...sub, professionalismRating: v })} />
        </div>
        <Textarea label="Anything else? (optional)" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        <Button variant="accent" disabled={!rating || resolved === null} loading={send.isPending} onClick={() => send.mutate()}>Send feedback</Button>
      </div>
    </Card>
  );
}

function Stars({ label, value, onChange, big }: { label: string; value: number; onChange: (v: number) => void; big?: boolean }) {
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`} aria-pressed={value >= n}>
            <Star className={clsx(big ? 'size-8' : 'size-6', value >= n ? 'fill-spark-500 text-spark-500' : 'text-ink-100')} />
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function CancelRequest({ r }: { r: RequestDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () => api(`/requests/${r.id}/cancel`, { body: { reason } }),
    onSuccess: () => { setOpen(false); toast.success('Request cancelled'); void qc.invalidateQueries({ queryKey: ['request', r.id] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!CUSTOMER_CANCELLABLE.includes(r.status)) return null;
  return (
    <>
      <button className="text-sm font-medium text-rose-600 hover:underline" onClick={() => setOpen(true)}>Cancel this request</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Cancel request?"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Keep request</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel request</Button></>}>
        <Textarea label="Why are you cancelling?" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </>
  );
}
