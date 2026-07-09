import { z } from 'zod';

// D1 PR 3 — Admin tRPC input schemas.

const language = z.enum(['tr', 'ru', 'tg']);
const channel = z.enum(['MOCK', 'SMS', 'WHATSAPP', 'EMAIL']);
const category = z.enum(['RANDEVU', 'TETKIK', 'FATURA', 'ONAM', 'DIGER']);

export const adminTriggerListSchema = z.object({
  category: category.optional(),
});

export const adminTriggerConfigSchema = z.object({
  id: z.string().uuid(),
  isEnabled: z.boolean().optional(),
  channels: z.array(channel).min(1).optional(),
  quietHoursStart: z.number().int().min(0).max(23).nullable().optional(),
  quietHoursEnd: z.number().int().min(0).max(23).nullable().optional(),
});

export const adminTemplateListSchema = z.object({
  triggerKey: z.string().max(60).optional(),
  language: language.optional(),
  channelType: channel.optional(),
});

export const adminTemplateUpdateSchema = z.object({
  id: z.string().uuid(),
  subject: z.string().max(200).nullable().optional(),
  body: z.string().min(1).max(2000).optional(),
  isActive: z.boolean().optional(),
});

export const adminDeliveryListSchema = z.object({
  triggerKey: z.string().max(60).optional(),
  status: z.enum(['PENDING', 'SENT', 'DELIVERED', 'FAILED']).optional(),
  recipient: z.string().max(160).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});

export const adminListByPatientSchema = z.object({
  patientId: z.string().uuid(),
});

export type AdminTriggerListQuery = z.infer<typeof adminTriggerListSchema>;
export type AdminTriggerConfigInput = z.infer<typeof adminTriggerConfigSchema>;
export type AdminTemplateListQuery = z.infer<typeof adminTemplateListSchema>;
export type AdminTemplateUpdateInput = z.infer<typeof adminTemplateUpdateSchema>;
export type AdminDeliveryListQuery = z.infer<typeof adminDeliveryListSchema>;
