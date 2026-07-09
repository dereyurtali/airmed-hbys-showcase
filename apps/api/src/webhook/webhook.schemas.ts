import { z } from 'zod';

// S14 — v0.1 webhook port. Zod şemaları.
// Kaynak: v0.1 automation/webhook.* (HMAC-SHA256 signed deliveries + exponential
// retry [1m, 5m, 30m, 2h, 24h] → 5. fail = dead_letter).

// Domain event catalog — şu an pilot için temel set. İleri faz: per-event
// schema validation (payload shape kontrolü).
export const WEBHOOK_EVENTS = [
  'appointment.created',
  'appointment.cancelled',
  'appointment.checked_in',
  'appointment.no_show',
  'invoice.created',
  'invoice.paid',
  'invoice.cancelled',
  'invoice.pending_approval',
  'approval.requested',
  'approval.reviewed',
  'lead.created',
  'patient.created',
] as const;
export const webhookEventSchema = z.enum(WEBHOOK_EVENTS);
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const webhookCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z
    .string()
    .url()
    .max(500)
    .refine((u) => u.startsWith('https://'), 'webhook URL must be https://'),
  events: z.array(webhookEventSchema).min(1, 'en az 1 event seçilmeli').max(20),
});

export const webhookUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  url: z
    .string()
    .url()
    .max(500)
    .refine((u) => u.startsWith('https://'), 'webhook URL must be https://')
    .optional(),
  events: z.array(webhookEventSchema).min(1).max(20).optional(),
  isActive: z.boolean().optional(),
});

export const webhookIdSchema = z.object({ id: z.string().uuid() });

export const webhookDeliveryListQuerySchema = z.object({
  webhookId: z.string().uuid().optional(),
  status: z.enum(['pending', 'delivered', 'failed', 'dead_letter']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const webhookTestFireSchema = z.object({
  id: z.string().uuid(),
  event: webhookEventSchema,
});

export type WebhookCreateInput = z.infer<typeof webhookCreateSchema>;
export type WebhookUpdateInput = z.infer<typeof webhookUpdateSchema>;
export type WebhookDeliveryListQuery = z.infer<typeof webhookDeliveryListQuerySchema>;
export type WebhookTestFireInput = z.infer<typeof webhookTestFireSchema>;
