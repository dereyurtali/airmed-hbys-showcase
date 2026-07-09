import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ClipboardList, ShoppingCart, Undo2, Wallet } from 'lucide-react';
import { OverviewShell, OverviewStatCard } from '../../components/overview';
import { WidgetShell } from '../../components/dashboard/WidgetShell';
import { trpc } from '../../lib/trpc';

/**
 * Eczane Genel Bakış — yarı-bağımsız perakende. v0.4.2 R9 (#731). Gerçek veri (anti-AI).
 * Kilitli markalı sidebar; walk-in anonim (KVKK). Reçete kuyruğunda **MRN-only** (hasta adı yok).
 * Operasyonel home base POS (/pharmacy/pos); bu pinned hızlı-erişim.
 */
function isToday(iso?: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}
function fmtTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function EczaneOverview() {
  const { t } = useTranslation('common');

  const rx = trpc.pharmacyRetail.dispensablePrescriptions.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const sales = trpc.pharmacyRetail.listSales.useQuery({}, { refetchInterval: 60_000 });
  const returns = trpc.pharmacyRetail.listReturns.useQuery({}, { refetchInterval: 60_000 });
  const cash = trpc.pharmacyRetail.currentCash.useQuery(undefined, { refetchInterval: 60_000 });

  const rxRows = rx.data ?? [];
  const rxCount = rxRows.length;
  const todaySales = (sales.data ?? []).filter((s) => isToday(s.soldAt));
  const salesCount = todaySales.length;
  const turnover = todaySales.reduce((sum, s) => sum + Number(s.totalAmount), 0);
  const currency = todaySales[0]?.currency ?? '';
  const returnsCount = (returns.data ?? []).length;
  const cashStatus = cash.data?.status ?? null;

  return (
    <OverviewShell title={t('overview.eczane.title')}>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewStatCard
          icon={ClipboardList}
          tint="sky"
          value={rx.isLoading ? '—' : rxCount}
          label={t('overview.eczane.kpiRx')}
          to="/pharmacy/prescriptions"
          badge={
            <span className="rounded-badge border border-info-border bg-info-bg px-2 py-0.5 text-xs font-medium text-info-foreground">
              {t('overview.eczane.live')}
            </span>
          }
        />
        <OverviewStatCard
          icon={ShoppingCart}
          tint="emerald"
          value={sales.isLoading ? '—' : salesCount}
          label={t('overview.eczane.kpiSales')}
          to="/pharmacy/pos"
        />
        <OverviewStatCard
          icon={Wallet}
          tint="blue"
          value={sales.isLoading ? '—' : `${turnover.toFixed(0)} ${currency}`}
          label={t('overview.eczane.kpiTurnover')}
          to="/pharmacy/reports"
        />
        <OverviewStatCard
          icon={Undo2}
          tint={returnsCount > 0 ? 'amber' : 'emerald'}
          value={returns.isLoading ? '—' : returnsCount}
          label={t('overview.eczane.kpiReturns')}
          to="/pharmacy/returns"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <WidgetShell
          title={t('overview.eczane.widgetRx')}
          icon={<ClipboardList className="h-4 w-4" />}
          loading={rx.isLoading}
          error={rx.error ? { message: t('overview.eczane.loadError') } : null}
          empty={!rx.isLoading && rxCount === 0}
          emptyLabel={t('overview.eczane.emptyRx')}
        >
          <ul className="space-y-1">
            {rxRows.slice(0, 6).map((r) => (
              <li key={r.id}>
                <Link
                  to="/pharmacy/prescriptions"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  {/* KVKK: hasta adı YOK, yalnız MRN. */}
                  <span className="font-mono text-xs text-muted-foreground">
                    {r.patient?.mrn ?? t('overview.eczane.anonymous')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {t('overview.eczane.rxItem')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </WidgetShell>

        <WidgetShell
          title={t('overview.eczane.widgetSales')}
          icon={<ShoppingCart className="h-4 w-4" />}
          loading={sales.isLoading}
          error={sales.error ? { message: t('overview.eczane.loadError') } : null}
          empty={!sales.isLoading && salesCount === 0}
          emptyLabel={t('overview.eczane.emptySales')}
        >
          <ul className="space-y-1">
            {todaySales.slice(0, 6).map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                <span className="w-12 shrink-0 tabular-nums text-xs text-muted-foreground">
                  {fmtTime(s.soldAt)}
                </span>
                <span className="min-w-0 flex-1 truncate text-right tabular-nums">
                  {Number(s.totalAmount).toFixed(0)} {s.currency}
                </span>
              </li>
            ))}
          </ul>
        </WidgetShell>

        <WidgetShell title={t('overview.eczane.widgetCash')} icon={<Wallet className="h-4 w-4" />}>
          <div className="space-y-3">
            <div className="text-sm">
              <span className="text-muted-foreground">{t('overview.eczane.cashStatus')}: </span>
              <span className="font-medium">
                {cashStatus
                  ? t(`overview.eczane.cash.${cashStatus}`, { defaultValue: cashStatus })
                  : t('overview.eczane.cash.none')}
              </span>
            </div>
            <Link
              to="/pharmacy/cash"
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              <Wallet className="h-4 w-4 text-muted-foreground" aria-hidden />
              {t('overview.eczane.goCash')}
            </Link>
          </div>
        </WidgetShell>
      </section>
    </OverviewShell>
  );
}
