// C1 IOL Inventory — frontend sabitleri + helper'lar.

export const IOL_MOVEMENT_TYPES = ['receive', 'consume', 'adjust', 'return', 'expire'] as const;
export type IolMovementType = (typeof IOL_MOVEMENT_TYPES)[number];

// Düşük stok eşiği (default) — UI badge için.
export const DEFAULT_LOW_STOCK_THRESHOLD = 3;

// Son kullanma uyarı eşiği — issue scope: 60 gün.
export const EXPIRY_WARNING_DAYS = 60;

export function daysUntil(d: string | Date): number {
  const target = typeof d === 'string' ? new Date(d) : d;
  const diff = target.getTime() - Date.now();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export function expiryBadge(expiresAt: string | Date): 'expired' | 'warn' | 'ok' {
  const days = daysUntil(expiresAt);
  if (days < 0) return 'expired';
  if (days <= EXPIRY_WARNING_DAYS) return 'warn';
  return 'ok';
}

export function stockBadge(
  quantity: number,
  threshold = DEFAULT_LOW_STOCK_THRESHOLD,
): 'empty' | 'low' | 'ok' {
  if (quantity <= 0) return 'empty';
  if (quantity <= threshold) return 'low';
  return 'ok';
}
