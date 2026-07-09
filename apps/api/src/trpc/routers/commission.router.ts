import {
  commissionApproveSchema,
  commissionCalculateSchema,
  commissionEntryListQuerySchema,
  commissionIdSchema,
  commissionMarkPaidSchema,
  commissionMonthlySummaryQuerySchema,
  commissionRejectSchema,
  commissionRuleCreateSchema,
  commissionRuleListQuerySchema,
  commissionRuleUpdateSchema,
} from '../../commission/commission.schemas';
import { CommissionService } from '../../commission/commission.service';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

// S10b — Komisyon iş akışı ADMIN_ROLES (yönetici + asistan). Rule editing
// commission.editRule perm; iş akışı (calculate/approve/reject) ayrı perm'ler.
export const commissionRouterFactory = (commission: CommissionService) =>
  router({
    // Rules
    listRules: protectedProcedure
      .input(commissionRuleListQuerySchema)
      .query(({ input, ctx }) =>
        commission.listRules(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    findRuleById: protectedProcedure
      .input(commissionIdSchema)
      .query(({ input }) => commission.findRuleById(input.id)),

    createRule: permissionProcedure('action:commission.editRule')
      .input(commissionRuleCreateSchema)
      .mutation(({ input, ctx }) =>
        commission.createRule(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    updateRule: permissionProcedure('action:commission.editRule')
      .input(commissionIdSchema.extend({ data: commissionRuleUpdateSchema }))
      .mutation(({ input, ctx }) =>
        commission.updateRule(input.id, input.data, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        }),
      ),

    softDeleteRule: permissionProcedure('action:commission.editRule')
      .input(commissionIdSchema)
      .mutation(({ input, ctx }) =>
        commission.softDeleteRule(input.id, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    // Calculate / workflow
    calculate: permissionProcedure('action:commission.calculate')
      .input(commissionCalculateSchema)
      .mutation(({ input, ctx }) =>
        commission.calculate(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    approve: permissionProcedure('action:commission.approve')
      .input(commissionApproveSchema)
      .mutation(({ input, ctx }) =>
        commission.approve(input.id, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    reject: permissionProcedure('action:commission.reject')
      .input(commissionRejectSchema)
      .mutation(({ input, ctx }) =>
        commission.reject(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    markPaid: permissionProcedure('action:commission.markPaid')
      .input(commissionMarkPaidSchema)
      .mutation(({ input, ctx }) =>
        commission.markPaid(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    // Entries
    listEntries: protectedProcedure
      .input(commissionEntryListQuerySchema)
      .query(({ input, ctx }) =>
        commission.listEntries(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    findEntryById: protectedProcedure
      .input(commissionIdSchema)
      .query(({ input }) => commission.findEntryById(input.id)),

    monthlySummary: protectedProcedure
      .input(commissionMonthlySummaryQuerySchema)
      .query(({ input, ctx }) =>
        commission.monthlySummary(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),
  });
