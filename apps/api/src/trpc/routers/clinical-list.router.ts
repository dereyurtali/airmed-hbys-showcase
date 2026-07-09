import { ClinicalListService } from '../../clinical-list/clinical-list.service';
import {
  byIdSchema,
  byPatientSchema,
  medicationCreateSchema,
  problemCreateSchema,
} from '../../clinical-list/clinical-list.schemas';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

// R1 (#723) — Kalıcı problem + ilaç listesi. Okuma: tenant'ın kimlikli personeli
// (RLS scoped). Yazma: action:problemList.manage (doktor + yönetici + asistan).
export const clinicalListRouterFactory = (clinical: ClinicalListService) =>
  router({
    listProblems: protectedProcedure
      .input(byPatientSchema)
      .query(({ input }) => clinical.listProblems(input.patientId)),

    createProblem: permissionProcedure('action:problemList.manage')
      .input(problemCreateSchema)
      .mutation(({ input, ctx }) => clinical.createProblem(input, ctx.user!.sub)),

    resolveProblem: permissionProcedure('action:problemList.manage')
      .input(byIdSchema)
      .mutation(({ input }) => clinical.resolveProblem(input.id)),

    deleteProblem: permissionProcedure('action:problemList.manage')
      .input(byIdSchema)
      .mutation(async ({ input }) => {
        await clinical.deleteProblem(input.id);
        return { ok: true as const };
      }),

    listMedications: protectedProcedure
      .input(byPatientSchema)
      .query(({ input }) => clinical.listMedications(input.patientId)),

    createMedication: permissionProcedure('action:problemList.manage')
      .input(medicationCreateSchema)
      .mutation(({ input, ctx }) => clinical.createMedication(input, ctx.user!.sub)),

    stopMedication: permissionProcedure('action:problemList.manage')
      .input(byIdSchema)
      .mutation(({ input }) => clinical.stopMedication(input.id)),

    deleteMedication: permissionProcedure('action:problemList.manage')
      .input(byIdSchema)
      .mutation(async ({ input }) => {
        await clinical.deleteMedication(input.id);
        return { ok: true as const };
      }),
  });
