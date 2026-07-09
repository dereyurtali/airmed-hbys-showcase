import { z } from 'zod';

// A9 ölçüm kayıtları — Zod şemaları.
//
// MeasurementType enum (10 değer) Prisma şemasından gelir; burada literal liste
// olarak tekrar edilir çünkü zod runtime kontrolünü Prisma'dan bağımsız yapmak
// istiyoruz (paket sınırı + tRPC client tarafı tip güvenliği). Yeni tip ekleme
// gerektiğinde her iki yerde de güncellenmeli — A9 plan dokümanında yazılı.
//
// values JSONB freeform; göz kliniği için tipik anahtarlar:
//   visual_acuity:        { od: '0.8', os: '0.7', notation: 'snellen' }
//   intraocular_pressure: { od: 14, os: 15 }                  (mmHg)
//   refraction:           { od: { sph, cyl, axis }, os: {...} }
//   keratometry:          { od: { k1, k2, axis }, os: {...} }
// Frontend bu yapıyı tip-bazlı form ile üretir; backend sadece kayıt için JSON
// olarak saklar (alan-içi şema A9 frontend PR'ında).

export const measurementTypes = [
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

export const measurementTypeSchema = z.enum(measurementTypes);

// S15-PR6 — Yanlış göz cerrahisi önleme: ölçüm kaydında göz tarafı yapısal
// zorunlu (Prisma EyeSide enum: od/os/ou). Form default 'ou' (her iki göz)
// ama input'ta her zaman gönderilir; backend ek bir guard atmaz, zod enum
// validation yeterli.
export const eyeSideSchema = z.enum(['od', 'os', 'ou']);

const isoDateTime = z.string().datetime({ offset: true });

export const measurementCreateSchema = z.object({
  patientId: z.string().uuid(),
  type: measurementTypeSchema,
  eyeSide: eyeSideSchema,
  measuredAt: isoDateTime,
  values: z.record(z.unknown()).default({}),
  notes: z.string().max(1000).optional().nullable(),
});

// Update: measuredAt + values + notes editable. patient/type immutable (yanlış
// tipte kaydı düzeltmek için kullanıcı silip yeniden ekler — type değişirse
// tarihsel grafik bozulur).
export const measurementUpdateSchema = z.object({
  eyeSide: eyeSideSchema.optional(),
  measuredAt: isoDateTime.optional(),
  values: z.record(z.unknown()).optional(),
  notes: z.string().max(1000).optional().nullable(),
});

export const measurementListQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  type: measurementTypeSchema.optional(),
  dateFrom: isoDateTime.optional(),
  dateTo: isoDateTime.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type MeasurementCreateInput = z.infer<typeof measurementCreateSchema>;
export type MeasurementUpdateInput = z.infer<typeof measurementUpdateSchema>;
export type MeasurementListQuery = z.infer<typeof measurementListQuerySchema>;
export type MeasurementTypeKey = z.infer<typeof measurementTypeSchema>;
