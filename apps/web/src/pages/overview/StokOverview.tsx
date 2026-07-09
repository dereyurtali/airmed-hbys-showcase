import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Boxes, Package, Pill, ClipboardList, Plus, Truck, LineChart } from 'lucide-react';
import { OverviewShell, OverviewStatCard } from '../../components/overview';
import { WidgetShell } from '../../components/dashboard/WidgetShell';
import { trpc } from '../../lib/trpc';

/**
 * Stok & Satın Alma Genel Bakış — depo + tedarik. v0.4.2 R8 (#730). Gerçek veri (anti-AI).
 * Hasta/finans ekranı KAPALI (modül-kısıt). Görev ayrılığı: PO oluşturur/teslim alır ama
 * ONAYLAYAMAZ. Kritik IOL/Sarf + açık siparişler + hızlı işlemler.
 */
interface StockRow {
  name: string | null;
  code: string;
  available: number;
  minQty: number;
  unit: string;
  low: boolean;
}

function lowCount(rows?: StockRow[] | null): number {
  return (rows ?? []).filter((r) => r.low).length;
}

export function StokOverview() {
  const { t } = useTranslation('common');

  const stock = trpc.dashboard.stockOverview.useQuery(undefined, { refetchInterval: 60_000 });
  const pos = trpc.purchaseOrder.list.useQuery({}, { refetchInterval: 60_000 });

  const lenses = (stock.data?.lenses ?? []) as StockRow[];
  const consumables = (stock.data?.supplies ?? []) as StockRow[];
  const medications = (stock.data?.drugs ?? []) as StockRow[];
  const criticalIol = lowCount(lenses);
  const criticalConsumable = lowCount(consumables);
  const criticalMed = lowCount(medications);
  const poRows = pos.data ?? [];
  const poCount = poRows.length;

  const criticalAll = [...lenses, ...consumables, ...medications].filter((r) => r.low);

  return (
    <OverviewShell title={t('overview.stok.title')}>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <OverviewStatCard
          icon={Boxes}
          tint={criticalIol > 0 ? 'rose' : 'emerald'}
          value={stock.isLoading ? '—' : criticalIol}
          label={t('overview.stok.kpiIol')}
          to="/inventory/iol"
        />
        <OverviewStatCard
          icon={Package}
          tint={criticalConsumable > 0 ? 'rose' : 'emerald'}
          value={stock.isLoading ? '—' : criticalConsumable}
          label={t('overview.stok.kpiConsumable')}
          to="/inventory/consumables"
        />
        <OverviewStatCard
          icon={Pill}
          tint={criticalMed > 0 ? 'amber' : 'emerald'}
          value={stock.isLoading ? '—' : criticalMed}
          label={t('overview.stok.kpiMed')}
        />
        <OverviewStatCard
          icon={ClipboardList}
          tint="blue"
          value={pos.isLoading ? '—' : poCount}
          label={t('overview.stok.kpiPo')}
          to="/purchase-orders"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <WidgetShell
          title={t('overview.stok.widgetCritical')}
          icon={<Boxes className="h-4 w-4" />}
          loading={stock.isLoading}
          error={stock.error ? { message: t('overview.stok.loadError') } : null}
          empty={!stock.isLoading && criticalAll.length === 0}
          emptyLabel={t('overview.stok.emptyCritical')}
        >
          <ul className="space-y-1">
            {criticalAll.slice(0, 6).map((r) => (
              <li key={r.code}>
                <Link
                  to="/inventory/iol"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate">{r.name ?? r.code}</span>
                  <span className="shrink-0 text-xs tabular-nums text-critical-foreground">
                    {r.available}/{r.minQty} {r.unit}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </WidgetShell>

        <WidgetShell
          title={t('overview.stok.widgetPo')}
          icon={<ClipboardList className="h-4 w-4" />}
          loading={pos.isLoading}
          error={pos.error ? { message: t('overview.stok.loadError') } : null}
          empty={!pos.isLoading && poCount === 0}
          emptyLabel={t('overview.stok.emptyPo')}
        >
          <ul className="space-y-1">
            {poRows.slice(0, 6).map((po) => (
              <li key={po.id}>
                <Link
                  to="/purchase-orders"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {po.orderNo}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{po.supplier?.name ?? '—'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </WidgetShell>

        <WidgetShell title={t('overview.stok.widgetQuick')} icon={<Plus className="h-4 w-4" />}>
          <div className="space-y-1">
            <Link
              to="/purchase-orders"
              className="flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium hover:bg-muted"
            >
              <Plus className="h-4 w-4 text-muted-foreground" aria-hidden />
              {t('overview.stok.quickNewPo')}
            </Link>
            <Link
              to="/inventory/stock-movements"
              className="flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium hover:bg-muted"
            >
              <Truck className="h-4 w-4 text-muted-foreground" aria-hidden />
              {t('overview.stok.quickReceive')}
            </Link>
            <Link
              to="/inventory/forecast"
              className="flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium hover:bg-muted"
            >
              <LineChart className="h-4 w-4 text-muted-foreground" aria-hidden />
              {t('overview.stok.quickForecast')}
            </Link>
          </div>
        </WidgetShell>
      </section>
    </OverviewShell>
  );
}
