import { z } from 'zod';
import { AdminOverviewService } from '../../dashboard/admin-overview.service';
import { getLayoutInputSchema, saveLayoutInputSchema } from '../../dashboard/dashboard.schemas';
import { DashboardLayoutService } from '../../dashboard/dashboard.service';
import { RoleOverviewService } from '../../dashboard/role-overview.service';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

// S14 — Dashboard widget framework tRPC router.
// S16 — Yönetici "Genel Bakış" aggregate query (adminOverview).
// #1066 — Doktor/Hemşire Genel Bakış agregatları (tek poll timer'ı).

const dayRangeSchema = z.object({
  dateFrom: z.string().datetime({ offset: true }),
  dateTo: z.string().datetime({ offset: true }),
});

export const dashboardRouterFactory = (
  dashboard: DashboardLayoutService,
  adminOverview: AdminOverviewService,
  roleOverview: RoleOverviewService,
) =>
  router({
    getLayout: permissionProcedure('action:dashboard.getLayout')
      .input(getLayoutInputSchema)
      .query(({ input, ctx }) => dashboard.getLayout(input, ctx.user!.sub)),

    saveLayout: permissionProcedure('action:dashboard.saveLayout')
      .input(saveLayoutInputSchema)
      .mutation(({ input }) => dashboard.saveRoleDefault(input)),

    // S16 — Yönetici Genel Bakış: tüm KPI + paneller tek sorguda. Yönetim
    // verisi (mali + onay) → admin gate (action:approval.list = ADMIN_ROLES).
    adminOverview: permissionProcedure('action:approval.list').query(() =>
      adminOverview.getOverview(),
    ),

    // S16 — İndirim Onay Talepleri sayfası: tüm bekleyen talepler (zengin satır
    // + gerekçe + klinik adı). Aynı admin gate.
    pendingApprovals: permissionProcedure('action:approval.list').query(() =>
      adminOverview.getPendingApprovalsPage(),
    ),

    // S16 — Stok & Malzeme Takibi sayfası (Lensler + Sarf + İlaç). Envanter
    // okuma erişimi = page:iolInventory (yönetici/asistan/hemşire).
    stockOverview: permissionProcedure('page:iolInventory').query(() =>
      adminOverview.getStockOverview(),
    ),

    // #1066 — rol Genel Bakış agregatları: 4-5 bağımsız poll yerine tek sorgu.
    // İzin gerektiren parçalar (cosign/recall) servis içinde aktör iznine göre
    // koşullu boş döner (yetki yükseltmez).
    doctorOverview: protectedProcedure
      .input(dayRangeSchema)
      .query(({ input, ctx }) =>
        roleOverview.doctorOverview(
          { id: ctx.user!.sub, roles: ctx.user!.roles, effectivePerms: ctx.user!.effectivePerms },
          input,
        ),
      ),

    nurseOverview: protectedProcedure
      .input(dayRangeSchema)
      .query(({ input, ctx }) =>
        roleOverview.nurseOverview(
          { id: ctx.user!.sub, roles: ctx.user!.roles, effectivePerms: ctx.user!.effectivePerms },
          input,
        ),
      ),
  });
