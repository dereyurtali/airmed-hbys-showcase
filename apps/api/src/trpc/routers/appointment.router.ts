import { z } from 'zod';
import {
  appointmentCreateSchema,
  appointmentListQuerySchema,
  appointmentRangeQuerySchema,
  appointmentUpdateSchema,
} from '../../appointment/appointment.schemas';
import { AppointmentService } from '../../appointment/appointment.service';
import { initialStationSchema } from '../../encounter/encounter.schemas';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

const idInput = z.object({ id: z.string().uuid() });

// S10b — Mutation'lar permissionProcedure'a taşındı (registry: action:appointment.*).
// Queries protectedProcedure'da kalır; RLS scope yeterli, role check service'te değil.
export const appointmentRouterFactory = (appointments: AppointmentService) =>
  router({
    list: protectedProcedure
      .input(appointmentListQuerySchema)
      .query(({ input }) => appointments.list(input)),

    findInRange: protectedProcedure
      .input(appointmentRangeQuerySchema)
      .query(({ input }) => appointments.findInRange(input)),

    findById: protectedProcedure
      .input(idInput)
      .query(({ input }) => appointments.findById(input.id)),

    create: permissionProcedure('action:appointment.create')
      .input(appointmentCreateSchema)
      .mutation(({ input }) => appointments.create(input)),

    update: permissionProcedure('action:appointment.update')
      .input(idInput.extend({ data: appointmentUpdateSchema }))
      .mutation(({ input }) => appointments.update(input.id, input.data)),

    cancel: permissionProcedure('action:appointment.cancel')
      .input(idInput)
      .mutation(({ input }) => appointments.cancel(input.id)),

    checkIn: permissionProcedure('action:appointment.checkin')
      .input(idInput.extend({ initialStation: initialStationSchema.optional() }))
      .mutation(({ input, ctx }) =>
        appointments.checkIn(input.id, ctx.user!.sub, input.initialStation),
      ),

    // S10d 1.3 — markDone = doktor "ziyaret bitti" işaretler (klinik akış).
    // checkout = front-office faturalama tamamlandı (ayrı perm).
    markDone: permissionProcedure('action:appointment.markDone')
      .input(idInput)
      .mutation(({ input }) => appointments.markDone(input.id)),

    // markNoShow = gelinmedi (cancel permission — resep/doktor/yonetici)
    markNoShow: permissionProcedure('action:appointment.cancel')
      .input(idInput)
      .mutation(({ input }) => appointments.markNoShow(input.id)),
  });
