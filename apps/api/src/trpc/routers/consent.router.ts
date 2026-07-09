import { ConsentService } from '../../consent/consent.service';
import {
  consentListByPatientSchema,
  consentRevokeSchema,
  consentSignSchema,
  consentSigningIdSchema,
  consentTemplateCreateSchema,
  consentTemplateIdSchema,
  consentTemplateListSchema,
  consentTemplateUpdateSchema,
} from '../../consent/consent.schemas';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

// S10b — Template yönetimi yönetici (manage perm); sign doktor/admin; revoke aynı set.
export const consentRouterFactory = (consent: ConsentService) =>
  router({
    // ---- Templates ----
    createTemplate: permissionProcedure('action:consentTemplate.manage')
      .input(consentTemplateCreateSchema)
      .mutation(({ input, ctx }) =>
        consent.createTemplate(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    updateTemplate: permissionProcedure('action:consentTemplate.manage')
      .input(consentTemplateUpdateSchema)
      .mutation(({ input, ctx }) =>
        consent.updateTemplate(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    deleteTemplate: permissionProcedure('action:consentTemplate.manage')
      .input(consentTemplateIdSchema)
      .mutation(({ input, ctx }) =>
        consent.deleteTemplate(input.id, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    listTemplates: protectedProcedure
      .input(consentTemplateListSchema)
      .query(({ input }) => consent.listTemplates(input)),

    getTemplate: protectedProcedure
      .input(consentTemplateIdSchema)
      .query(({ input }) => consent.getTemplate(input.id)),

    // ---- Signings ----
    sign: permissionProcedure('action:consent.capture')
      .input(consentSignSchema)
      .mutation(({ input, ctx }) => {
        const ip = (ctx.req.ip ?? ctx.req.socket?.remoteAddress ?? null) || null;
        return consent.sign(input, { id: ctx.user!.sub, roles: ctx.user!.roles }, ip);
      }),

    revoke: permissionProcedure('action:consent.revoke')
      .input(consentRevokeSchema)
      .mutation(({ input, ctx }) =>
        consent.revoke(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    listByPatient: protectedProcedure
      .input(consentListByPatientSchema)
      .query(({ input }) => consent.listByPatient(input.patientId, input.includeRevoked)),

    getSigning: protectedProcedure
      .input(consentSigningIdSchema)
      .query(({ input }) => consent.getSigning(input.signingId)),
  });
