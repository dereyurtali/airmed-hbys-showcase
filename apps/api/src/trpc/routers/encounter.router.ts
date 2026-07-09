import {
  encounterAdvanceSchema,
  encounterOpenSchema,
  encounterStartExamSchema,
  encounterWorklistQuerySchema,
} from '../../encounter/encounter.schemas';
import { EncounterService } from '../../encounter/encounter.service';
import { NurseSessionService } from '../../nurse-session/nurse-session.service';
import { resolveActingDoctorUserId } from '../acting-doctor';
import { permissionProcedure, protectedProcedure, router } from '../trpc';
import { z } from 'zod';

const idInput = z.object({ id: z.string().uuid() });

// S15 — Encounter (ziyaret akışı). myWorklist queries protectedProcedure'da:
// doctorId client'tan GELMEZ, ctx.user.sub'tan türetilir (doktor sadece kendi
// kuyruğunu görür). Asiste eden hemşire aktif session'la Dr. X'in kuyruğunu
// görür (resolveActingDoctorUserId). Mutation'lar permissionProcedure
// (action:encounter.*).
export const encounterRouterFactory = (
  encounters: EncounterService,
  nurseSessions: NurseSessionService,
) =>
  router({
    myWorklist: protectedProcedure
      .input(encounterWorklistQuerySchema)
      .query(async ({ input, ctx }) => {
        const actingDoctorUserId = await resolveActingDoctorUserId(ctx, nurseSessions);
        return encounters.findMyWorklist(actingDoctorUserId ?? ctx.user!.sub, input);
      }),

    // S15-PR26 — Doktorun aktif in_exam sayısı + cap rozeti.
    // R2 (#724) — Asistan modunda acting-doctor'ın yükünü döndürür: hemşire
    // TopBar'da "Dr. X: N/3 aktif" görür (myWorklist ile aynı scope mantığı).
    myActiveExamCount: protectedProcedure.query(async ({ ctx }) => {
      const actingDoctorUserId = await resolveActingDoctorUserId(ctx, nurseSessions);
      return encounters.activeExamCountForDoctor(actingDoctorUserId ?? ctx.user!.sub);
    }),

    // S15-P3 — Daily Huddle özet + Doctor's Lag Time monitor.
    dailyHuddle: protectedProcedure.query(() => encounters.dailyHuddleSummary()),
    lagTime: protectedProcedure.query(() => encounters.lagTimeSummary()),

    findById: protectedProcedure.input(idInput).query(({ input }) => encounters.findById(input.id)),

    // S15 — hastanın o anki aktif ziyareti (muayene-sonrası karar paneli için)
    activeForPatient: protectedProcedure
      .input(z.object({ patientId: z.string().uuid() }))
      .query(({ input }) => encounters.findActiveByPatient(input.patientId)),

    // S15 — resepsiyon ödeme/yönlendirme kuyruğu
    receptionQueue: permissionProcedure('action:encounter.receptionList').query(() =>
      encounters.receptionQueue(),
    ),

    // #412 — Lobby TV bekleme monitörü: bugünkü tüm aktif istasyonlar (done/
    // cancelled hariç). Tenant-scoped auth yeterli (klinik personeli açar, hasta
    // izler); receptionList yetkisi gerekmez.
    waitingMonitor: protectedProcedure.query(() => encounters.waitingMonitor()),

    // #424 — Göz acili triyaj: ziyareti acil/normal işaretle (kuyruk önceliği).
    setUrgent: permissionProcedure('action:encounter.receptionList')
      .input(
        z.object({
          id: z.string().uuid(),
          isUrgent: z.boolean(),
          reason: z.string().trim().max(200).optional().nullable(),
        }),
      )
      .mutation(({ input }) =>
        encounters.setUrgent(input.id, input.isUrgent, input.reason ?? null),
      ),

    open: permissionProcedure('action:encounter.open')
      .input(encounterOpenSchema)
      .mutation(({ input, ctx }) => encounters.open(input, ctx.user!.sub)),

    advance: permissionProcedure('action:encounter.advance')
      .input(encounterAdvanceSchema)
      .mutation(({ input }) => encounters.advance(input)),

    // S15 — "Muayeneye başla" köprüsü (randevu → in_exam)
    startExam: permissionProcedure('action:encounter.advance')
      .input(encounterStartExamSchema)
      .mutation(({ input }) => encounters.startExamByAppointment(input.appointmentId)),

    close: permissionProcedure('action:encounter.close')
      .input(idInput)
      .mutation(({ input }) => encounters.close(input.id)),

    // S15-PR5 — Break Glass acil bypass; sadece yönetici.
    activateEmergencyBypass: permissionProcedure('action:encounter.emergencyBypass')
      .input(z.object({ id: z.string().uuid(), reason: z.string().min(10).max(500) }))
      .mutation(({ input, ctx }) =>
        encounters.activateEmergencyBypass(input.id, input.reason, ctx.user!.sub),
      ),

    closeEmergencyBypass: permissionProcedure('action:encounter.emergencyBypass')
      .input(idInput)
      .mutation(({ input, ctx }) => encounters.closeEmergencyBypass(input.id, ctx.user!.sub)),
  });
