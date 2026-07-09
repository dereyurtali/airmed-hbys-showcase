import {
  AuditCosignService,
  cosignApproveSchema,
  cosignBulkApproveSchema,
  cosignRejectSchema,
} from '../../audit/audit-cosign.service';
import { permissionProcedure, router } from '../trpc';

// S15-PR23 — Doktor co-sign onay router. Yalnız doktor rolü (kendi adına
// yapılan işlemleri onaylar).

export const cosignRouterFactory = (cosign: AuditCosignService) =>
  router({
    listPending: permissionProcedure('action:audit.cosign').query(({ ctx }) =>
      cosign.listPendingForDoctor(ctx.user!.sub),
    ),

    approve: permissionProcedure('action:audit.cosign')
      .input(cosignApproveSchema)
      .mutation(({ input, ctx }) => cosign.approve(input, { id: ctx.user!.sub })),

    bulkApprove: permissionProcedure('action:audit.cosign')
      .input(cosignBulkApproveSchema)
      .mutation(({ input, ctx }) => cosign.bulkApprove(input, { id: ctx.user!.sub })),

    reject: permissionProcedure('action:audit.cosign')
      .input(cosignRejectSchema)
      .mutation(({ input, ctx }) => cosign.reject(input, { id: ctx.user!.sub })),
  });
