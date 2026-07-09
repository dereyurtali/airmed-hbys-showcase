import {
  procedureCreateSchema,
  procedureIdSchema,
  procedureListQuerySchema,
  procedureSeriesQuerySchema,
  procedureUpdateSchema,
} from '../../procedure/procedure.schemas';
import { ProcedureService } from '../../procedure/procedure.service';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

// S10b — Klinik prosedür girişi doktor; softDelete yönetici/doktor.
export const procedureRouterFactory = (procedure: ProcedureService) =>
  router({
    list: protectedProcedure
      .input(procedureListQuerySchema)
      .query(({ input }) => procedure.list(input)),

    findById: protectedProcedure
      .input(procedureIdSchema)
      .query(({ input }) => procedure.findById(input.id)),

    series: protectedProcedure
      .input(procedureSeriesQuerySchema)
      .query(({ input }) => procedure.series(input)),

    create: permissionProcedure('action:procedure.create')
      .input(procedureCreateSchema)
      .mutation(({ input, ctx }) =>
        procedure.create(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    update: permissionProcedure('action:procedure.update')
      .input(procedureIdSchema.extend({ data: procedureUpdateSchema }))
      .mutation(({ input, ctx }) =>
        procedure.update(input.id, input.data, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    softDelete: permissionProcedure('action:procedure.softDelete')
      .input(procedureIdSchema)
      .mutation(({ input, ctx }) =>
        procedure.softDelete(input.id, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),
  });
