import { z } from 'zod';

// A11 dashboard metric — Zod şemaları.
//
// Dashboard sorguları tarih aralığı + opsiyonel doktor filtresi alır.
// dateFrom/dateTo ISO datetime (UTC). pageSize yok; özet veridir.

const isoDateTime = z.string().datetime({ offset: true });

export const metricRangeSchema = z.object({
  dateFrom: isoDateTime,
  dateTo: isoDateTime,
  doctorId: z.string().uuid().optional(),
});

export const metricTrendSchema = metricRangeSchema.extend({
  bucket: z.enum(['day', 'week', 'month']).default('day'),
});

// E5 ek raporlar
export const cohortSchema = z.object({
  months: z.coerce.number().int().min(1).max(36).default(12),
});

export const retentionSchema = z.object({
  cohortMonths: z.coerce.number().int().min(1).max(36).default(12),
  lookAheadDays: z.coerce.number().int().min(1).max(365).default(90),
});

export const heatmapSchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  doctorId: z.string().uuid().optional(),
});

// #402 — Aylık ciro raporu (tahsilat TJS karşılığı, son N ay).
export const revenueTrendSchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(6),
});

export type MetricRangeInput = z.infer<typeof metricRangeSchema>;
export type MetricTrendInput = z.infer<typeof metricTrendSchema>;
export type CohortInput = z.infer<typeof cohortSchema>;
export type RetentionInput = z.infer<typeof retentionSchema>;
export type HeatmapInput = z.infer<typeof heatmapSchema>;
export type RevenueTrendInput = z.infer<typeof revenueTrendSchema>;
