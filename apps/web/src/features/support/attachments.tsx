import { useState } from 'react';
import { FileText, ImageIcon, Paperclip, Upload } from 'lucide-react';
import { api, downloadFile } from '../../lib/api';
import { fileSize } from '../../lib/format';
import { useToast } from '../../components/toast';
import { Badge, Button } from '../../components/ui';

export type AttachmentContext = 'REQUEST' | 'MESSAGE' | 'INTAKE_PHOTO' | 'REPORT' | 'INTERNAL';

export async function uploadAttachments(supportRequestId: number, files: File[], context: AttachmentContext, contextId?: number) {
  const fd = new FormData();
  fd.set('supportRequestId', String(supportRequestId));
  fd.set('context', context);
  if (contextId) fd.set('contextId', String(contextId));
  files.forEach((f) => fd.append('files', f));
  return api<{ id: number; name: string }[]>('/attachments', { form: fd });
}

export function AttachmentList({ items }: { items: { id: number; name: string; mimeType: string; sizeBytes: number; context?: string; visibleToCustomer?: boolean }[] }) {
  const toast = useToast();
  if (!items.length) return <p className="text-sm text-slate-500">No files yet.</p>;
  return (
    <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100">
      {items.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            {a.mimeType.startsWith('image/') ? <ImageIcon className="size-4 shrink-0 text-slate-400" /> : <FileText className="size-4 shrink-0 text-slate-400" />}
            <span className="truncate">{a.name}</span>
            <span className="shrink-0 text-xs text-slate-400">{fileSize(a.sizeBytes)}</span>
            {a.context === 'INTERNAL' && <Badge color="amber">Internal</Badge>}
            {a.context === 'INTAKE_PHOTO' && <Badge color="blue">Intake photo</Badge>}
          </span>
          <button className="link shrink-0" onClick={() => downloadFile(`/attachments/${a.id}`, { download: 'true' }, a.name).catch(() => toast.error('Could not download the file'))}>Download</button>
        </li>
      ))}
    </ul>
  );
}

export function AttachmentUploader({ requestId, context = 'REQUEST', onDone, label = 'Upload files', accept }: { requestId: number; context?: AttachmentContext; onDone: () => void; label?: string; accept?: string }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <span className="inline-flex">
      <input type="file" multiple className="sr-only" accept={accept ?? 'image/*,.pdf,.docx,.xlsx,.txt,.log'} disabled={busy}
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []).slice(0, 5);
          e.target.value = '';
          if (!files.length) return;
          setBusy(true);
          try {
            await uploadAttachments(requestId, files, context);
            toast.success(`${files.length} file(s) uploaded`);
            onDone();
          } catch (err) {
            toast.error((err as Error).message);
          } finally {
            setBusy(false);
          }
        }} />
      <Button variant="secondary" size="sm" loading={busy} icon={context === 'INTAKE_PHOTO' ? <Upload className="size-4" /> : <Paperclip className="size-4" />}
        onClick={(e) => (e.currentTarget.previousElementSibling as HTMLInputElement | null)?.click()}>
        {label}
      </Button>
    </span>
  );
}
