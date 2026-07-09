import { z } from 'zod';
import {
  examinationCreateSchema,
  examinationListQuerySchema,
  examinationUpdateSchema,
} from '../../examination/examination.schemas';
import { ExaminationService } from '../../examination/examination.service';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

const idInput = z.object({ id: z.string().uuid() });
const patientIdInput = z.object({ patientId: z.string().uuid() });

export const examinationRouterFactory = (examinations: ExaminationService) =>
  router({
    list: protectedProcedure
      .input(examinationListQuerySchema)
      .query(({ input }) => examinations.list(input)),

    // S15 — "Geçmiş Muayeneler": giriş yapan doktorun muayeneleri (sunucu scope'lu).
    listMine: protectedProcedure
      .input(
        z.object({
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(100).default(20),
        }),
      )
      .query(({ input, ctx }) => examinations.listByDoctorUser(ctx.user!.sub, input)),

    listByPatient: protectedProcedure
      .input(patientIdInput)
      .query(({ input }) => examinations.listByPatient(input.patientId)),

    findById: protectedProcedure
      .input(idInput)
      .query(({ input }) => examinations.findById(input.id)),

    // #379 — hastanın açık taslağını yükle (create modunda formu prefill için).
    openDraft: protectedProcedure
      .input(patientIdInput)
      .query(({ input }) => examinations.findOpenDraft(input.patientId)),

    create: permissionProcedure('action:examination.create')
      .input(examinationCreateSchema)
      .mutation(({ input }) => examinations.create(input)),

    update: permissionProcedure('action:examination.update')
      .input(idInput.extend({ data: examinationUpdateSchema }))
      .mutation(({ input, ctx }) =>
        examinations.update(input.id, input.data, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        }),
      ),

    softDelete: permissionProcedure('action:examination.softDelete')
      .input(idInput)
      .mutation(async ({ input, ctx }) => {
        await examinations.softDelete(input.id, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        });
        return { ok: true as const };
      }),
  });
