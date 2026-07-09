import {
  cohortSchema,
  heatmapSchema,
  metricRangeSchema,
  metricTrendSchema,
  retentionSchema,
  revenueTrendSchema,
} from '../../metric/metric.schemas';
import { MetricService } from '../../metric/metric.service';
import { permissionProcedure, router } from '../trpc';

/**
 * #665 — Metrikler bare protectedProcedure'dı (tenant-içi her kullanıcı, finans/
 * stok/eczane + kilitli kiosk dahil okuyabiliyordu). Gate eklendi:
 *  - Temel dashboard metrikleri → page:dashboard (klinik/ön büro; effectivePerms
 *    ile mode-aware: kilitli kiosk göremez).
 *  - Gelişmiş analiz (kohort/retention/heatmap/ciro) → page:reports (yönetici +
 *    asistan + finans; Reports sayfası erişimiyle hizalı). Eski `assertManager`
 *    ham-rol (mode-blind) inline check kaldırıldı.
 */
export const metricRouterFactory = (metrics: MetricService) =>
  router({
    today: permissionProcedure('page:dashboard').query(() => metrics.today()),

    summary: permissionProcedure('page:dashboard')
      .input(metricRangeSchema)
      .query(({ input }) => metrics.summary(input)),

    appointmentTrend: permissionProcedure('page:dashboard')
      .input(metricTrendSchema)
      .query(({ input }) => metrics.appointmentTrend(input)),

    doctorPerformance: permissionProcedure('page:dashboard')
      .input(metricRangeSchema)
      .query(({ input }) => metrics.doctorPerformance(input)),

    // Gelişmiş raporlar — page:reports (yönetici + asistan + finans).
    cohort: permissionProcedure('page:reports')
      .input(cohortSchema)
      .query(({ input }) => metrics.cohort(input)),

    retention: permissionProcedure('page:reports')
      .input(retentionSchema)
      .query(({ input }) => metrics.retention(input)),

    doctorHeatmap: permissionProcedure('page:reports')
      .input(heatmapSchema)
      .query(({ input }) => metrics.doctorHeatmap(input)),

    // #402 — Aylık ciro raporu.
    revenueTrend: permissionProcedure('page:reports')
      .input(revenueTrendSchema)
      .query(({ input }) => metrics.revenueTrend(input)),
  });
