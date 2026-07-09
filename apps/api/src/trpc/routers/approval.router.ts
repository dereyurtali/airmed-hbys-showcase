import { DiscountApprovalService } from '../../billing/approval/approval.service';
import {
  discountApprovalEscalateSchema,
  discountApprovalIdSchema,
  discountApprovalListQuerySchema,
  discountApprovalReviewSchema,
} from '../../billing/approval/approval.schemas';
import { ROLE_DISCOUNT_LIMITS } from '../../billing/approval/discount-limits';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

// S14 — DiscountApproval tRPC router. UI'da ApprovalsPage + dashboard widget'ı
// bu router'ı çağırır.

export const approvalRouterFactory = (approvals: DiscountApprovalService) =>
  router({
    listPending: permissionProcedure('action:approval.list')
      .input(discountApprovalListQuerySchema)
      .query(({ input }) => approvals.listPending(input)),

    countPending: permissionProcedure('action:approval.list').query(() =>
      approvals.countPending().then((count) => ({ count })),
    ),

    findOne: permissionProcedure('action:approval.list')
      .input(discountApprovalIdSchema)
      .query(({ input }) => approvals.findById(input.id)),

    review: permissionProcedure('action:approval.review')
      .input(discountApprovalReviewSchema)
      .mutation(({ input, ctx }) =>
        approvals.review(
          input.id,
          input.decision,
          { id: ctx.user!.sub, roles: ctx.user!.roles },
          input.note ?? null,
        ),
      ),

    // R5 (#727) — "Eskale et": asistan onayı yöneticilere iletir. Yetki
    // action:approval.list (asistan görür/eskale eder; finalize action:approval.review).
    escalate: permissionProcedure('action:approval.list')
      .input(discountApprovalEscalateSchema)
      .mutation(({ input, ctx }) =>
        approvals.escalate(
          input.id,
          { id: ctx.user!.sub, roles: ctx.user!.roles },
          input.note ?? null,
        ),
      ),

    // S15-PR17 — Kârlılık simülasyonu (yönetici onay paneli için).
    simulate: permissionProcedure('action:approval.review')
      .input(discountApprovalIdSchema)
      .query(({ input }) => approvals.simulate(input.id)),

    // S15-PR17 — Kullanıcının yetki cap'i ve sistem default'ları (UI rozeti).
    // #361 — absoluteMaxPercent: onayla bile aşılamayan tenant tavanı (UI bunu
    // slider/input üst sınırı olarak kullanır; SELF_CAP hardcode kalkar).
    myLimits: protectedProcedure.query(async ({ ctx }) => ({
      selfPercent: approvals.selfLimitFor({
        id: ctx.user!.sub,
        roles: ctx.user!.roles,
      }),
      canApprove: ctx.user!.roles.some(
        (r) => (ROLE_DISCOUNT_LIMITS[r as keyof typeof ROLE_DISCOUNT_LIMITS]?.approvable ?? 0) > 0,
      ),
      absoluteMaxPercent: await approvals.absoluteMaxDiscountPercent(),
      roleLimits: ROLE_DISCOUNT_LIMITS,
    })),
  });
