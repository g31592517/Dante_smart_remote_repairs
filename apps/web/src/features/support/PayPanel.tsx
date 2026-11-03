import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CreditCard } from 'lucide-react';
import { api } from '../../lib/api';
import { majorToMinor, useMoney, useSettings } from '../../lib/settings';
import { useToast } from '../../components/toast';
import { Alert, Button, Input, Select, errorMessage } from '../../components/ui';

/**
 * How a customer settles an outstanding amount: online (only when a gateway is configured server-side),
 * or by reporting a bank-transfer / mobile-money payment that finance verifies. Payment is never
 * marked as paid by the browser.
 */
export function PayPanel({ payableType, payableId, outstandingMinor, onDone }: { payableType: 'SALES_ORDER' | 'SUPPORT_REQUEST'; payableId: number; outstandingMinor: number; onDone: () => void }) {
  const money = useMoney();
  const toast = useToast();
  const { data: settings } = useSettings();
  const digits = settings?.currencyMinorDigits ?? 2;
  const [method, setMethod] = useState<'BANK_TRANSFER' | 'MOBILE_MONEY'>('MOBILE_MONEY');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState((outstandingMinor / 10 ** digits).toFixed(digits));

  const online = useMutation({
    mutationFn: () => api<{ checkoutUrl: string }>('/payments/checkout', { body: { payableType, payableId } }),
    onSuccess: (r) => window.location.assign(r.checkoutUrl),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const claim = useMutation({
    mutationFn: () => api('/payments/claims', { body: { payableType, payableId, method, amountMinor: majorToMinor(amount, digits), reference } }),
    onSuccess: () => {
      toast.success('Thank you — we will confirm your payment shortly');
      setReference('');
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const offline = settings?.enabledPaymentMethods.filter((m): m is 'BANK_TRANSFER' | 'MOBILE_MONEY' => m === 'BANK_TRANSFER' || m === 'MOBILE_MONEY') ?? [];
  return (
    <div className="space-y-4">
      <p className="text-sm">Outstanding: <span className="font-display text-lg font-semibold">{money(outstandingMinor)}</span></p>
      {settings?.onlinePaymentAvailable && (
        <Button variant="accent" icon={<CreditCard className="size-4" />} loading={online.isPending} onClick={() => online.mutate()}>Pay online</Button>
      )}
      {offline.length > 0 && (
        <form className="space-y-3 rounded-xl border border-ink-100 p-4" onSubmit={(e) => { e.preventDefault(); claim.mutate(); }}>
          <p className="text-sm font-semibold">Paid by transfer or mobile money? Tell us the reference</p>
          <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)} options={offline.map((m) => ({ value: m, label: m === 'BANK_TRANSFER' ? 'Bank transfer' : 'Mobile money' }))} />
          <Alert kind="info">{method === 'BANK_TRANSFER' ? settings?.bankTransferInstructions : settings?.mobileMoneyInstructions}</Alert>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Amount paid" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Input label="Transaction reference" required minLength={3} value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <Button type="submit" size="sm" loading={claim.isPending} disabled={reference.trim().length < 3}>Submit for verification</Button>
        </form>
      )}
      {settings?.enabledPaymentMethods.some((m) => m === 'CASH' || m === 'CARD_ON_SITE') && <p className="text-xs text-slate-500">You can also pay by cash or card at our office.</p>}
    </div>
  );
}
