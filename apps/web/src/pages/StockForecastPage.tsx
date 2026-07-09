import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/table';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, BoxIcon, CheckCircle2, ShoppingCart } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { trpc } from '../lib/trpc';
import { useLocale } from '../providers/LocaleProvider';
import { formatDate } from '../lib/i18n-format';
import { usePermission } from '../hooks/usePermission';
import {
  ForecastPoDraftDialog,
  type ForecastDraftItem,
} from '../components/purchase-order/ForecastPoDraftDialog';
import { DataErrorState } from '../components/common/DataErrorState';

// S15-PR22 — Yönetici stok tahmin sayfası. Önümüzdeki N gün planlanan
// ameliyatların PreOp'ta seçilmiş lenslerini topla → mevcut vs ihtiyaç +
// kritik uyarı (gap < 0).

interface ForecastRow {
  lotId: string;
  modelName: string;
  lotNumber: string;
  power: string;
  neededCount: number;
  availableQty: number;
  reservedQty: number;
  consumedQty: number;
  expiresAt: string;
  gap: number;
  isCritical: boolean;
}

// Delta audit A-1: `trpc as unknown as` cast'i kaldırıldı; gerçek hook
// (rows local interface'e dar cast — AppRouter type depth P1 #3.25).

export function StockForecastPage() {
  const { t } = useTranslation(['iol', 'common']);
  const { locale } = useLocale();
  const [days, setDays] = useState(7);
  const query = trpc.iol.forecast.useQuery(
    { days },
    { refetchInterval: 120_000, refetchIntervalInBackground: false },
  );
  // #372 — Geriye dönük aylık IOL tüketim raporu.
  const reportQuery = trpc.iol.consumptionReport.useQuery({ months: 6 });
  const report = reportQuery.data as
    | {
        months: {
          month: string;
          total: number;
          byModel: { modelId: string; modelName: string; consumedCount: number }[];
        }[];
      }
    | undefined;

  const data = query.data as
    | {
        horizonDays: number;
        totalPlanned: number;
        rows: ForecastRow[];
        unassignedLensCount: number;
        unassignedByType: { surgeryType: string; count: number }[];
      }
    | undefined;
  const rows = data?.rows ?? [];
  const criticalCount = rows.filter((r) => r.isCritical).length;
  const unassignedCount = data?.unassignedLensCount ?? 0;

  // R8 (#730) — procurement forecast'tan kritik lotları seçip taslak PO üretir.
  const canCreatePo = usePermission('action:po.create');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draftOpen, setDraftOpen] = useState(false);
  const toggle = (lotId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(lotId)) next.delete(lotId);
      else next.add(lotId);
      return next;
    });
  const draftItems: ForecastDraftItem[] = rows
    .filter((r) => selected.has(r.lotId))
    .map((r) => ({
      lotId: r.lotId,
      label: `${r.modelName} ${r.power}D`,
      qty: Math.max(1, r.neededCount - r.availableQty),
    }));

  return (
    <div className="space-y-6">
      <PageHeader title={t('iol:forecast.title')} description={t('iol:forecast.description')} />

      <div className="flex flex-wrap items-center gap-2">
        {[7, 14, 30].map((d) => (
          <Button
            key={d}
            size="sm"
            variant={days === d ? 'default' : 'outline'}
            onClick={() => setDays(d)}
          >
            {t('iol:forecast.horizonDays', { count: d })}
          </Button>
        ))}
        {data && (
          <span className="ml-3 text-xs text-muted-foreground">
            {t('iol:forecast.plannedCount', { count: data.totalPlanned })}
            {criticalCount > 0 && (
              <span className="ml-3 inline-flex items-center gap-1 rounded-full bg-critical-bg px-2 py-0.5 text-critical-foreground">
                <AlertTriangle className="h-3 w-3" />
                {t('iol:forecast.criticalCount', { count: criticalCount })}
              </span>
            )}
          </span>
        )}
      </div>

      {query.isError && !data ? (
        <DataErrorState onRetry={() => query.refetch()} />
      ) : (
        query.isLoading && (
          <div className="text-sm text-muted-foreground">{t('common:loading')}</div>
        )
      )}

      {/* #364 — Lens gerektiren ama lot atanmamış planlı ameliyatlar. Eskiden
          görünmüyordu (ihtiyaç 0). Yöneticiye "planla ama lens seçilmemiş" uyarısı. */}
      {unassignedCount > 0 && (
        <div className="rounded-lg border border-warning-border bg-warning-bg p-3 text-sm text-warning-foreground">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            {t('iol:forecast.unassignedTitle', { count: unassignedCount })}
          </div>
          <p className="mt-1 text-xs text-warning-foreground">{t('iol:forecast.unassignedHint')}</p>
          {data && data.unassignedByType.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {data.unassignedByType.map((u) => (
                <li key={u.surgeryType} className="tabular-nums">
                  <span className="font-medium">{u.count}×</span> {u.surgeryType}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {data && rows.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-success-foreground" />
          {t('iol:forecast.emptyPlanned')}
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table className="min-w-full text-sm">
            <TableHeader className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <TableRow>
                {canCreatePo && <TableHead className="w-8 px-3 py-2" />}
                <TableHead className="px-3 py-2 text-left">{t('iol:forecast.cols.lot')}</TableHead>
                <TableHead className="px-3 py-2 text-right">
                  {t('iol:forecast.cols.needed')}
                </TableHead>
                <TableHead className="px-3 py-2 text-right">
                  {t('iol:forecast.cols.available')}
                </TableHead>
                <TableHead className="px-3 py-2 text-right">
                  {t('iol:forecast.cols.reserved')}
                </TableHead>
                <TableHead className="px-3 py-2 text-right">{t('iol:forecast.cols.gap')}</TableHead>
                <TableHead className="px-3 py-2 text-left">
                  {t('iol:forecast.cols.expiresAt')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y">
              {rows.map((r) => (
                <TableRow
                  key={r.lotId}
                  className={r.isCritical ? 'bg-critical-bg' : 'hover:bg-muted/50'}
                  data-testid={`forecast-${r.lotId}`}
                >
                  {canCreatePo && (
                    <TableCell className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(r.lotId)}
                        onChange={() => toggle(r.lotId)}
                        aria-label={t('iol:forecast.selectRow', { defaultValue: 'Seç' })}
                        data-testid={`forecast-select-${r.lotId}`}
                        className="h-4 w-4"
                      />
                    </TableCell>
                  )}
                  <TableCell className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <BoxIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      <div>
                        <div className="font-medium">{r.modelName}</div>
                        <div className="text-xs text-muted-foreground">
                          #{r.lotNumber} · {r.power}D
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right font-medium tabular-nums">
                    {r.neededCount}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums">
                    {r.availableQty}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {r.reservedQty}
                  </TableCell>
                  <TableCell
                    className={
                      'px-3 py-2 text-right font-semibold tabular-nums ' +
                      (r.isCritical ? 'text-critical-foreground' : 'text-success-foreground')
                    }
                  >
                    {r.gap > 0 ? '+' : ''}
                    {r.gap}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-xs text-muted-foreground">
                    {formatDate(r.expiresAt, locale)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canCreatePo && selected.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
          <span className="text-sm font-medium">
            {t('iol:forecast.selectedCount', {
              count: selected.size,
              defaultValue: `${selected.size} lot seçili`,
            })}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              {t('common:actions.clear', { defaultValue: 'Temizle' })}
            </Button>
            <Button
              size="sm"
              onClick={() => setDraftOpen(true)}
              data-testid="forecast-po-draft-open"
            >
              <ShoppingCart className="mr-1 h-4 w-4" />
              {t('iol:forecast.createPoDraft', { defaultValue: 'PO Taslağı Oluştur' })}
            </Button>
          </div>
        </div>
      )}

      {draftOpen && (
        <ForecastPoDraftDialog
          items={draftItems}
          onClose={() => setDraftOpen(false)}
          onCreated={() => setSelected(new Set())}
        />
      )}

      {/* #372 — Aylık tüketim raporu (IolStockMovement consume). Eskiden hiçbir
          UI listMovements'i raporlamıyordu. */}
      {report && report.months.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">
            {t('iol:forecast.consumptionTitle', { defaultValue: 'Aylık tüketim (son 6 ay)' })}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {report.months.map((m) => (
              <div key={m.month} className="rounded-lg border bg-card p-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-sm font-medium">{m.month}</span>
                  <span className="tabular-nums text-sm text-muted-foreground">
                    {t('iol:forecast.consumedTotal', {
                      count: m.total,
                      defaultValue: `${m.total} adet`,
                    })}
                  </span>
                </div>
                <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                  {m.byModel.slice(0, 4).map((r) => (
                    <li key={r.modelId} className="flex justify-between">
                      <span className="truncate">{r.modelName}</span>
                      <span className="tabular-nums">{r.consumedCount}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
