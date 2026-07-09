import {
  RecallService,
  recallAttemptCreateSchema,
  recallListQuerySchema,
} from '../../recall/recall.service';
import { permissionProcedure, router } from '../trpc';

// S15-PR20 — Recall yönetim router. Listing + attempt audit.

export const recallRouterFactory = (recall: RecallService) =>
  router({
    list: permissionProcedure('action:recall.list')
      .input(recallListQuerySchema)
      .query(({ input }) => recall.listForBucket(input)),

    logAttempt: permissionProcedure('action:recall.logAttempt')
      .input(recallAttemptCreateSchema)
      .mutation(({ input, ctx }) => recall.logAttempt(input, { id: ctx.user!.sub })),
  });
