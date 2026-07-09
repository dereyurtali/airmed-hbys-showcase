import { z } from 'zod';
import {
  adminDeliveryListSchema,
  adminListByPatientSchema,
  adminTemplateListSchema,
  adminTemplateUpdateSchema,
  adminTriggerConfigSchema,
  adminTriggerListSchema,
} from '../../messaging/messaging.admin.schemas';
import { MessagingAdminService } from '../../messaging/messaging.admin.service';
import {
  createThreadSchema,
  PatientThreadService,
  sendThreadMessageSchema,
} from '../../messaging/patient-thread.service';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

// D1 PR 3 — Klinik messaging admin router.
// S10b — Trigger config + template update permissionProcedure (admin perm).
// S15-PR19 — PatientThread alt grubu.
export const messagingRouterFactory = (
  admin: MessagingAdminService,
  threads: PatientThreadService,
) =>
  router({
    listTriggers: protectedProcedure
      .input(adminTriggerListSchema)
      .query(({ input }) => admin.listTriggers(input)),

    updateTriggerConfig: permissionProcedure('action:messaging.configureTrigger')
      .input(adminTriggerConfigSchema)
      .mutation(({ input, ctx }) =>
        admin.updateTriggerConfig(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    listTemplates: protectedProcedure
      .input(adminTemplateListSchema)
      .query(({ input }) => admin.listTemplates(input)),

    updateTemplate: permissionProcedure('action:messaging.updateTemplate')
      .input(adminTemplateUpdateSchema)
      .mutation(({ input, ctx }) =>
        admin.updateTemplate(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    listDeliveries: protectedProcedure
      .input(adminDeliveryListSchema)
      .query(({ input }) => admin.listDeliveries(input)),

    listByPatient: protectedProcedure
      .input(adminListByPatientSchema)
      .query(({ input }) => admin.listByPatient(input.patientId)),

    // S15-PR19 — Bağlamsal mesajlaşma (klinik personeli arası, hasta-bağlı).
    // #665 — Hasta mesaj thread'leri bare protectedProcedure'dı (tenant-içi her
    // kullanıcı okur/yazardı). page:patients ile gate'lendi: hasta-bakım kadrosu
    // (ALL_ROLES — finans/stok/eczane hariç) + effectivePerms ile mode-aware
    // (kilitli kiosk hasta mesajına erişemez). Hastaya ulaşabilen mesajlaşabilir.
    threads: router({
      listForPatient: permissionProcedure('page:patients')
        .input(z.object({ patientId: z.string().uuid() }))
        .query(({ input }) => threads.listForPatient(input.patientId)),

      listMessages: permissionProcedure('page:patients')
        .input(z.object({ threadId: z.string().uuid() }))
        .query(({ input }) => threads.listMessages(input.threadId)),

      create: permissionProcedure('page:patients')
        .input(createThreadSchema)
        .mutation(({ input, ctx }) => threads.createThread(input, { id: ctx.user!.sub })),

      sendMessage: permissionProcedure('page:patients')
        .input(sendThreadMessageSchema)
        .mutation(({ input, ctx }) => threads.sendMessage(input, { id: ctx.user!.sub })),

      archive: permissionProcedure('page:patients')
        .input(z.object({ threadId: z.string().uuid() }))
        .mutation(({ input }) => threads.archive(input.threadId)),
    }),
  });
