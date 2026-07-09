import { z } from 'zod';

// S15b — Notification (uygulama-içi bildirim) tRPC input şemaları.

export const notificationListQuerySchema = z.object({
  unreadOnly: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(100).optional().default(30),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
