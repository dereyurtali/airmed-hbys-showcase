import { z } from 'zod';

// A7 muayene kayıtları — Zod şemaları.
//
// Examination model A2'de tanımlandı (packages/db/prisma/schema.prisma).
// findings JSONB freeform — frontend göz spesifik 4 alan (OD/OS görme
// keskinliği, ön segment, fundus) ile başlar, ileri faza yapılandırılır.
// doctorId User'a referans verir (Doctor profile değil) — bu A2 tasarım kararı.

const isoDateTime = z.string().datetime({ offset: true });

export const examinationCreateSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  appointmentId: z.string().uuid().optional().nullable(),
  examinedAt: isoDateTime,
  chiefComplaint: z.string().max(1000).optional().nullable(),
  history: z.string().max(5000).optional().nullable(),
  findings: z.record(z.unknown()).optional(),
  diagnosis: z.string().max(2000).optional().nullable(),
  treatmentPlan: z.string().max(5000).optional().nullable(),
  prescription: z.string().max(5000).optional().nullable(),
  // #379 — taslak akışı: doktor yarım muayeneyi 'draft' kaydeder, sonra 'final'e çevirir.
  status: z.enum(['draft', 'final']).default('final'),
});

// Update: time + clinical fields editable; patient/doctor/appointment
// immutable (frontend buralara dokunmaz).
export const examinationUpdateSchema = z.object({
  examinedAt: isoDateTime.optional(),
  chiefComplaint: z.string().max(1000).optional().nullable(),
  history: z.string().max(5000).optional().nullable(),
  findings: z.record(z.unknown()).optional(),
  diagnosis: z.string().max(2000).optional().nullable(),
  treatmentPlan: z.string().max(5000).optional().nullable(),
  prescription: z.string().max(5000).optional().nullable(),
  // #379 — taslak finalize: draft → final geçişi update ile taşınır.
  status: z.enum(['draft', 'final']).optional(),
});

export const examinationListQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
  dateFrom: isoDateTime.optional(),
  dateTo: isoDateTime.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type ExaminationCreateInput = z.infer<typeof examinationCreateSchema>;
export type ExaminationUpdateInput = z.infer<typeof examinationUpdateSchema>;
export type ExaminationListQuery = z.infer<typeof examinationListQuerySchema>;
