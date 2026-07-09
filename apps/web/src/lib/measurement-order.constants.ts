// S15c — MeasurementOrder (ölçüm sipariş akışı) frontend constants.

export const MEASUREMENT_ORDER_STATUSES = [
  'requested',
  'awaiting_payment',
  'in_progress',
  'fulfilled',
  'cancelled',
] as const;

export type MeasurementOrderStatus = (typeof MEASUREMENT_ORDER_STATUSES)[number];

export interface MeasurementOrderStatusMeta {
  badge: string;
  labelKey: string; // i18n: measurementOrder:status.<key>
}

export const MEASUREMENT_ORDER_STATUS_META: Record<
  MeasurementOrderStatus,
  MeasurementOrderStatusMeta
> = {
  requested: { badge: 'bg-blue-100 text-blue-700', labelKey: 'status.requested' },
  awaiting_payment: { badge: 'bg-amber-100 text-amber-700', labelKey: 'status.awaitingPayment' },
  in_progress: { badge: 'bg-cyan-100 text-cyan-700', labelKey: 'status.inProgress' },
  fulfilled: { badge: 'bg-emerald-100 text-emerald-700', labelKey: 'status.fulfilled' },
  cancelled: { badge: 'bg-zinc-100 text-zinc-500', labelKey: 'status.cancelled' },
};
