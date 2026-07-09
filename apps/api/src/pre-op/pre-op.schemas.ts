import { z } from 'zod';

// B3 Pre-op — Zod şemaları.
//
// PreOp 1-1 Surgery (surgery_id @unique). Checklist freeform array — her item
// {key, completed, completedById, completedAt, notes}. Default item key listesi
// servisten gelir (DEFAULT_CHECKLIST_KEYS). Klinik kendi anahtarını eklerse
// frontend custom label gösterir.
//
// Vital signs JSONB — bloodSugar/bloodPressure/pulse/weight/temperature/oxygen
// alanlarını öngörüyoruz, ama Zod boş object'i de kabul ediyor (hemşire
// kademeli giriş yapar).

const isoDateTime = z.string().datetime({ offset: true });

export const PRE_OP_CHECKLIST_KEYS = [
  'fasting_8h',
  'blood_sugar',
  'blood_pressure',
  'pupil_dilation',
  'antibiotic_prophylaxis',
  'consent_signed',
  'lens_reserved',
  'surgeon_ready',
  // S15-PR15 — Anestezi konsültasyonu (genel/peribulber/topik karar verilmiş mi)
  'anesthesia_consult_completed',
] as const;

export type PreOpChecklistKey = (typeof PRE_OP_CHECKLIST_KEYS)[number];

// "lens_reserved" yalnızca cataract/IOL gerektiren ameliyatlarda anlamlı;
// markReady gate'inde lensIolLotId set olmadığı sürece bu item zorunlu değil.
export const PRE_OP_OPTIONAL_KEYS: readonly PreOpChecklistKey[] = ['lens_reserved'];

export const checklistItemSchema = z.object({
  key: z.string().min(1).max(50),
  completed: z.boolean(),
  completedById: z.string().uuid().nullable().optional(),
  completedAt: isoDateTime.nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const vitalSignsSchema = z
  .object({
    bloodSugar: z.number().nonnegative().max(2000).optional(),
    systolic: z.number().int().min(40).max(300).optional(),
    diastolic: z.number().int().min(20).max(200).optional(),
    pulse: z.number().int().min(20).max(250).optional(),
    weightKg: z.number().nonnegative().max(500).optional(),
    temperatureC: z.number().min(25).max(45).optional(),
    oxygenSaturation: z.number().int().min(50).max(100).optional(),
  })
  .strict()
  .partial();

export const preOpCreateSchema = z.object({
  surgeryId: z.string().uuid(),
  // create'de checklist + vitaller boş başlayabilir; default checklist key'leri
  // servis tarafından populate edilir.
});

export const preOpUpdateSchema = z.object({
  vitalSigns: vitalSignsSchema.optional(),
  dilatationAt: isoDateTime.nullable().optional(),
  anesthesiaNotes: z.string().max(2000).nullable().optional(),
  // Lens rezervasyonu: lot id verilirse, servis lot'un stoğunu doğrular.
  lensIolLotId: z.string().uuid().nullable().optional(),
});

export const preOpUpdateInputSchema = z.object({
  surgeryId: z.string().uuid(),
  vitalSigns: vitalSignsSchema.optional(),
  dilatationAt: isoDateTime.nullable().optional(),
  anesthesiaNotes: z.string().max(2000).nullable().optional(),
  lensIolLotId: z.string().uuid().nullable().optional(),
});

export const checklistItemPatchSchema = z.object({
  surgeryId: z.string().uuid(),
  key: z.string().min(1).max(50),
  completed: z.boolean(),
  notes: z.string().max(500).nullable().optional(),
});

export const surgeryIdSchema = z.object({ surgeryId: z.string().uuid() });

export type PreOpCreateInput = z.infer<typeof preOpCreateSchema>;
export type PreOpUpdateInput = z.infer<typeof preOpUpdateSchema>;
export type ChecklistItemPatchInput = z.infer<typeof checklistItemPatchSchema>;
export type VitalSignsInput = z.infer<typeof vitalSignsSchema>;
