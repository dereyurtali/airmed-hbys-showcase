// S11d — Billing modülü constants + formatters.

import { Banknote, CreditCard, Landmark, ShieldCheck, type LucideIcon } from 'lucide-react';

export const CURRENCIES = ['TJS', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'insurance'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const SERVICE_CATEGORIES = [
  'examination',
  'surgery',
  'procedure',
  'lab',
  'measurement',
  'other',
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const INVOICE_STATUSES = [
  'open',
  'partial',
  'paid',
  'cancelled',
  'refunded',
  'pending_approval',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface FormatMoneyOptions {
  /** min & max ondalık hane (default 2). KPI/delta tam-sayı gösterimi için 0 geç. */
  fractionDigits?: number;
}

// Para formatı — TÜM tutarların tek kaynağı (SİS-9). Her iki birim de AKTİF
// locale ile formatlanır → aynı ekranda TJS ondalık virgül / USD ondalık nokta
// çatışması olmaz. USD'de $ sembolü Intl'den gelir; TJS'de yerel sembol
// olmadığından "TJS" suffix. Negatif değerin işaretini Intl kendisi koyar.
export function formatMoney(
  amount: string | number,
  currency: Currency,
  locale = 'tr-TR',
  options: FormatMoneyOptions = {},
): string {
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (Number.isNaN(value)) return '—';
  const digits = options.fractionDigits ?? 2;
  if (currency === 'USD') {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  }
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)} TJS`;
}

// Bölüm 24 — fatura durumu = tint + ince kenar + metin (semantik token).
export const INVOICE_STATUS_COLORS: Record<InvoiceStatus, string> = {
  open: 'border border-warning-border bg-warning-bg text-warning-foreground',
  partial: 'border border-warning-border bg-warning-bg text-warning-foreground',
  paid: 'border border-success-border bg-success-bg text-success-foreground',
  cancelled: 'bg-[color:var(--neutral-tint)] text-muted-foreground',
  refunded: 'border border-critical-border bg-critical-bg text-critical-foreground',
  pending_approval: 'border border-info-border bg-info-bg text-info-foreground',
};

export const PAYMENT_METHOD_ICONS: Record<PaymentMethod, LucideIcon> = {
  cash: Banknote,
  card: CreditCard,
  transfer: Landmark,
  insurance: ShieldCheck,
};

// v0.4.2 Karar 4 (#725) — bir kategorinin "tek default" kalemi: aktif kalemler
// içinden en düşük sortOrder. Resepsiyon "Geldi + Tahsilat"ta randevu tipine göre
// faturaya otomatik kalem koymak için kullanılır (sonra düzenlenebilir). Saf fonksiyon
// (DB/React yok) → test edilebilir. category null veya kategoride aktif kalem yoksa null.
export function pickDefaultServiceItem<
  T extends { category: string; isActive: boolean; sortOrder: number },
>(items: readonly T[], category: string | null): T | null {
  if (!category) return null;
  const inCategory = items.filter((i) => i.isActive && i.category === category);
  if (inCategory.length === 0) return null;
  return inCategory.reduce((best, cur) => (cur.sortOrder < best.sortOrder ? cur : best));
}
