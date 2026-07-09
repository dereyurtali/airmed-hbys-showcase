import {
  complicationsQuerySchema,
  scheduleFollowUpsSchema,
  surgeryIdSchema,
} from '../../post-op/post-op.schemas';
import { PostOpService } from '../../post-op/post-op.service';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

// S10b — Post-op takip planlaması doktor; iptal yönetici+doktor.
export const postOpRouterFactory = (postOp: PostOpService) =>
  router({
    scheduleFollowUps: permissionProcedure('action:postOp.scheduleFollowUps')
      .input(scheduleFollowUpsSchema)
      .mutation(({ input, ctx }) =>
        postOp.scheduleFollowUps(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    listFollowUps: protectedProcedure
      .input(surgeryIdSchema)
      .query(({ input }) => postOp.listFollowUps(input.surgeryId)),

    deleteFollowUps: permissionProcedure('action:postOp.deleteFollowUps')
      .input(surgeryIdSchema)
      .mutation(({ input, ctx }) =>
        postOp.deleteFollowUps(input.surgeryId, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    recentComplications: protectedProcedure
      .input(complicationsQuerySchema)
      .query(({ input }) => postOp.recentComplications(input)),
  });
