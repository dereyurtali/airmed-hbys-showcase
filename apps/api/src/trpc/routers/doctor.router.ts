import { z } from 'zod';
import {
  doctorCreateSchema,
  doctorListQuerySchema,
  doctorUpdateSchema,
  leaveCreateSchema,
  leaveListQuerySchema,
  leaveRangeQuerySchema,
  setAvailabilitySchema,
  visitingWindowCreateSchema,
  visitingWindowListQuerySchema,
  visitingWindowRangeQuerySchema,
} from '../../doctor/doctor.schemas';
import { DoctorService } from '../../doctor/doctor.service';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

const idInput = z.object({ id: z.string().uuid() });

export const doctorRouterFactory = (doctors: DoctorService) =>
  router({
    // Doktor diğer doktorları listeleyemez (action:doctor.list). Kendi profili için
    // myProfile (protectedProcedure) ayrı.
    list: permissionProcedure('action:doctor.list')
      .input(doctorListQuerySchema)
      .query(({ input }) => doctors.list(input)),

    findById: permissionProcedure('action:doctor.list')
      .input(idInput)
      .query(({ input }) => doctors.findById(input.id)),

    // S15 — giriş yapan kullanıcının doktor profili (worklist + takvim filtresi)
    myProfile: protectedProcedure.query(({ ctx }) => doctors.myProfile(ctx.user!.sub)),

    // #561 güvenlik denetimi — create/update bare protectedProcedure'dı: HER
    // authenticated kullanıcı (kilitli-mod kiosk dahil) doktor kataloğu
    // ekleyip düzenleyebiliyordu. Registry zaten ADMIN_ROLES istiyor; gate eklendi.
    create: permissionProcedure('action:doctor.create')
      .input(doctorCreateSchema)
      .mutation(({ input }) => doctors.create(input)),

    update: permissionProcedure('action:doctor.update')
      .input(idInput.extend({ data: doctorUpdateSchema }))
      .mutation(({ input }) => doctors.update(input.id, input.data)),

    // S3 — silme aksiyonu permissionProcedure (registry: yonetici + asistan,
    // impersonation block sensitiveProcedure'dan miras).
    softDelete: permissionProcedure('action:doctor.softDelete')
      .input(idInput)
      .mutation(async ({ input }) => {
        await doctors.softDelete(input.id);
        return { ok: true as const };
      }),

    // S8b — Yönetici doktor user flag toggle (can_see_all_patients +
    // is_visiting_doctor). action:user.update permission (sadece yönetici).
    updateFlags: permissionProcedure('action:user.update')
      .input(
        idInput.extend({
          flags: z.object({
            is_visiting_doctor: z.boolean().optional(),
            can_see_all_patients: z.boolean().optional(),
          }),
        }),
      )
      .mutation(({ input }) => doctors.updateDoctorUserFlags(input.id, input.flags)),

    listAvailability: protectedProcedure
      .input(idInput)
      .query(({ input }) => doctors.listAvailability(input.id)),

    // S10d 2.2 — Registry'de admin gate vardı ama router'da yoktu.
    setAvailability: permissionProcedure('action:doctor.setAvailability')
      .input(idInput.extend({ data: setAvailabilitySchema }))
      .mutation(({ input }) => doctors.setAvailability(input.id, input.data)),

    // S10d 2.1 — Izin/tatil yönetimi admin işi (önceden gate yoktu, herkes ekler/siler).
    addLeave: permissionProcedure('action:doctor.addLeave')
      .input(leaveCreateSchema)
      .mutation(({ input }) => doctors.addLeave(input)),

    listLeaves: protectedProcedure
      .input(leaveListQuerySchema)
      .query(({ input }) => doctors.listLeaves(input)),

    findLeavesInRange: protectedProcedure
      .input(leaveRangeQuerySchema)
      .query(({ input }) => doctors.findLeavesInRange(input)),

    deleteLeave: permissionProcedure('action:doctor.deleteLeave')
      .input(idInput)
      .mutation(async ({ input }) => {
        await doctors.deleteLeave(input.id);
        return { ok: true as const };
      }),

    // #1047 — Misafir doktor geliş penceresi CRUD. Yeni permission açılmaz:
    // izin/mesai yönetimiyle aynı gate (action:doctor.setAvailability).
    addVisitingWindow: permissionProcedure('action:doctor.setAvailability')
      .input(visitingWindowCreateSchema)
      .mutation(({ input }) => doctors.addVisitingWindow(input)),

    listVisitingWindows: protectedProcedure
      .input(visitingWindowListQuerySchema)
      .query(({ input }) => doctors.listVisitingWindows(input)),

    findVisitingWindowsInRange: protectedProcedure
      .input(visitingWindowRangeQuerySchema)
      .query(({ input }) => doctors.findVisitingWindowsInRange(input)),

    deleteVisitingWindow: permissionProcedure('action:doctor.setAvailability')
      .input(idInput)
      .mutation(async ({ input }) => {
        await doctors.deleteVisitingWindow(input.id);
        return { ok: true as const };
      }),
  });
