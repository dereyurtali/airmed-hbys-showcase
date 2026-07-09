import { z } from 'zod';
import { leadSourceSchema } from '../patient/patient.schemas';

export const leadFunnelQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const leadListQuerySchema = z.object({
  source: leadSourceSchema.optional().nullable(),
  // S15-PR16 sonrası: surgery_refused stage (hasta cerrahi öneriyi reddetti).
  stage: z
    .enum(['lead', 'appointment', 'examination', 'surgery', 'surgery_refused'])
    .default('lead'),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const leadSetSourceSchema = z.object({
  patientId: z.string().uuid(),
  source: leadSourceSchema.nullable(),
  note: z.string().max(255).nullable().optional(),
});

export type LeadFunnelQuery = z.infer<typeof leadFunnelQuerySchema>;
export type LeadListQuery = z.infer<typeof leadListQuerySchema>;
export type LeadSetSourceInput = z.infer<typeof leadSetSourceSchema>;
