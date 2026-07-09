import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/table';
import { localeToIntl } from '../lib/i18n-format';
import { Link } from 'react-router-dom';
import { AlertTriangle, Boxes, Droplet, Eye, Package, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../providers/LocaleProvider';
import { usePermission } from '../hooks/usePermission';
import { trpc } from '../lib/trpc';
import { DataErrorState } from '../components/common/DataErrorState';
import { Badge } from '../components/ui/badge';

// S16 — Stok & Malzeme Takibi. Lensler (IOL modeli) + Sarf Malzeme + İlaç,
// her biri toplam/rezerve/kullanılabilir/seviye/durum tablosu. Salt-okuma;
// model/lot CRUD ayrı (/inventory/iol/manage). Veri dashboard.stockOverview.

const KNOWN_LENS_TYPES = ['monofocal', 'trifocal', 'edof', 'toric'];

interface StockRow {
  lensType: string | null;
  name: string | null;
  code: string;
  total: number;
  reserved: number;
  available: number;
  unit: string;
  minQty: number;
  low: boolean;
}

type BarTone = 'emerald' | 'amber';

const BAR_FILL: Record<BarTone, string> = {
  emerald: 'bg-success-foreground',
  amber: 'bg-warning-foreground',
};

export function StockTrackingPage() {
  const { t } = useTranslation(['common', 'iol']);
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';
  const canManage = usePermission('action:iol.modelCreate');

  const query = trpc.dashboard.stockOverview.useQuery(undefined, { refetchInterval: 60_000 });
  const data = query.data;

  const now = new Date();
  const datePart = now.toLocaleDateString(dateLocale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const weekday = now.toLocaleDateString(dateLocale, { weekday: 'long' });
  const weekdayCap = weekday.charAt(0).toLocaleUpperCase(dateLocale) + weekday.slice(1);

  const rowLabel = (r: StockRow): string => {
    if (r.lensType && KNOWN_LENS_TYPES.includes(r.lensType)) {
      return t(`common:adminOverview.lensType.${r.lensType}`);
    }
    return r.name ?? '—';
  };

  return (
    <div className="space-y-6" data-testid="stock-tracking-root">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t('common:adminOverview.stockPage.title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {datePart}, {weekdayCap}
            {data?.clinicName ? ` · ${data.clinicName}` : ''}
          </p>
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-2">
            <Link
              to="/inventory/consumables"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
            >
              <Boxes className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              {t('iol:consumable.manageLink', { defaultValue: 'Sarf & Kit' })}
            </Link>
            <Link
              to="/inventory/iol/manage"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
            >
              <Settings2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              {t('common:actions.edit')}
            </Link>
          </div>
        )}
      </div>

      {query.isError && !data ? (
        <DataErrorState onRetry={() => query.refetch()} />
      ) : (
        <>
          <StockGroup
            icon={Eye}
            title={t('common:adminOverview.stockPage.lenses')}
            rows={data?.lenses}
            tone="emerald"
            rowLabel={rowLabel}
            loading={!data}
          />
          <StockGroup
            icon={Package}
            title={t('common:adminOverview.stockPage.supplies')}
            rows={data?.supplies}
            tone="emerald"
            rowLabel={rowLabel}
            loading={!data}
          />
          <StockGroup
            icon={Droplet}
            title={t('common:adminOverview.stockPage.drugs')}
            rows={data?.drugs}
            tone="amber"
            rowLabel={rowLabel}
            loading={!data}
          />
        </>
      )}
    </div>
  );
}

function StockGroup({
  icon: Icon,
  title,
  rows,
  tone,
  rowLabel,
  loading,
}: {
  icon: typeof Eye;
  title: string;
  rows: StockRow[] | undefined;
  tone: BarTone;
  rowLabel: (r: StockRow) => string;
  loading: boolean;
}) {
  const { t } = useTranslation(['common']);
  if (!loading && (!rows || rows.length === 0)) return null;

  const col = 'px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground';
  return (
    <section className="rounded-lg border bg-background">
      <header className="flex items-center gap-2 border-b px-5 py-3">
        <Icon className="h-[18px] w-[18px] text-primary" strokeWidth={1.5} aria-hidden />
        <h2 className="text-base font-semibold">{title}</h2>
      </header>
      <div className="overflow-x-auto">
        <Table className="w-full text-sm">
          <TableHeader>
            <TableRow className="border-b">
              <TableHead className={`${col} text-left`}>
                {t('common:adminOverview.stockPage.colItem')}
              </TableHead>
              <TableHead className={`${col} text-right`}>
                {t('common:adminOverview.stockPage.colTotal')}
              </TableHead>
              <TableHead className={`${col} text-right`}>
                {t('common:adminOverview.stockPage.colReserved')}
              </TableHead>
              <TableHead className={`${col} text-right`}>
                {t('common:adminOverview.stockPage.colAvailable')}
              </TableHead>
              <TableHead className={`${col} text-left`}>
                {t('common:adminOverview.stockPage.colLevel')}
              </TableHead>
              <TableHead className={`${col} text-left`}>
                {t('common:adminOverview.stockPage.colStatus')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading || !rows
              ? Array.from({ length: 2 }).map((_, i) => (
                  <TableRow key={i} className="border-b last:border-0">
                    <TableCell className="px-3 py-4" colSpan={6}>
                      <div className="h-4 w-1/2 rounded bg-muted" />
                    </TableCell>
                  </TableRow>
                ))
              : rows.map((r) => {
                  const pct =
                    r.total > 0 ? Math.max(4, Math.round((r.available / r.total) * 100)) : 0;
                  const fill = r.low ? 'bg-critical' : BAR_FILL[tone];
                  return (
                    <TableRow key={r.code || rowLabel(r)} className="border-b last:border-0">
                      <TableCell className="px-3 py-3">
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          {r.low && (
                            <AlertTriangle
                              className="h-3.5 w-3.5 shrink-0 text-critical-foreground"
                              aria-hidden
                            />
                          )}
                          {rowLabel(r)}
                        </span>
                        {r.code && (
                          <span className="ml-2 text-xs text-muted-foreground">{r.code}</span>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-right tabular-nums">{r.total}</TableCell>
                      <TableCell className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                        {r.reserved}
                      </TableCell>
                      <TableCell
                        className={`px-3 py-3 text-right tabular-nums font-semibold ${
                          r.low ? 'text-critical-foreground' : ''
                        }`}
                      >
                        {r.available}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          {r.unit}
                        </span>
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full ${fill}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        {r.low ? (
                          <Badge variant="critical">
                            {t('common:adminOverview.stockPage.low', { min: r.minQty })}
                          </Badge>
                        ) : (
                          <Badge variant="success">
                            {t('common:adminOverview.stockPage.sufficient')}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
