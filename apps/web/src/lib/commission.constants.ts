// E2 Doktor Hakediş — frontend sabitleri.

export const COMMISSION_RULE_TYPES = ['per_surgery', 'percentage'] as const;
export type CommissionRuleType = (typeof COMMISSION_RULE_TYPES)[number];

export const COMMISSION_ENTRY_STATUSES = ['pending', 'approved', 'paid', 'cancelled'] as const;
export type CommissionEntryStatus = (typeof COMMISSION_ENTRY_STATUSES)[number];

export const COMMISSION_SOURCE_TYPES = ['surgery', 'procedure'] as const;
export type CommissionSourceType = (typeof COMMISSION_SOURCE_TYPES)[number];

export const SUPPORTED_CURRENCIES = ['USD', 'TJS', 'EUR'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export const PAYMENT_METHODS = ['bank_transfer', 'cash', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function formatCurrency(amount: number | string, currency: string, locale: string): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return String(amount);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}
