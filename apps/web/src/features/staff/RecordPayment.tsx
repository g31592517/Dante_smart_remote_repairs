import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Banknote } from 'lucide-react';
import { PAYMENT_METHOD_LABELS } from '@dante/shared';
import { api } from '../../lib/api';
import { majorToMinor, useMoney, useSettings } from '../../lib/settings';
import { useToast } from '../../components/toast';
import { Button, Input, Modal, Select, errorMessage } from '../../components/ui';

/** Finance/staff: record an offline payment that has been received and verified. */
export function RecordPaymentButton({ payableType, payableId, outstandingMinor, onDone }: { payableType: 'SALES_ORDER' | 'SUPPORT_REQUEST'; payableId: number; outstandingMinor: number; onDone: () => void }) {
  const money = useMoney();
  const toast = useToast();
  const { data: s } = useSettings();
  const digits = s?.currencyMinorDigits ?? 2;
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState((outstandingMinor / 10 ** digits).toFixed(digits));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () => api('/payments/record', { body: { payableType, payableId, method, amountMinor: majorToMinor(amount, digits), reference, note: note || undefined } }),
    onSuccess: () => { toast.success('Payment recorded'); setOpen(false); onDone(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <Button size="sm" variant="secondary" icon={<Banknote className="size-4" />} onClick={() => setOpen(true)}>Record payment</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Record a received payment"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={save.isPending} disabled={reference.trim().length < 1} onClick={() => save.mutate()}>Record payment</Button></>}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Outstanding: <strong>{money(outstandingMinor)}</strong>. Only record money that has actually been received.</p>
          <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value)} options={(['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CARD_ON_SITE'] as const).map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} />
          <Input label="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input label="Receipt / transaction reference" required value={reference} onChange={(e) => setReference(e.target.value)} hint="Each reference can be recorded only once" />
          <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </Modal>
    </>
  );
}
