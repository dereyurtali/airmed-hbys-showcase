import { z } from 'zod';
import { IolForecastService } from '../../iol/iol-forecast.service';
import {
  SurgicalKitService,
  surgicalKitCreateSchema,
  surgicalKitIdSchema,
  surgicalKitUpdateSchema,
} from '../../iol/surgical-kit.service';
import {
  iolIdSchema,
  iolLotCreateSchema,
  iolLotListQuerySchema,
  iolLotUpdateSchema,
  iolModelCreateSchema,
  iolModelListQuerySchema,
  iolModelUpdateSchema,
  iolMovementCreateSchema,
} from '../../iol/iol.schemas';
import { IolService } from '../../iol/iol.service';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

// S10b — IOL stok yönetimi admin (yönetici/asistan); softDelete + movement create
// için ek perm'ler eklendi. Stok hareketi de admin sorumluluğunda.
// S15-PR22 — forecast endpoint eklendi.
export const iolRouterFactory = (
  iol: IolService,
  forecast: IolForecastService,
  kits: SurgicalKitService,
) =>
  router({
    // Models
    listModels: protectedProcedure
      .input(iolModelListQuerySchema)
      .query(({ input }) => iol.listModels(input)),

    findModelById: protectedProcedure
      .input(iolIdSchema)
      .query(({ input }) => iol.findModelById(input.id)),

    createModel: permissionProcedure('action:iol.modelCreate')
      .input(iolModelCreateSchema)
      .mutation(({ input, ctx }) =>
        iol.createModel(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    updateModel: permissionProcedure('action:iol.modelUpdate')
      .input(iolIdSchema.extend({ data: iolModelUpdateSchema }))
      .mutation(({ input, ctx }) =>
        iol.updateModel(input.id, input.data, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    softDeleteModel: permissionProcedure('action:iol.modelSoftDelete')
      .input(iolIdSchema)
      .mutation(async ({ input, ctx }) => {
        await iol.softDeleteModel(input.id, { id: ctx.user!.sub, roles: ctx.user!.roles });
        return { ok: true as const };
      }),

    // Lots
    listLots: protectedProcedure
      .input(iolLotListQuerySchema)
      .query(({ input }) => iol.listLots(input)),

    findLotById: protectedProcedure
      .input(iolIdSchema)
      .query(({ input }) => iol.findLotById(input.id)),

    createLot: permissionProcedure('action:iol.lotCreate')
      .input(iolLotCreateSchema)
      .mutation(({ input, ctx }) =>
        iol.createLot(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    updateLot: permissionProcedure('action:iol.lotUpdate')
      .input(iolIdSchema.extend({ data: iolLotUpdateSchema }))
      .mutation(({ input, ctx }) =>
        iol.updateLot(input.id, input.data, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    softDeleteLot: permissionProcedure('action:iol.lotSoftDelete')
      .input(iolIdSchema)
      .mutation(async ({ input, ctx }) => {
        await iol.softDeleteLot(input.id, { id: ctx.user!.sub, roles: ctx.user!.roles });
        return { ok: true as const };
      }),

    // Movements
    createMovement: permissionProcedure('action:iol.movementCreate')
      .input(iolMovementCreateSchema)
      .mutation(({ input, ctx }) =>
        iol.createMovement(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    listMovements: protectedProcedure
      .input(iolIdSchema)
      .query(({ input }) => iol.listMovements(input.id)),

    // v0.4.1 (#691) — tenant-geneli son stok hareketleri (Mal Kabul / Stok Hareketleri).
    recentMovements: permissionProcedure('page:iolInventory')
      .input(z.object({ limit: z.number().int().min(1).max(500).optional() }))
      .query(({ input }) => iol.recentMovements(input.limit ?? 100)),

    // S15-PR22 — Yönetici stok tahmin ekranı.
    forecast: protectedProcedure
      .input(z.object({ days: z.number().int().min(1).max(60).default(7) }))
      .query(({ input }) => forecast.forecastDays(input.days)),

    // #372 — Geriye dönük IOL tüketim raporu (aylık, IolStockMovement consume).
    consumptionReport: protectedProcedure
      .input(z.object({ months: z.number().int().min(1).max(24).default(6) }))
      .query(({ input }) => forecast.consumptionReport(input.months)),

    // S15-PR25 — Surgical Kit availability.
    kitList: protectedProcedure.query(() => kits.listKits()),
    kitAvailability: protectedProcedure.query(() => kits.getAvailability()),

    // #372 — Surgical Kit CRUD (yönetici/asistan). action:iol.lotCreate ile aynı
    // kademe (stok yönetimi yetkisi) — ayrı perm açmaya gerek yok.
    kitCreate: permissionProcedure('action:iol.lotCreate')
      .input(surgicalKitCreateSchema)
      .mutation(({ input, ctx }) =>
        kits.createKit(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),
    kitUpdate: permissionProcedure('action:iol.lotUpdate')
      .input(surgicalKitUpdateSchema)
      .mutation(({ input, ctx }) =>
        kits.updateKit(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),
    kitSoftDelete: permissionProcedure('action:iol.lotSoftDelete')
      .input(surgicalKitIdSchema)
      .mutation(async ({ input, ctx }) => {
        await kits.softDeleteKit(input.id, { id: ctx.user!.sub, roles: ctx.user!.roles });
        return { ok: true as const };
      }),
  });
