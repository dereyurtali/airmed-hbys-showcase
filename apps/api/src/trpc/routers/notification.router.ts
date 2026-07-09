import { z } from 'zod';
import { notificationListQuerySchema } from '../../notification/notification.schemas';
import { NotificationService } from '../../notification/notification.service';
import { protectedProcedure, router } from '../trpc';

const idInput = z.object({ id: z.string().uuid() });

// S15b — Notification. Her kullanıcı yalnız kendi bildirimlerini okur/işaretler;
// servis ctx.user.sub ile scope'lar. protectedProcedure yeterli (rol kapısı yok,
// kişi kapısı servis katmanında).
export const notificationRouterFactory = (notifications: NotificationService) =>
  router({
    list: protectedProcedure
      .input(notificationListQuerySchema)
      .query(({ input, ctx }) => notifications.listForUser(ctx.user!.sub, input)),

    unreadCount: protectedProcedure.query(({ ctx }) => notifications.unreadCount(ctx.user!.sub)),

    markRead: protectedProcedure
      .input(idInput)
      .mutation(({ input, ctx }) => notifications.markRead(input.id, ctx.user!.sub)),

    markAllRead: protectedProcedure.mutation(({ ctx }) => notifications.markAllRead(ctx.user!.sub)),
  });
