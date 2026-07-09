import { z } from 'zod';
import {
  measurementCreateSchema,
  measurementListQuerySchema,
  measurementUpdateSchema,
} from '../../measurement/measurement.schemas';
import { MeasurementService } from '../../measurement/measurement.service';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

const idInput = z.object({ id: z.string().uuid() });
const patientIdInput = z.object({ patientId: z.string().uuid() });

export const measurementRouterFactory = (measurements: MeasurementService) =>
  router({
    list: protectedProcedure
      .input(measurementListQuerySchema)
      .query(({ input }) => measurements.list(input)),

    listByPatient: protectedProcedure
      .input(patientIdInput)
      .query(({ input }) => measurements.listByPatient(input.patientId)),

    findById: protectedProcedure
      .input(idInput)
      .query(({ input }) => measurements.findById(input.id)),

    create: permissionProcedure('action:measurement.create')
      .input(measurementCreateSchema)
      .mutation(({ input, ctx }) =>
        measurements.create(input, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        }),
      ),

    update: permissionProcedure('action:measurement.update')
      .input(idInput.extend({ data: measurementUpdateSchema }))
      .mutation(({ input, ctx }) =>
        measurements.update(input.id, input.data, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        }),
      ),

    softDelete: permissionProcedure('action:measurement.softDelete')
      .input(idInput)
      .mutation(async ({ input, ctx }) => {
        await measurements.softDelete(input.id, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        });
        return { ok: true as const };
      }),
  });
