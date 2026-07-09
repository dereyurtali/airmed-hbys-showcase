import { z } from 'zod';
import { ConsumableService } from '../../consumable/consumable.service';
import {
  consumableAdjustSchema,
  consumableCreateSchema,
  consumableListQuerySchema,
  consumableUpdateSchema,
} from '../../consumable/consumable.schemas';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

// #372 — Consumable (genel sarf/ilaç) CRUD + stok düzeltme. Yetki kademe IOL
// stok yönetimiyle aynı (action:iol.lot* = ADMIN_ROLES) — ayrı izin sprawl'ı yok.
export const consumableRouterFactory = (consumables: ConsumableService) =>
  router({
    list: protectedProcedure
      .input(consumableListQuerySchema)
      .query(({ input }) => consumables.list(input)),

    create: permissionProcedure('action:iol.lotCreate')
      .input(consumableCreateSchema)
      .mutation(({ input, ctx }) =>
        consumables.create(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    update: permissionProcedure('action:iol.lotUpdate')
      .input(z.object({ id: z.string().uuid(), data: consumableUpdateSchema }))
      .mutation(({ input, ctx }) =>
        consumables.update(input.id, input.data, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    adjust: permissionProcedure('action:iol.movementCreate')
      .input(consumableAdjustSchema)
      .mutation(({ input, ctx }) =>
        consumables.adjust(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    softDelete: permissionProcedure('action:iol.lotSoftDelete')
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        await consumables.softDelete(input.id, { id: ctx.user!.sub, roles: ctx.user!.roles });
        return { ok: true as const };
      }),
  });
