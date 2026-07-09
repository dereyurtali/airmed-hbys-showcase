import { z } from 'zod';
import {
  safetyConfirmItemSchema,
  safetyMarkPhaseSchema,
  SafetyChecklistService,
} from '../../surgery/safety-checklist.service';
import {
  markCompletedSchema,
  markComplicationSchema,
  markRefusedSchema,
  registerLensSchema,
  surgeryCreateSchema,
  surgeryListQuerySchema,
  surgeryUpdateSchema,
} from '../../surgery/surgery.schemas';
import { SurgeryService } from '../../surgery/surgery.service';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

const idInput = z.object({ id: z.string().uuid() });
const patientIdInput = z.object({ patientId: z.string().uuid() });
const surgeryIdInput = z.object({ surgeryId: z.string().uuid() });

// S10b — Klinik veri girişi (doktor-only) permissionProcedure'a taşındı.
// softDelete sadece yönetici (yeni perm).
// S15-PR3 — safetyChecklist alt-router; WHO 21-item için 4 endpoint.
export const surgeryRouterFactory = (
  surgeries: SurgeryService,
  safetyChecklist: SafetyChecklistService,
) =>
  router({
    list: protectedProcedure
      .input(surgeryListQuerySchema)
      .query(({ input }) => surgeries.list(input)),

    listByPatient: protectedProcedure
      .input(patientIdInput)
      .query(({ input }) => surgeries.listByPatient(input.patientId)),

    findById: protectedProcedure.input(idInput).query(({ input }) => surgeries.findById(input.id)),

    // S15 — Ameliyat satış kuyruğu (devir): planlanan + ödenmemiş cerrahiler.
    handoffQueue: permissionProcedure('action:surgery.handoffList').query(() =>
      surgeries.handoffQueue(),
    ),

    // S16 — Satış Hattı pipeline: planlı ameliyatlar + türetilmiş 4 durum + fiyat.
    salesPipeline: permissionProcedure('action:surgery.handoffList').query(() =>
      surgeries.salesPipeline(),
    ),

    // S16 — Satış "Randevu Ver": hastaya ameliyat tarihi ver (SURGERY_BILLING_ROLES).
    // #369 — opsiyonel doktor seçimi (uzmanlık-yetkinlik + müsaitlik kontrollü).
    scheduleForSale: permissionProcedure('action:surgery.handoffList')
      .input(
        z.object({
          id: z.string().uuid(),
          scheduledAt: z.string().datetime(),
          doctorId: z.string().uuid().optional(),
        }),
      )
      .mutation(({ input }) =>
        surgeries.scheduleForSale(input.id, input.scheduledAt, input.doctorId),
      ),

    // #369 — Cerrahi tip için yetkin (uzmanlık eşleşen) aktif doktorlar.
    eligibleDoctors: permissionProcedure('action:surgery.handoffList')
      .input(z.object({ surgeryId: z.string().uuid() }))
      .query(({ input }) => surgeries.eligibleDoctors(input.surgeryId)),

    create: permissionProcedure('action:surgery.create')
      .input(surgeryCreateSchema)
      .mutation(({ input, ctx }) =>
        surgeries.create(input, { userId: ctx.user!.sub, flags: ctx.user!.flags }),
      ),

    update: permissionProcedure('action:surgery.update')
      .input(idInput.extend({ data: surgeryUpdateSchema }))
      .mutation(({ input, ctx }) =>
        surgeries.update(input.id, input.data, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        }),
      ),

    softDelete: permissionProcedure('action:surgery.softDelete')
      .input(idInput)
      .mutation(async ({ input, ctx }) => {
        await surgeries.softDelete(input.id, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        });
        return { ok: true as const };
      }),

    // B1 PR 2 — Lens implant register (intra-op flow)
    registerLens: permissionProcedure('action:surgery.registerLens')
      .input(registerLensSchema)
      .mutation(({ input, ctx }) =>
        surgeries.registerLens(input, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        }),
      ),

    // B1 PR 2 — Komplikasyon kaydı
    markComplication: permissionProcedure('action:surgery.markComplication')
      .input(markComplicationSchema)
      .mutation(({ input, ctx }) =>
        surgeries.markComplication(input, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        }),
      ),

    // B1 PR 3 — markCompleted hook + otomatik post-op kontrol takvimi
    markCompleted: permissionProcedure('action:surgery.markCompleted')
      .input(markCompletedSchema)
      .mutation(({ input, ctx }) =>
        surgeries.markCompleted(input, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        }),
      ),

    // S15-PR16 — Cerrahi reddi (hasta vazgeçti). Lead funnel + analitik sinyali.
    markRefused: permissionProcedure('action:surgery.markRefused')
      .input(markRefusedSchema)
      .mutation(({ input, ctx }) =>
        surgeries.markRefused(input, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        }),
      ),

    // S15-PR3 — WHO Surgical Safety Checklist alt grubu.
    safetyChecklist: router({
      // Catalog (21 item meta) — UI render'ı için, permission'sız izleme yeterli.
      catalog: protectedProcedure.query(() => safetyChecklist.getCatalog()),

      get: protectedProcedure
        .input(surgeryIdInput)
        .query(({ input }) => safetyChecklist.getOrCreate(input.surgeryId)),

      confirmItem: permissionProcedure('action:surgicalSafetyCheck.confirm')
        .input(safetyConfirmItemSchema)
        .mutation(({ input, ctx }) => safetyChecklist.confirmItem(input, ctx.user!.sub)),

      markPhase: permissionProcedure('action:surgicalSafetyCheck.confirm')
        .input(safetyMarkPhaseSchema)
        .mutation(({ input, ctx }) => safetyChecklist.markPhaseComplete(input, ctx.user!.sub)),
    }),
  });
