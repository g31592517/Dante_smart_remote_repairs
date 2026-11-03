import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Paperclip, Send } from 'lucide-react';
import { PAYMENT_METHOD_LABELS, REQUEST_STATUS_LABELS, type RequestStatus, type ServiceType } from '@dante/shared';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime, humanize, timeAgo } from '../../lib/format';
import { useMoney } from '../../lib/settings';
import type { Message, Payment, Quotation, RequestDetail } from '../../lib/types';
import { useToast } from '../../components/toast';
import { Badge, Button, Textarea, errorMessage } from '../../components/ui';
import { uploadAttachments } from './attachments';

/* ---------------- progress tracker ---------------- */

const PATHS: Record<ServiceType, { label: string; statuses: RequestStatus[] }[]> = {
  REMOTE_SUPPORT: [
    { label: 'Submitted', statuses: ['SUBMITTED', 'UNDER_REVIEW'] },
    { label: 'Accepted', statuses: ['ACCEPTED', 'ASSIGNED'] },
    { label: 'In progress', statuses: ['AWAITING_CUSTOMER', 'DIAGNOSIS_IN_PROGRESS', 'AWAITING_QUOTATION_APPROVAL', 'APPROVED', 'AWAITING_PAYMENT'] },
    { label: 'Completed', statuses: ['COMPLETED', 'CLOSED'] },
  ],
  CONSULTATION: [
    { label: 'Submitted', statuses: ['SUBMITTED', 'UNDER_REVIEW'] },
    { label: 'Accepted', statuses: ['ACCEPTED', 'ASSIGNED'] },
    { label: 'In progress', statuses: ['AWAITING_CUSTOMER', 'DIAGNOSIS_IN_PROGRESS', 'AWAITING_QUOTATION_APPROVAL', 'APPROVED', 'AWAITING_PAYMENT'] },
    { label: 'Completed', statuses: ['COMPLETED', 'CLOSED'] },
  ],
  HARDWARE_REPAIR: [
    { label: 'Submitted', statuses: ['SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'ASSIGNED'] },
    { label: 'Diagnosis', statuses: ['AWAITING_CUSTOMER', 'DIAGNOSIS_IN_PROGRESS'] },
    { label: 'Quotation', statuses: ['AWAITING_QUOTATION_APPROVAL', 'APPROVED', 'AWAITING_PARTS'] },
    { label: 'Repair', statuses: ['REPAIR_IN_PROGRESS', 'TESTING_QC'] },
    { label: 'Ready', statuses: ['AWAITING_PAYMENT', 'READY_FOR_COLLECTION'] },
    { label: 'Completed', statuses: ['COMPLETED', 'CLOSED'] },
  ],
  ONSITE_SUPPORT: [
    { label: 'Submitted', statuses: ['SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'ASSIGNED'] },
    { label: 'Visit & diagnosis', statuses: ['AWAITING_CUSTOMER', 'DIAGNOSIS_IN_PROGRESS'] },
    { label: 'Quotation', statuses: ['AWAITING_QUOTATION_APPROVAL', 'APPROVED', 'AWAITING_PARTS'] },
    { label: 'Work', statuses: ['REPAIR_IN_PROGRESS', 'TESTING_QC', 'AWAITING_PAYMENT'] },
    { label: 'Completed', statuses: ['COMPLETED', 'CLOSED'] },
  ],
};

export function ProgressTracker({ serviceType, status }: { serviceType: ServiceType; status: RequestStatus }) {
  if (status === 'CANCELLED') return null;
  const path = PATHS[serviceType];
  const current = path.findIndex((p) => p.statuses.includes(status));
  return (
    <ol className="flex items-center gap-2 overflow-x-auto py-1" aria-label="Request progress">
      {path.map((p, i) => (
        <li key={p.label} className="flex shrink-0 items-center gap-2">
          <span className={clsx('flex size-7 items-center justify-center rounded-full text-xs font-bold',
            i < current ? 'bg-brand-600 text-white' : i === current ? 'bg-ink-900 text-white ring-4 ring-brand-500/25' : 'bg-ink-100 text-slate-500')}
            aria-current={i === current ? 'step' : undefined}>
            {i < current ? <Check className="size-4" /> : i + 1}
          </span>
          <span className={clsx('text-sm whitespace-nowrap', i === current ? 'font-semibold text-ink-900' : 'text-slate-500')}>{p.label}</span>
          {i < path.length - 1 && <span className="h-px w-6 bg-ink-100 sm:w-10" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

/* ---------------- timeline ---------------- */

export function Timeline({ items, staff }: { items: RequestDetail['timeline']; staff?: boolean }) {
  return (
    <ol className="relative space-y-4 border-l-2 border-ink-100 pl-5">
      {[...items].reverse().map((t) => (
        <li key={t.id} className="relative">
          <span className={clsx('absolute top-1.5 -left-[27px] size-3 rounded-full ring-4 ring-white', t.type === 'STATUS_CHANGED' ? 'bg-brand-600' : 'bg-ink-600/40')} aria-hidden />
          <p className="text-sm text-ink-900">{t.message}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {fmtDateTime(t.createdAt)}{t.actor ? ` · ${t.actor}` : ''}
            {staff && !t.visibleToCustomer && <Badge color="amber" className="ml-2">Internal</Badge>}
          </p>
        </li>
      ))}
    </ol>
  );
}

/* ---------------- conversation ---------------- */

export function MessagesPanel({ requestId, closed, mine }: { requestId: number; closed: boolean; mine: 'customer' | 'staff' }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const messages = useQuery({ queryKey: ['messages', requestId], queryFn: () => api<Message[]>(`/requests/${requestId}/messages`), refetchInterval: 20_000 });
  const send = useMutation({
    mutationFn: async () => {
      const m = await api<{ id: number }>(`/requests/${requestId}/messages`, { body: { body } });
      if (files.length) await uploadAttachments(requestId, files, 'MESSAGE', m.id);
    },
    onSuccess: () => {
      setBody('');
      setFiles([]);
      void qc.invalidateQueries({ queryKey: ['messages', requestId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="flex flex-col gap-4">
      <ul className="max-h-[28rem] space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {messages.data?.length === 0 && <li className="text-sm text-slate-500">No messages yet. Ask a question or add information here.</li>}
        {messages.data?.map((m) => {
          const own = (mine === 'staff') === m.fromStaff;
          return (
            <li key={m.id} className={clsx('flex', own ? 'justify-end' : 'justify-start')}>
              <div className={clsx('max-w-[85%] rounded-2xl px-4 py-2.5 text-sm', own ? 'rounded-br-md bg-ink-900 text-white' : 'rounded-bl-md bg-ink-100/70 text-ink-900')}>
                <p className={clsx('mb-0.5 text-xs font-semibold', own ? 'text-brand-400' : 'text-ink-700')}>{m.sender.name}{m.fromStaff && mine === 'customer' ? ' · Support team' : ''}</p>
                <p className="whitespace-pre-line">{m.body}</p>
                {m.attachments.map((a) => <p key={a.id} className="mt-1 flex items-center gap-1 text-xs opacity-80"><Paperclip className="size-3" />{a.name}</p>)}
                <p className={clsx('mt-1 text-[11px]', own ? 'text-white/60' : 'text-slate-500')}>{timeAgo(m.createdAt)}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {!closed && (
        <form onSubmit={(e) => { e.preventDefault(); if (body.trim()) send.mutate(); }} className="space-y-2">
          <Textarea aria-label="Message" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a message…" />
          <div className="flex items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-600">
              <Paperclip className="size-4" /> {files.length ? `${files.length} file(s)` : 'Attach'}
              <input type="file" multiple className="sr-only" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))} />
            </label>
            <Button type="submit" size="sm" loading={send.isPending} disabled={!body.trim()} icon={<Send className="size-4" />}>Send</Button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ---------------- quotation ---------------- */

export function QuotationView({ q }: { q: Quotation }) {
  const money = useMoney();
  const tone = { DRAFT: 'slate', SENT: 'amber', APPROVED: 'green', DECLINED: 'red', SUPERSEDED: 'slate', EXPIRED: 'slate' } as const;
  return (
    <div className="rounded-xl border border-ink-100">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
        <p className="font-semibold">{q.reference}{q.revision > 1 && <span className="ml-1 text-sm font-normal text-slate-500">(revision {q.revision})</span>}</p>
        <Badge color={tone[q.status]}>{humanize(q.status)}</Badge>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500"><tr><th className="px-4 py-2 font-medium">Item</th><th className="px-2 py-2 text-right font-medium">Qty</th><th className="px-2 py-2 text-right font-medium">Price</th><th className="px-4 py-2 text-right font-medium">Total</th></tr></thead>
        <tbody>
          {q.items.map((i) => (
            <tr key={i.id} className="border-t border-ink-100">
              <td className="px-4 py-2">{i.description}<span className="ml-1 text-xs text-slate-400">{humanize(i.itemType)}</span></td>
              <td className="px-2 py-2 text-right">{i.quantity}</td>
              <td className="px-2 py-2 text-right">{money(i.unitPriceMinor)}</td>
              <td className="px-4 py-2 text-right">{money(i.lineTotalMinor)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-ink-100 text-right">
          {q.taxMinor > 0 && <tr><td colSpan={3} className="px-2 pt-2 text-slate-500">{q.taxInclusive ? 'Includes tax' : 'Tax'} ({(q.taxRateBasisPoints / 100).toFixed(2)}%)</td><td className="px-4 pt-2">{money(q.taxMinor)}</td></tr>}
          <tr><td colSpan={3} className="px-2 py-2 font-semibold">Total</td><td className="px-4 py-2 font-display text-base font-semibold">{money(q.totalMinor)}</td></tr>
        </tfoot>
      </table>
      <div className="space-y-1 border-t border-ink-100 px-4 py-3 text-xs text-slate-500">
        <p>Prepared by {q.preparedBy}{q.expectedDurationDays ? ` · Expected duration ${q.expectedDurationDays} day(s)` : ''} · Valid until {fmtDate(q.validUntil)}</p>
        {q.notes && <p className="text-sm text-ink-800">{q.notes}</p>}
        {q.decisionComment && <p>Customer comment: “{q.decisionComment}”</p>}
      </div>
    </div>
  );
}

/* ---------------- service report ---------------- */

export function ReportView({ report, warranty }: { report: NonNullable<RequestDetail['report']>; warranty: RequestDetail['warranty'] }) {
  const rows: [string, string | null][] = [
    ['Original problem', report.originalProblem], ['Diagnosis', report.diagnosis], ['Actions performed', report.actionsPerformed],
    ['Configuration / components changed', report.changesMade], ['Testing results', report.testingResults], ['Recommendations', report.recommendations],
  ];
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge color={report.outcome === 'RESOLVED' ? 'green' : report.outcome === 'NOT_RESOLVED' || report.outcome === 'NOT_REPAIRABLE' ? 'red' : 'amber'}>{humanize(report.outcome)}</Badge>
        <span className="text-xs text-slate-500">Submitted {fmtDateTime(report.submittedAt)}</span>
      </div>
      {rows.filter(([, v]) => v).map(([k, v]) => (
        <div key={k}><p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{k}</p><p className="mt-0.5 whitespace-pre-line">{v}</p></div>
      ))}
      {report.partsReplaced.length > 0 && (
        <div>
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Parts replaced</p>
          <ul className="mt-1 list-inside list-disc">{report.partsReplaced.map((p, i) => <li key={i}>{p.quantity} × {p.name} ({p.sku}){!p.chargeable && ' — no charge'}</li>)}</ul>
        </div>
      )}
      {report.remoteSessions.length > 0 && (
        <div>
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Remote sessions</p>
          <ul className="mt-1 space-y-1">
            {report.remoteSessions.map((s) => (
              <li key={s.id}>{humanize(s.outcome)}{s.startedAt ? ` · ${fmtDateTime(s.startedAt)}` : ''}{s.durationSeconds ? ` · ${Math.round(s.durationSeconds / 60)} min` : ''}{s.anydeskSessionId ? ` · AnyDesk session ${s.anydeskSessionId}` : ''}{s.source === 'ANYDESK_API' ? ' (verified via AnyDesk)' : ''}</li>
            ))}
          </ul>
        </div>
      )}
      {warranty && <p className="rounded-xl bg-brand-50 px-3 py-2 text-brand-700">Warranty on this work until {fmtDate(warranty.endsOn)}{warranty.terms ? ` — ${warranty.terms}` : ''}</p>}
    </div>
  );
}

export function PaymentList({ payments }: { payments: Payment[] }) {
  const money = useMoney();
  if (!payments.length) return null;
  return (
    <ul className="divide-y divide-ink-100 text-sm">
      {payments.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span>{p.reference} · {PAYMENT_METHOD_LABELS[p.method]}<span className="ml-2 text-xs text-slate-500">{fmtDateTime(p.succeededAt ?? p.createdAt)}</span></span>
          <span className="flex items-center gap-2">{money(p.amountMinor)}<Badge color={p.status === 'SUCCEEDED' ? 'green' : p.status === 'PENDING' ? 'amber' : p.status === 'REFUNDED' ? 'violet' : 'red'}>{humanize(p.status)}</Badge></span>
        </li>
      ))}
    </ul>
  );
}

export function statusLabel(s: RequestStatus) {
  return REQUEST_STATUS_LABELS[s];
}
