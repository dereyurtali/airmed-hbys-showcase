import { z } from 'zod';

// C3 patient photo — Zod schemas.
//
// Upload goes through REST (multipart) for streaming; metadata operations
// (list / update / softDelete) go through tRPC for type-safety.

const photoTagEnum = z.enum([
  'preop',
  'postop',
  'intraop',
  'oct',
  'fundus',
  'topography',
  'general',
]);

const isoDateTime = z.string().datetime({ offset: true });

export const photoUpdateSchema = z.object({
  tag: photoTagEnum.optional(),
  description: z.string().max(500).optional().nullable(),
  takenAt: isoDateTime.optional().nullable(),
});

export const photoListQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  tag: photoTagEnum.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const photoIdSchema = z.object({ id: z.string().uuid() });
export const photoByPatientSchema = z.object({ patientId: z.string().uuid() });

export type PhotoUpdateInput = z.infer<typeof photoUpdateSchema>;
export type PhotoListQuery = z.infer<typeof photoListQuerySchema>;
