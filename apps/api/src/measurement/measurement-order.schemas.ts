import { z } from 'zod';

// S15c — MeasurementOrder (ölçüm sipariş akışı) tRPC input şemaları.

export const MEASUREMENT_TYPE_VALUES = [
  'visual_acuity',
  'intraocular_pressure',
  'refraction',
  'biometry',
  'keratometry',
  'topography',
  'pachymetry',
  'perimetry',
  'fundus_photo',
  'oct',
] as const;

export const measurementOrderCreateSchema = z.object({
  encounterId: z.string().uuid().optional().nullable(),
  patientId: z.string().uuid(),
  requestedTypes: z.array(z.enum(MEASUREMENT_TYPE_VALUES)).min(1, 'en az 1 ölçüm tipi'),
  // Ücretli ölçüm kalemleri (ServiceItem.id, category=measurement). Boş = muayeneye dahil.
  serviceItemIds: z.array(z.string().uuid()).optional().default([]),
  notes: z.string().max(2000).optional().nullable(),
});
export type MeasurementOrderCreateInput = z.infer<typeof measurementOrderCreateSchema>;

export const measurementOrderFulfillSchema = z.object({
  orderId: z.string().uuid(),
  measurements: z
    .array(
      z.object({
        type: z.enum(MEASUREMENT_TYPE_VALUES),
        // S15-PR6 — Göz tarafı zorunlu (yanlış göz cerrahisi önleme).
        eyeSide: z.enum(['od', 'os', 'ou']),
        values: z.record(z.unknown()).optional().default({}),
        measuredAt: z.string().datetime().optional(),
        notes: z.string().max(2000).optional().nullable(),
      }),
    )
    .min(1, 'en az 1 ölçüm sonucu'),
});
export type MeasurementOrderFulfillInput = z.infer<typeof measurementOrderFulfillSchema>;

export const measurementOrderListQuerySchema = z.object({
  status: z
    .enum(['requested', 'awaiting_payment', 'in_progress', 'fulfilled', 'cancelled', 'deferred'])
    .optional(),
  // S16 — Ölçüm hemşiresi "Tamamlanan" sekmesi: bugün fulfilled olanlar (salt-okunur).
  completedToday: z.boolean().optional(),
  // #376 — Tip-bazlı kuyruk filtresi (çok-istasyonlu: OCT masası yalnız oct
  // talepleri). requestedTypes[] içinde bu tip varsa döner.
  requestedType: z.enum(MEASUREMENT_TYPE_VALUES).optional(),
});
export type MeasurementOrderListQuery = z.infer<typeof measurementOrderListQuerySchema>;

// R2 (#724) — Ölçüm talebini ertele: sebep zorunlu (audit + listede görünür).
export const measurementOrderDeferSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().trim().min(3).max(300),
});
export type MeasurementOrderDeferInput = z.infer<typeof measurementOrderDeferSchema>;
