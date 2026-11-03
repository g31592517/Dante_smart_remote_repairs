import type { PaymentMethod } from '@dante/shared';

/**
 * Platform settings and their defaults. Stored in `system_settings` (one row per key) and editable by
 * admins. Currency, tax and payment methods are deliberately neutral until the operating market is
 * confirmed (no country-specific assumptions).
 */
export interface PlatformSettings {
  businessName: string;
  contactEmail: string;
  contactPhone: string;
  contactAddress: string;
  supportHours: string;
  currencyCode: string;
  currencyMinorDigits: number;
  taxRateBasisPoints: number; // 0 = no tax until configured
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
  quotationDefaultValidDays: number;
  enabledPaymentMethods: PaymentMethod[];
  bankTransferInstructions: string;
  mobileMoneyInstructions: string;
}

export const DEFAULT_SETTINGS: PlatformSettings = {
  businessName: 'Dante Smart Remote Repairs',
  contactEmail: 'support@example.com',
  contactPhone: '+000 000 000 000',
  contactAddress: 'Set your business address in Admin → Settings',
  supportHours: 'Mon–Fri 08:00–18:00, Sat 09:00–13:00',
  currencyCode: 'USD',
  currencyMinorDigits: 2,
  taxRateBasisPoints: 0,
  taxLabel: 'Tax',
  taxInclusive: false,
  deliveryFeeMinor: 0,
  anydeskDownloadUrl: 'https://anydesk.com/en/downloads',
  remoteConsentVersion: 'remote-v1',
  remoteConsentText:
    'I authorise the assigned technician to connect to my device using AnyDesk for the purpose of the support request ' +
    'referenced above only. I understand that AnyDesk will ask me to accept the incoming connection, that I can watch ' +
    'everything the technician does, and that I can end the session at any time by closing AnyDesk or withdrawing this ' +
    'authorisation on the request page. I will not share my AnyDesk password or unattended-access password with anyone. ' +
    'I have saved my open work and understand the technician may need to restart applications or the device.',
  intakeTermsText:
    'I confirm that the device described above, in the condition recorded, together with the listed accessories, has ' +
    'been handed over for diagnosis and repair. No chargeable repair work will be performed without my approval of a ' +
    'quotation. I am responsible for backing up my data.',
  termsOfServiceText:
    'These are placeholder terms of service. The business must replace them with its own terms before going live ' +
    '(Admin → Settings → Legal texts).',
  privacyNoticeText:
    'This is a placeholder privacy notice. The business must replace it with its own notice describing what personal ' +
    'data is collected, why, for how long it is kept and how customers can exercise their rights.',
  termsVersion: 'terms-v1',
  quotationDefaultValidDays: 14,
  enabledPaymentMethods: ['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CARD_ON_SITE'],
  bankTransferInstructions: 'Bank transfer details are provided by the business. Use your order or request reference as the payment reference.',
  mobileMoneyInstructions: 'Mobile money details are provided by the business. Use your order or request reference as the payment reference.',
};

/** Settings that are safe to show to anyone (homepage, checkout, remote-support instructions). */
export const PUBLIC_SETTING_KEYS: (keyof PlatformSettings)[] = [
  'businessName', 'contactEmail', 'contactPhone', 'contactAddress', 'supportHours', 'currencyCode',
  'currencyMinorDigits', 'taxRateBasisPoints', 'taxLabel', 'taxInclusive', 'deliveryFeeMinor', 'anydeskDownloadUrl',
  'remoteConsentVersion', 'remoteConsentText', 'intakeTermsText', 'termsOfServiceText', 'privacyNoticeText',
  'termsVersion', 'enabledPaymentMethods', 'bankTransferInstructions', 'mobileMoneyInstructions',
];
