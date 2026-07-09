import { z } from 'zod';

// I2.3 (#821) — Geri-Bildirim Merkezi şemaları.

export const feedbackKindSchema = z.enum(['bug', 'improvement', 'question']);

export const feedbackCreateSchema = z.object({
  kind: feedbackKindSchema,
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(5000),
  // Otomatik yakalanan bağlam (frontend doldurur; scrubed).
  routePath: z.string().max(200).default('/'),
  appVersion: z.string().max(40).default('unknown'),
  contextJson: z.record(z.unknown()).default({}),
});
export type FeedbackCreateInput = z.infer<typeof feedbackCreateSchema>;

export const feedbackListQuerySchema = z.object({
  mineOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(100).default(50),
});
export type FeedbackListQuery = z.infer<typeof feedbackListQuerySchema>;
