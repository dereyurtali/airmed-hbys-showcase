import { z } from 'zod';
import {
  patientCreateSchema,
  patientDuplicatesSchema,
  patientListQuerySchema,
  patientSetTagsSchema,
  patientUpdateSchema,
} from '../../patient/patient.schemas';
import { PatientService } from '../../patient/patient.service';
import { NurseSessionService } from '../../nurse-session/nurse-session.service';
import { resolveActingDoctorUserId } from '../acting-doctor';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

const idInput = z.object({ id: z.string().uuid() });

export const patientRouterFactory = (
  patients: PatientService,
  nurseSessions: NurseSessionService,
) =>
  router({
    // Asiste eden hemşire aktif session'la Dr. X'in hastalarına scope'lanır
    // (actingDoctorUserId); aksi halde mevcut davranış (doktor=kendi, diğer=tümü).
    list: protectedProcedure.input(patientListQuerySchema).query(async ({ input, ctx }) =>
      patients.list(input, {
        userId: ctx.user!.sub,
        roles: ctx.user!.roles,
        flags: ctx.user!.flags,
        actingDoctorUserId: await resolveActingDoctorUserId(ctx, nurseSessions),
      }),
    ),

    findById: protectedProcedure.input(idInput).query(async ({ input, ctx }) =>
      patients.findById(input.id, {
        userId: ctx.user!.sub,
        roles: ctx.user!.roles,
        flags: ctx.user!.flags,
        actingDoctorUserId: await resolveActingDoctorUserId(ctx, nurseSessions),
      }),
    ),

    // S10c — Yeni hasta yalnız front desk + admin (yönetici/asistan/resepsiyon).
    create: permissionProcedure('action:patient.create')
      .input(patientCreateSchema.extend({ force: z.boolean().optional() }))
      .mutation(({ input, ctx }) => {
        const { force, ...data } = input;
        return patients.create(data, force ?? false, { userId: ctx.user!.sub });
      }),

    update: permissionProcedure('action:patient.update')
      .input(idInput.extend({ data: patientUpdateSchema }))
      .mutation(({ input }) => patients.update(input.id, input.data)),

    // S3 — Karar 5: hasta silme sadece yönetici (asistan dahil değil).
    // permissionProcedure registry'den `action:patient.softDelete` izinli rolleri
    // kontrol eder. sensitiveProcedure'ın impersonation block davranışını da
    // miras alır.
    softDelete: permissionProcedure('action:patient.softDelete')
      .input(idInput)
      .mutation(async ({ input }) => {
        await patients.softDelete(input.id);
        return { ok: true as const };
      }),

    // S7 — KVKK hard-delete (karar tutanağı §6.1). Sadece yönetici;
    // UI çift onay ("DELETE" yazdırma) ile tetikler. Reason zorunlu —
    // audit log'a sebep yazılır.
    hardDelete: permissionProcedure('action:patient.hardDelete')
      .input(
        idInput.extend({
          reason: z.string().min(10, 'reason must be at least 10 chars').max(500),
          confirm: z.literal('DELETE'),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await patients.hardDelete(input.id, {
          userId: ctx.user!.sub,
          reason: input.reason,
          ip: ctx.req.ip ?? null,
        });
        return { ok: true as const };
      }),

    // #665 — etiketleme hasta verisini değiştirir (VIP vb.); bare protectedProcedure'dı.
    // Hasta düzenleme yetkisiyle (front desk + admin) hizalandı.
    setTags: permissionProcedure('action:patient.update')
      .input(patientSetTagsSchema)
      .mutation(({ input }) => patients.setTags(input.id, input.tags)),

    duplicates: protectedProcedure
      .input(patientDuplicatesSchema)
      .query(({ input }) => patients.findDuplicates(input)),
  });
