import { z } from 'zod';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// #1049 — hasta-facing 3-dil kısa tanıtım (EPIC #1052 Karar 3).
const doctorBioSchema = z.object({
  tr: z.string().max(2000).optional(),
  ru: z.string().max(2000).optional(),
  tg: z.string().max(2000).optional(),
});

export const doctorCreateSchema = z.object({
  name: z.string().min(2).max(200),
  specialty: z.string().min(1).max(100),
  type: z.enum(['local', 'visiting', 'referral']).default('local'),
  // #1049 — hasta-facing profil alanları. Yayın yalnız publicProfile=true
  // iken (ve isActive ile AND'lenerek) yapılır; CV/döküman bu sete girmez.
  title: z.string().trim().min(2).max(100).optional().nullable(),
  bio: doctorBioSchema.optional().nullable(),
  languages: z.array(z.string().trim().min(2).max(30)).max(10).optional(),
  publicProfile: z.boolean().optional(),
  contactPhone: z
    .string()
    .min(4)
    .max(20)
    .regex(/^(?=[^0-9]*\d)[+0-9 ()-]+$/, 'Phone must contain digits and only +, spaces, parens')
    .optional()
    .nullable(),
  contactEmail: z.string().email().max(255).optional().nullable(),
  // Decimal as string keeps Prisma's Decimal happy without float drift; we
  // accept a 0..100 range, two decimals.
  commissionRate: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === 'string' ? v : v.toFixed(2)))
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'commissionRate must be a 0-100 decimal')
    .refine((v) => Number(v) >= 0 && Number(v) <= 100, 'commissionRate must be between 0 and 100')
    .optional()
    .nullable(),
  isActive: z.boolean().default(true),
  notes: z.string().max(2000).optional().nullable(),
});

export const doctorUpdateSchema = doctorCreateSchema.partial();

export const doctorListQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  specialty: z.string().trim().min(1).max(100).optional(),
  type: z.enum(['local', 'visiting', 'referral']).optional(),
  isActive: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const availabilitySlotSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string().regex(HHMM, 'startTime must be HH:MM'),
    endTime: z.string().regex(HHMM, 'endTime must be HH:MM'),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.startTime < v.endTime, {
    message: 'startTime must be before endTime',
    path: ['endTime'],
  });

// Replace-all semantics: the editor sends the full weekly schedule; service
// upserts/deletes accordingly. Keeps the wire shape simple — no per-row
// patch protocol.
export const setAvailabilitySchema = z.object({
  slots: z.array(availabilitySlotSchema).max(50),
});

export type DoctorCreateInput = z.infer<typeof doctorCreateSchema>;
export type DoctorUpdateInput = z.infer<typeof doctorUpdateSchema>;
export type DoctorListQuery = z.infer<typeof doctorListQuerySchema>;
export type AvailabilitySlotInput = z.infer<typeof availabilitySlotSchema>;
export type SetAvailabilityInput = z.infer<typeof setAvailabilitySchema>;

// A5 izin/tatil
const isoDateTime = z.string().datetime({ offset: true });

export const leaveCreateSchema = z
  .object({
    doctorId: z.string().uuid(),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    reason: z.string().max(500).optional().nullable(),
  })
  .refine((v) => new Date(v.startsAt) < new Date(v.endsAt), {
    message: 'startsAt must be before endsAt',
    path: ['endsAt'],
  });

// `from` opsiyonel: verilmezse "şu andan itibaren" izinler döner. UI
// genelde aktif + gelecek izinleri listeliyor, geçmiş izinler aramak
// için `from` geriye doğru geçilebilir.
export const leaveListQuerySchema = z.object({
  doctorId: z.string().uuid(),
  from: isoDateTime.optional(),
});

// Schedule view: belirli aralıktaki tüm izinleri çek (doctor opsiyonel).
export const leaveRangeQuerySchema = z
  .object({
    doctorId: z.string().uuid().optional(),
    dateFrom: isoDateTime,
    dateTo: isoDateTime,
  })
  .refine((v) => new Date(v.dateFrom) < new Date(v.dateTo), {
    message: 'dateFrom must be before dateTo',
    path: ['dateTo'],
  });

export type LeaveCreateInput = z.infer<typeof leaveCreateSchema>;
export type LeaveListQuery = z.infer<typeof leaveListQuerySchema>;
export type LeaveRangeQuery = z.infer<typeof leaveRangeQuerySchema>;

// #1047 — Misafir doktor geliş penceresi (VisitingWindow) CRUD. Leave
// şemalarının ikizi; pencere tarih-bazlı mutlak aralıktır (mesai değil).
export const visitingWindowCreateSchema = z
  .object({
    doctorId: z.string().uuid(),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    notes: z.string().max(500).optional().nullable(),
  })
  .refine((v) => new Date(v.startsAt) < new Date(v.endsAt), {
    message: 'startsAt must be before endsAt',
    path: ['endsAt'],
  });

// `from` opsiyonel: verilmezse aktif + gelecek pencereler (yarısı geçmiş
// pencere hâlâ aktif sayılır — leave listesiyle aynı konvansiyon).
export const visitingWindowListQuerySchema = z.object({
  doctorId: z.string().uuid(),
  from: isoDateTime.optional(),
});

// Takvim overlay: aralıktaki tüm pencereler (doctor opsiyonel) —
// findLeavesInRange ikizi.
export const visitingWindowRangeQuerySchema = z
  .object({
    doctorId: z.string().uuid().optional(),
    dateFrom: isoDateTime,
    dateTo: isoDateTime,
  })
  .refine((v) => new Date(v.dateFrom) < new Date(v.dateTo), {
    message: 'dateFrom must be before dateTo',
    path: ['dateTo'],
  });

export type VisitingWindowCreateInput = z.infer<typeof visitingWindowCreateSchema>;
export type VisitingWindowListQuery = z.infer<typeof visitingWindowListQuerySchema>;
export type VisitingWindowRangeQuery = z.infer<typeof visitingWindowRangeQuerySchema>;
