import { FeedbackService } from '../../feedback/feedback.service';
import { feedbackCreateSchema, feedbackListQuerySchema } from '../../feedback/feedback.schemas';
import { permissionProcedure, router } from '../trpc';

// I2.3 (#821) — Geri-Bildirim Merkezi router. create = action:feedback.create;
// list (İsteklerim) = page:feedbackCenter. Yetki #819'da.
const actorOf = (ctx: { user?: { sub: string; roles: readonly string[] } }) => ({
  id: ctx.user!.sub,
  roles: ctx.user!.roles,
});

export const feedbackRouterFactory = (svc: FeedbackService) =>
  router({
    create: permissionProcedure('action:feedback.create')
      .input(feedbackCreateSchema)
      .mutation(({ input, ctx }) => svc.create(input, actorOf(ctx))),
    list: permissionProcedure('page:feedbackCenter')
      .input(feedbackListQuerySchema)
      .query(({ input, ctx }) => svc.list(input, actorOf(ctx))),
  });
