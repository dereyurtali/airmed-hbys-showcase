import { z } from 'zod';
import { LabThresholdService, labThresholdUpsertSchema } from '../../lab/lab-threshold.service';
import {
  labTestByPatientSchema,
  labTestCreateSchema,
  labTestIdSchema,
  labTestListQuerySchema,
  labTestUpdateSchema,
} from '../../lab/lab.schemas';
import { LabService } from '../../lab/lab.service';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

// S10b — Lab istek/güncelle doktor; softDelete yönetici/doktor.
// `recordResult` ayrı bir perm registry'de tanımlı; mevcut update endpoint'i ile
// servis tarafında payload'a göre branch'leniyor.
// S15-P3 — labThreshold alt grubu (klinik özel referans aralıkları).
export const labRouterFactory = (lab: LabService, thresholds: LabThresholdService) =>
  router({
    list: protectedProcedure.input(labTestListQuerySchema).query(({ input }) => lab.list(input)),

    listByPatient: protectedProcedure
      .input(labTestByPatientSchema)
      .query(({ input }) => lab.listByPatient(input.patientId)),

    findById: protectedProcedure
      .input(labTestIdSchema)
      .query(({ input }) => lab.findById(input.id)),

    create: permissionProcedure('action:lab.request')
      .input(labTestCreateSchema)
      .mutation(({ input, ctx }) =>
        lab.create(input, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        }),
      ),

    update: permissionProcedure('action:lab.update')
      .input(labTestIdSchema.extend({ data: labTestUpdateSchema }))
      .mutation(({ input, ctx }) =>
        lab.update(input.id, input.data, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        }),
      ),

    softDelete: permissionProcedure('action:lab.softDelete')
      .input(labTestIdSchema)
      .mutation(async ({ input, ctx }) => {
        await lab.softDelete(input.id, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        });
        return { ok: true as const };
      }),

    // S15-P3 — Lab abnormal threshold yönetimi.
    threshold: router({
      list: permissionProcedure('action:labThreshold.manage').query(() => thresholds.list()),
      upsert: permissionProcedure('action:labThreshold.manage')
        .input(labThresholdUpsertSchema)
        .mutation(({ input }) => thresholds.upsert(input)),
      softDelete: permissionProcedure('action:labThreshold.manage')
        .input(z.object({ id: z.string().uuid() }))
        .mutation(({ input }) => thresholds.softDelete(input.id)),
    }),
  });
