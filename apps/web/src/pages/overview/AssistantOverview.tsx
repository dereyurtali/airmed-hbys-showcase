import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ClipboardCheck, Boxes, ShieldOff, ArrowUpRight } from 'lucide-react';
import { OverviewShell, OverviewStatCard } from '../../components/overview';
import { WidgetShell } from '../../components/dashboard/WidgetShell';
import { Button } from '../../components/ui/button';
import { trpc } from '../../lib/trpc';
import { mapTrpcError } from '../../lib/trpc-error';
import { billingApi } from '../../lib/billing.trpc';

/**
 * Yönetici Asistanı Genel Bakış — v0.4.2 R5 (#727). İlke: **operate-but-not-finalize**.
 * Onayları inline ONAYLAMAZ → "Bekleyenleri incele" + "Eskale gerektirenler" (Yöneticiye ilet /
 * Satın alma talebi hazırla). View-only triage; finalize aksiyonları ilgili ekranda (gizli).
 */
interface StockRow {
  name: string | null;
  code: string;
  available: number;
  minQty: number;
  unit: string;
  low: boolean;
}

export function AssistantOverview() {
  const { t } = useTranslation('common');

  const approvals = trpc.dashboard.pendingApprovals.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  // R5 (#727) — "Eskale et": asistan bekleyen onayı yöneticilere iletir (Karar
  // 10: asistan onaylayamaz → kararı yetkiliye taşır). Backend bildirim üretir.
  const escalate = trpc.approval.escalate.useMutation({
    onSuccess: (res) => {
      toast.success(
        res.notified > 0
          ? t('overview.asistan.escalateDone', { count: res.notified })
          : t('overview.asistan.escalateNoManager'),
      );
    },
    onError: (err) => toast.error(mapTrpcError(err, t)),
  });
  const stock = trpc.dashboard.stockOverview.useQuery(undefined, { refetchInterval: 60_000 });
  const compliance = billingApi.compliancePulse.useQuery(undefined, { refetchInterval: 60_000 });

  const approvalRows = approvals.data?.items ?? [];
  const approvalCount = approvalRows.length;
  const critical = [
    ...((stock.data?.lenses ?? []) as StockRow[]),
    ...((stock.data?.supplies ?? []) as StockRow[]),
    ...((stock.data?.drugs ?? []) as StockRow[]),
  ].filter((r) => r.low);
  const criticalCount = critical.length;
  const unpaid = compliance.data?.activeUnpaidEncounters.length ?? 0;
  const bypassActive = compliance.data?.bypassActiveCount ?? 0;

  return (
    <OverviewShell
      title={t('overview.asistan.title')}
      actions={
        <Button asChild size="lg">
          <Link to="/approvals">
            <ClipboardCheck className="mr-2 h-4 w-4" aria-hidden />
            {t('overview.asistan.reviewPending')}
          </Link>
        </Button>
      }
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewStatCard
          icon={ClipboardCheck}
          tint="amber"
          value={approvals.isLoading ? '—' : approvalCount}
          label={t('overview.asistan.kpiApprovals')}
          to="/approvals"
        />
        <OverviewStatCard
          icon={Boxes}
          tint={criticalCount > 0 ? 'rose' : 'emerald'}
          value={stock.isLoading ? '—' : criticalCount}
          label={t('overview.asistan.kpiStock')}
          to="/inventory/iol"
        />
        <OverviewStatCard
          icon={ShieldOff}
          tint={unpaid > 0 ? 'rose' : 'emerald'}
          value={compliance.isLoading ? '—' : unpaid}
          label={t('overview.asistan.kpiUnpaid')}
          to="/worklist"
        />
        <OverviewStatCard
          icon={ShieldOff}
          tint={bypassActive > 0 ? 'rose' : 'emerald'}
          value={compliance.isLoading ? '—' : bypassActive}
          label={t('overview.asistan.kpiBypass')}
          to="/worklist"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {/* Eskale gerektirenler: onaylar — asistan onaylamaz, inceler/iletir. */}
        <WidgetShell
          title={t('overview.asistan.widgetEscalate')}
          icon={<ArrowUpRight className="h-4 w-4" />}
          loading={approvals.isLoading}
          error={approvals.error ? { message: t('overview.asistan.loadError') } : null}
          empty={!approvals.isLoading && approvalCount === 0}
          emptyLabel={t('overview.asistan.emptyApprovals')}
        >
          <ul className="space-y-1">
            {approvalRows.slice(0, 6).map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
              >
                <Link to="/approvals" className="min-w-0 flex-1 truncate text-muted-foreground">
                  {a.reason || t('overview.asistan.discountRequest')}
                </Link>
                <span className="shrink-0 font-medium tabular-nums text-amber-600">
                  %{a.discountPercent}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2"
                  disabled={escalate.isPending}
                  onClick={() => escalate.mutate({ id: a.id })}
                  data-testid={`escalate-${a.id}`}
                >
                  <ArrowUpRight className="mr-1 h-3.5 w-3.5" aria-hidden />
                  {t('overview.asistan.escalate')}
                </Button>
              </li>
            ))}
          </ul>
        </WidgetShell>

        {/* Kritik stok — asistan satın alma talebi hazırlar (PO onaylayamaz). */}
        <WidgetShell
          title={t('overview.asistan.widgetStock')}
          icon={<Boxes className="h-4 w-4" />}
          loading={stock.isLoading}
          error={stock.error ? { message: t('overview.asistan.loadError') } : null}
          empty={!stock.isLoading && criticalCount === 0}
          emptyLabel={t('overview.asistan.emptyStock')}
        >
          <ul className="space-y-1">
            {critical.slice(0, 6).map((r) => (
              <li key={r.code}>
                <Link
                  to="/inventory/iol"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate">{r.name ?? r.code}</span>
                  <span className="shrink-0 text-xs tabular-nums text-rose-600">
                    {r.available}/{r.minQty} {r.unit}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </WidgetShell>
      </section>
    </OverviewShell>
  );
}
