import { z } from 'zod';

// A8 ameliyat kayıtları — Zod şemaları.
//
// Surgery model A2'de tanımlandı (packages/db/prisma/schema.prisma).
// preOp / intraOp / postOp JSONB freeform — frontend OD/OS, anestezi tipi,
// lens IOL, sarf listesi gibi alanlarla başlar; B1 ile derinleşir.
// doctorId Doctor profile'a referans verir (Examination.doctorId User'a
// referans verirken, Surgery cerrah profile'ını tutar — visiting prof
// senaryosu için doctor.userId nullable).

const isoDateTime = z.string().datetime({ offset: true });

const surgeryStatusEnum = z.enum(['planned', 'performed', 'cancelled', 'postponed', 'refused']);

// S15-PR16 — Yapısal reddi sebebi. Lead funnel + analitik için.
export const surgeryRefusalReasonEnum = z.enum([
  'financial',
  'medical_concern',
  'family',
  'second_opinion',
  'other',
]);

// B1 PR 1 — Yapısal alan enum'ları. EyeSide ve AnesthesiaType DB'de tanımlı;
// burada Zod tarafında string union ile validate. SurgeonRole B1 PR 1'de
// eklendi (E2 hakediş için kritik).
export const eyeSideEnum = z.enum(['od', 'os', 'ou']);
export const anesthesiaTypeEnum = z.enum(['topical', 'local', 'none', 'general', 'periocular']);
export const surgeonRoleEnum = z.enum(['VISITING', 'LOCAL', 'REFERRAL']);

export const surgeryCreateSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  appointmentId: z.string().uuid().optional().nullable(),
  type: z.string().min(1).max(100),
  status: surgeryStatusEnum.optional(),
  scheduledAt: isoDateTime,
  performedAt: isoDateTime.optional().nullable(),
  preOp: z.record(z.unknown()).optional(),
  intraOp: z.record(z.unknown()).optional(),
  postOp: z.record(z.unknown()).optional(),
  complicationFlag: z.boolean().optional(),
  complicationNotes: z.string().max(5000).optional().nullable(),
  // B1 PR 1 — yeni yapısal alanlar (opsiyonel; UI default ile dolduracak)
  eyeSide: eyeSideEnum.optional().nullable(),
  anesthesiaType: anesthesiaTypeEnum.optional().nullable(),
  surgeonRole: surgeonRoleEnum.optional().nullable(),
});

// Update: type/status/scheduledAt/performedAt + 3 JSONB + complication
// alanları editable; patient/doctor/appointment immutable (frontend buralara
// dokunmaz).
export const surgeryUpdateSchema = z.object({
  type: z.string().min(1).max(100).optional(),
  status: surgeryStatusEnum.optional(),
  scheduledAt: isoDateTime.optional(),
  performedAt: isoDateTime.optional().nullable(),
  preOp: z.record(z.unknown()).optional(),
  intraOp: z.record(z.unknown()).optional(),
  postOp: z.record(z.unknown()).optional(),
  complicationFlag: z.boolean().optional(),
  complicationNotes: z.string().max(5000).optional().nullable(),
  // B1 PR 1 — yeni yapısal alanlar
  eyeSide: eyeSideEnum.optional().nullable(),
  anesthesiaType: anesthesiaTypeEnum.optional().nullable(),
  surgeonRole: surgeonRoleEnum.optional().nullable(),
});

// B1 PR 2 — Lens validation 4-aşamalı akış.
// - serialNumber regex `^[A-Z0-9-]{6,20}$`
// - isOverride true ise overrideReason zorunlu (min 10 char)
// - lotId verilmezse + isOverride false → backend stock cross-check zorunlu
export const registerLensSchema = z
  .object({
    surgeryId: z.string().uuid(),
    lotId: z.string().uuid().optional().nullable(),
    serialNumber: z.string().regex(/^[A-Z0-9-]{6,20}$/, 'Serial format: A-Z, 0-9, "-" 6-20 char'),
    barcode: z.string().max(100).optional().nullable(),
    isOverride: z.boolean().default(false),
    overrideReason: z.string().min(10).max(500).optional().nullable(),
  })
  .refine(
    (v) =>
      !v.isOverride ||
      (v.overrideReason !== null &&
        v.overrideReason !== undefined &&
        v.overrideReason.length >= 10),
    {
      message: 'overrideReason required (min 10 char) when isOverride=true',
      path: ['overrideReason'],
    },
  );

// B1 PR 2 — Komplikasyon detail.
export const complicationCategoryEnum = z.enum([
  'macula_edema',
  'endophthalmitis',
  'iol_dislocation',
  'bleeding',
  'retinal_detachment',
  'iris_damage',
  'wound_leak',
  'posterior_capsule_rupture',
  'other',
]);
export const complicationSeverityEnum = z.enum(['mild', 'moderate', 'severe']);
export const markComplicationSchema = z.object({
  surgeryId: z.string().uuid(),
  category: complicationCategoryEnum,
  severity: complicationSeverityEnum,
  description: z.string().min(1).max(2000),
});

export type RegisterLensInput = z.infer<typeof registerLensSchema>;
export type MarkComplicationInput = z.infer<typeof markComplicationSchema>;

// B1 PR 3 — markCompleted: surgery 'performed' state + auto schedule.
export const markCompletedSchema = z.object({
  surgeryId: z.string().uuid(),
  performedAt: isoDateTime.optional().nullable(),
  skipAutoSchedule: z.boolean().default(false),
  slotHour: z.number().int().min(8).max(18).optional(),
});
export type MarkCompletedInput = z.infer<typeof markCompletedSchema>;

// S15-PR16 — Cerrahi reddi (hasta vazgeçti). status=refused + sebep + notlar.
// Service-layer guard: refusalReason='other' ise refusalNotes ≥10 char zorunlu
// (SurgeryService.markRefused içinde kontrol; .refine() tRPC type derinliğini
// patlattığı için burada uygulanmadı).
export const markRefusedSchema = z.object({
  surgeryId: z.string().uuid(),
  refusalReason: surgeryRefusalReasonEnum,
  refusalNotes: z.string().max(500).optional().nullable(),
});
export type MarkRefusedInput = z.infer<typeof markRefusedSchema>;

export const surgeryListQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
  status: surgeryStatusEnum.optional(),
  dateFrom: isoDateTime.optional(),
  dateTo: isoDateTime.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type SurgeryCreateInput = z.infer<typeof surgeryCreateSchema>;
export type SurgeryUpdateInput = z.infer<typeof surgeryUpdateSchema>;
export type SurgeryListQuery = z.infer<typeof surgeryListQuerySchema>;
