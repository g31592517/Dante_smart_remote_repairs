/**
 * Money is stored and computed as integer MINOR units (e.g. cents) to avoid floating-point error.
 * The number of minor digits comes from the configured currency (system setting `currency`).
 */
export interface CurrencyConfig {
  code: string; // ISO 4217, e.g. "KES", "USD"
  minorDigits: number; // 2 for most currencies, 0 for e.g. UGX/JPY
}

export function toMinor(major: number, digits = 2): number {
  return Math.round(major * 10 ** digits);
}

export function fromMinor(minor: number, digits = 2): number {
  return minor / 10 ** digits;
}

export function formatMoney(minor: number, currency: CurrencyConfig, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.code,
      minimumFractionDigits: currency.minorDigits,
      maximumFractionDigits: currency.minorDigits,
    }).format(fromMinor(minor, currency.minorDigits));
  } catch {
    return `${currency.code} ${fromMinor(minor, currency.minorDigits).toFixed(currency.minorDigits)}`;
  }
}

/** Tax on a minor-unit amount. `rateBasisPoints`: 1600 = 16.00%. Rounds half up. */
export function taxOf(amountMinor: number, rateBasisPoints: number, inclusive: boolean): number {
  if (rateBasisPoints <= 0) return 0;
  if (inclusive) {
    // tax portion already contained in amount: amount - amount / (1 + r)
    return Math.round(amountMinor - (amountMinor * 10000) / (10000 + rateBasisPoints));
  }
  return Math.round((amountMinor * rateBasisPoints) / 10000);
}

export interface Totals {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export function computeTotals(lineTotalsMinor: number[], rateBasisPoints: number, inclusive: boolean, extraMinor = 0): Totals {
  const subtotal = lineTotalsMinor.reduce((a, b) => a + b, 0) + extraMinor;
  const tax = taxOf(subtotal, rateBasisPoints, inclusive);
  return { subtotalMinor: subtotal, taxMinor: tax, totalMinor: inclusive ? subtotal : subtotal + tax };
}
