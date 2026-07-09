import {
  checklistItemPatchSchema,
  preOpCreateSchema,
  preOpUpdateInputSchema,
  surgeryIdSchema,
} from '../../pre-op/pre-op.schemas';
import { PreOpService } from '../../pre-op/pre-op.service';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

// S10b — Pre-op çalışmaları cerrahi akışın parçası, doktor sorumlu.
// checklistItem.patch + markReady/unmarkReady de preOp.update perm'i altında
// gruplanmış (aynı sorumluluk seti); softDelete yönetici+doktor.
export const preOpRouterFactory = (preOp: PreOpService) =>
  router({
    create: permissionProcedure('action:preOp.create')
      .input(preOpCreateSchema)
      .mutation(({ input, ctx }) =>
        preOp.create(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    getBySurgery: protectedProcedure
      .input(surgeryIdSchema)
      .query(({ input }) => preOp.getOrNull(input.surgeryId)),

    update: permissionProcedure('action:preOp.update')
      .input(preOpUpdateInputSchema)
      .mutation(({ input, ctx }) => {
        const { surgeryId, ...rest } = input;
        return preOp.update(surgeryId, rest, { id: ctx.user!.sub, roles: ctx.user!.roles });
      }),

    patchChecklistItem: permissionProcedure('action:preOp.update')
      .input(checklistItemPatchSchema)
      .mutation(({ input, ctx }) =>
        preOp.patchChecklistItem(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    markReady: permissionProcedure('action:preOp.markReady')
      .input(surgeryIdSchema)
      .mutation(({ input, ctx }) =>
        preOp.markReady(input.surgeryId, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    unmarkReady: permissionProcedure('action:preOp.unmarkReady')
      .input(surgeryIdSchema)
      .mutation(({ input, ctx }) =>
        preOp.unmarkReady(input.surgeryId, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    softDelete: permissionProcedure('action:preOp.softDelete')
      .input(surgeryIdSchema)
      .mutation(({ input, ctx }) =>
        preOp.softDelete(input.surgeryId, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),
  });
