import { z } from 'zod';

// B5 Procedure — IVT, YAG, Argon, Retina lazer PRP, SLT, cross-linking, minor.
// Surgery'den ayrı poliklinik prosedürleri; type-bazlı detay alanı `settings`.

export const PROCEDURE_TYPES = [
  'intravitreal_injection',
  'yag_capsulotomy',
  'argon_laser',
  'retina_laser_prp',
  'slt',
  'cross_linking',
  'minor',
] as const;
export const procedureTypeSchema = z.enum(PROCEDURE_TYPES);

export const PROCEDURE_STATUSES = ['planned', 'performed', 'cancelled'] as const;
export const procedureStatusSchema = z.enum(PROCEDURE_STATUSES);

export const EYE_SIDES = ['od', 'os', 'ou'] as const;
export const eyeSideSchema = z.enum(EYE_SIDES);

export const ANESTHESIA_TYPES = ['topical', 'local', 'none'] as const;
export const anesthesiaTypeSchema = z.enum(ANESTHESIA_TYPES);

// Type-bazlı serbest detay JSON; her form kendi parser'ını kullanır.
// Çok büyük JSON'u DB'de tutmamak için boyutu kabaca sınırlıyoruz.
const settingsSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .refine((obj) => JSON.stringify(obj).length <= 2000, 'settings too large')
  .default({});

export const procedureCreateSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  appointmentId: z.string().uuid().optional().nullable(),
  type: procedureTypeSchema,
  eyeSide: eyeSideSchema,
  anesthesia: anesthesiaTypeSchema.default('topical'),
  drugUsed: z.string().trim().max(150).optional().nullable(),
  drugDose: z.string().trim().max(50).optional().nullable(),
  settings: settingsSchema,
  findings: z.string().max(2000).optional().nullable(),
  complications: z.string().max(2000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  performedAt: z.string().datetime(),
  // Otomatik 1 hafta kontrol randevusu oluştursun mu?
  autoScheduleFollowUp: z.boolean().default(true),
  followUpDaysFromNow: z.coerce.number().int().min(1).max(60).default(7),
  status: procedureStatusSchema.default('performed'),
  // #372 — Prosedürde kullanılan sarf malzemeler → stoktan düşülür (best-effort).
  consumablesUsed: z
    .array(z.object({ consumableId: z.string().uuid(), qty: z.coerce.number().int().min(1) }))
    .optional(),
});

export const procedureUpdateSchema = z.object({
  status: procedureStatusSchema.optional(),
  drugUsed: z.string().trim().max(150).optional().nullable(),
  drugDose: z.string().trim().max(50).optional().nullable(),
  settings: settingsSchema.optional(),
  findings: z.string().max(2000).optional().nullable(),
  complications: z.string().max(2000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export const procedureListQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
  type: procedureTypeSchema.optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const procedureIdSchema = z.object({ id: z.string().uuid() });

export const procedureSeriesQuerySchema = z.object({
  patientId: z.string().uuid(),
  type: procedureTypeSchema.optional(),
});

export type ProcedureCreateInput = z.infer<typeof procedureCreateSchema>;
export type ProcedureUpdateInput = z.infer<typeof procedureUpdateSchema>;
export type ProcedureListQuery = z.infer<typeof procedureListQuerySchema>;
export type ProcedureSeriesQuery = z.infer<typeof procedureSeriesQuerySchema>;
