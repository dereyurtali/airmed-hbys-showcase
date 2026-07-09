import { z } from 'zod';

// B2 Tetkik (Lab) — Zod şemaları.
//
// `source` ile internal/external ayrılır. Internal: results JSONB
// yapılandırılmış. External: results serbest + opsiyonel dosya (REST upload
// via multipart, photo modülünün StorageService'i ile aynı pattern).

export const LAB_TEST_TYPES = [
  'visual_field',
  'oct_macula',
  'oct_optic_nerve',
  'topography',
  'pachymetry',
  'biometry',
  'fluorescein_angiography',
  'iop_curve',
  'blood_test',
  'ekg',
  'chest_xray',
  'urinalysis',
  'other',
] as const;

export const labTestTypeSchema = z.enum(LAB_TEST_TYPES);

export const labTestSourceSchema = z.enum(['internal', 'external']);

const isoDateTime = z.string().datetime({ offset: true });

export const labTestCreateSchema = z.object({
  patientId: z.string().uuid(),
  source: labTestSourceSchema,
  testType: labTestTypeSchema,
  performedAt: isoDateTime,
  results: z.record(z.unknown()).default({}),
  notes: z.string().max(2000).optional().nullable(),
  externalLab: z.string().max(200).optional().nullable(),
});

export const labTestUpdateSchema = z.object({
  testType: labTestTypeSchema.optional(),
  performedAt: isoDateTime.optional(),
  results: z.record(z.unknown()).optional(),
  notes: z.string().max(2000).optional().nullable(),
  externalLab: z.string().max(200).optional().nullable(),
});

export const labTestListQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  testType: labTestTypeSchema.optional(),
  source: labTestSourceSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const labTestIdSchema = z.object({ id: z.string().uuid() });
export const labTestByPatientSchema = z.object({ patientId: z.string().uuid() });

export type LabTestCreateInput = z.infer<typeof labTestCreateSchema>;
export type LabTestUpdateInput = z.infer<typeof labTestUpdateSchema>;
export type LabTestListQuery = z.infer<typeof labTestListQuerySchema>;
