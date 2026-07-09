import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Percent, PackageCheck, ShieldOff, Activity } from 'lucide-react';
import { OverviewShell, OverviewStatCard } from '../../components/overview';
import { WidgetShell } from '../../components/dashboard/WidgetShell';
import { trpc } from '../../lib/trpc';
import { billingApi } from '../../lib/billing.trpc';

/**
 * Finans Genel Bakış — onay triage. v0.4.2 R7 (#729). Gerçek veri (anti-AI).
 * MALİ İZOLASYON: hasta adı / klinik bağlam GÖSTERİLMEZ (yalnız tutar / oran / tedarikçi /
 * uyum sayıları). Onay kuyrukları + pay-first uyum nabzı.
 */
export function FinansOverview() {
  const { t } = useTranslation('common');

  const approvals = trpc.dashboard.pendingApprovals.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const pos = trpc.purchaseOrder.list.useQuery(
    { pendingApprovalOnly: true },
    { refetchInterval: 60_000 },
  );
  const compliance = billingApi.compliancePulse.useQuery(undefined, { refetchInterval: 60_000 });

  const approvalRows = approvals.data?.items ?? [];
  const discountCount = approvalRows.length;
  const poRows = pos.data ?? [];
  const poCount = poRows.length;
  const unpaid = compliance.data?.activeUnpaidEncounters.length ?? 0;
  const bypassActive = compliance.data?.bypassActiveCount ?? 0;
  const bypassToday = compliance.data?.bypassTotalToday ?? 0;

  return (
    <OverviewShell title={t('overview.finans.title')}>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewStatCard
          icon={Percent}
          tint="amber"
          value={approvals.isLoading ? '—' : discountCount}
          label={t('overview.finans.kpiDiscount')}
          to="/approvals"
        />
        <OverviewStatCard
          icon={PackageCheck}
          tint="blue"
          value={pos.isLoading ? '—' : poCount}
          label={t('overview.finans.kpiPo')}
          to="/approvals"
        />
        <OverviewStatCard
          icon={ShieldOff}
          tint={unpaid > 0 ? 'rose' : 'emerald'}
          value={compliance.isLoading ? '—' : unpaid}
          label={t('overview.finans.kpiUnpaid')}
          to="/billing"
        />
        <OverviewStatCard
          icon={Activity}
          tint={bypassActive > 0 ? 'rose' : 'emerald'}
          value={compliance.isLoading ? '—' : bypassActive}
          label={t('overview.finans.kpiBypass')}
          to="/billing"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <WidgetShell
          title={t('overview.finans.widgetDiscount')}
          icon={<Percent className="h-4 w-4" />}
          loading={approvals.isLoading}
          error={approvals.error ? { message: t('overview.finans.loadError') } : null}
          empty={!approvals.isLoading && discountCount === 0}
          emptyLabel={t('overview.finans.emptyDiscount')}
        >
          <ul className="space-y-1">
            {approvalRows.slice(0, 6).map((a) => (
              <li key={a.id}>
                <Link
                  to="/approvals"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {a.reason || t('overview.finans.discountRequest')}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums text-warning-foreground">
                    %{a.discountPercent}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </WidgetShell>

        <WidgetShell
          title={t('overview.finans.widgetPo')}
          icon={<PackageCheck className="h-4 w-4" />}
          loading={pos.isLoading}
          error={pos.error ? { message: t('overview.finans.loadError') } : null}
          empty={!pos.isLoading && poCount === 0}
          emptyLabel={t('overview.finans.emptyPo')}
        >
          <ul className="space-y-1">
            {poRows.slice(0, 6).map((po) => (
              <li key={po.id}>
                <Link
                  to="/approvals"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {po.orderNo}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{po.supplier?.name ?? '—'}</span>
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                    {Number(po.totalAmount).toFixed(0)} {po.currency}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </WidgetShell>

        <WidgetShell
          title={t('overview.finans.widgetCompliance')}
          icon={<ShieldOff className="h-4 w-4" />}
          loading={compliance.isLoading}
          error={compliance.error ? { message: t('overview.finans.loadError') } : null}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-3xl font-semibold tabular-nums">{unpaid}</span>
              <span className="text-xs text-muted-foreground">
                {t('overview.finans.unpaidActive')}
              </span>
            </div>
            <div className="space-y-1 border-t pt-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('overview.finans.bypassActive')}</span>
                <span className="font-medium tabular-nums">{bypassActive}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('overview.finans.bypassToday')}</span>
                <span className="tabular-nums">{bypassToday}</span>
              </div>
            </div>
          </div>
        </WidgetShell>
      </section>
    </OverviewShell>
  );
}
