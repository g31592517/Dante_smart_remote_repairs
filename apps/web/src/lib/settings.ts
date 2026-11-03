import { useQuery } from '@tanstack/react-query';
import { formatMoney, type PaymentMethod } from '@dante/shared';
import { api } from './api';

export interface PublicSettings {
  businessName: string;
  contactEmail: string;
  contactPhone: string;
  contactAddress: string;
  supportHours: string;
  currencyCode: string;
  currencyMinorDigits: number;
  taxRateBasisPoints: number;
  taxLabel: string;
  taxInclusive: boolean;
  deliveryFeeMinor: number;
  anydeskDownloadUrl: string;
  remoteConsentVersion: string;
  remoteConsentText: string;
  intakeTermsText: string;
  termsOfServiceText: string;
  privacyNoticeText: string;
  termsVersion: string;
  enabledPaymentMethods: PaymentMethod[];
  bankTransferInstructions: string;
  mobileMoneyInstructions: string;
  onlinePaymentAvailable: boolean;
}

export function useSettings() {
  return useQuery({ queryKey: ['settings', 'public'], queryFn: () => api<PublicSettings>('/settings/public'), staleTime: 5 * 60_000 });
}

/** Formats minor units in the configured currency. */
export function useMoney() {
  const { data } = useSettings();
  return (minor: number | null | undefined) =>
    minor === null || minor === undefined ? '—' : formatMoney(minor, { code: data?.currencyCode ?? 'USD', minorDigits: data?.currencyMinorDigits ?? 2 });
}

export function majorToMinor(major: string | number, digits: number) {
  const n = typeof major === 'number' ? major : Number(String(major).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 10 ** digits) : 0;
}
