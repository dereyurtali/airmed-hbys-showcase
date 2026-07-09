import {
  fraudAlertListQuerySchema,
  fraudAlertUpdateStatusSchema,
  fraudIdSchema,
  fraudRuleToggleSchema,
} from '../../fraud/fraud.schemas';
import { FraudDetectionService } from '../../fraud/fraud.service';
import { permissionProcedure, protectedProcedure, router } from '../trpc';
import { z } from 'zod';

// S10b — Fraud modülü yönetici-only (Karar 6, mali hassasiyet).
// Listeleme servis tarafında roles ile filtrelendiği için protectedProcedure;
// mutation'lar permissionProcedure ile sıkı kapı.
export const fraudRouterFactory = (fraud: FraudDetectionService) =>
  router({
    listAlerts: protectedProcedure
      .input(fraudAlertListQuerySchema)
      .query(({ input, ctx }) =>
        fraud.listAlerts(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    findAlertById: protectedProcedure
      .input(fraudIdSchema)
      .query(({ input, ctx }) =>
        fraud.findAlertById(input.id, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    updateAlertStatus: permissionProcedure('action:fraud.updateAlertStatus')
      .input(fraudAlertUpdateStatusSchema)
      .mutation(({ input, ctx }) =>
        fraud.updateAlertStatus(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    listRules: protectedProcedure
      .input(z.object({}).optional())
      .query(({ ctx }) => fraud.listRules({ id: ctx.user!.sub, roles: ctx.user!.roles })),

    toggleRule: permissionProcedure('action:fraud.editRule')
      .input(fraudRuleToggleSchema)
      .mutation(({ input, ctx }) =>
        fraud.toggleRule(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    scanNow: permissionProcedure('action:fraud.scanNow')
      .input(z.object({}).optional())
      .mutation(({ ctx }) => fraud.scanNow({ id: ctx.user!.sub, roles: ctx.user!.roles })),
  });
