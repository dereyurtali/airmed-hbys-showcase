import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/table';
import { localeToIntl } from '../lib/i18n-format';
import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { exportRowsToExcel } from '../lib/excel-export';
import { trpc } from '../lib/trpc';
import { useLocale } from '../providers/LocaleProvider';

export function ReportsPage() {
  const { t } = useTranslation(['reports', 'common']);
  const { locale } = useLocale();
  const dateLocale = localeToIntl(locale) ?? 'tr-TR';

  const [cohortMonths, setCohortMonths] = useState(12);
  const [retentionDays, setRetentionDays] = useState(90);
  const [heatmapDays, setHeatmapDays] = useState(30);
  const [revenueMonths, setRevenueMonths] = useState(6);

  // #402 — Aylık ciro raporu ("bu ay ne kazandık?"). metric.revenueTrend.
  const revenue = trpc.metric.revenueTrend.useQuery({ months: revenueMonths });
  const revenueRows = useMemo(
    () =>
      (revenue.data?.months ?? []).map((r) => ({
        ay: r.month,
        ciro: r.revenueTjs,
      })),
    [revenue.data],
  );

  const cohort = trpc.metric.cohort.useQuery({ months: cohortMonths });
  const retention = trpc.metric.retention.useQuery({
    cohortMonths,
    lookAheadDays: retentionDays,
  });
  const heatmap = trpc.metric.doctorHeatmap.useQuery({ days: heatmapDays });

  const fmtMonth = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(dateLocale, { year: 'numeric', month: 'short' });
  };

  const cohortRows = useMemo(
    () => (cohort.data ?? []).map((r) => ({ ay: fmtMonth(r.bucket), yeni_hasta: r.count })),
    [cohort.data, locale],
  );

  const retentionRows = useMemo(
    () =>
      (retention.data ?? []).map((r) => ({
        ay: fmtMonth(r.bucket),
        toplam: r.total,
        donen: r.returned,
        oran_yuzde: Math.round(r.rate * 100),
      })),
    [retention.data, locale],
  );

  const heatmapMatrix = useMemo(() => {
    const matrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const cell of heatmap.data ?? []) {
      matrix[cell.dow]![cell.hour] = cell.count;
    }
    return matrix;
  }, [heatmap.data]);

  const maxCount = useMemo(() => {
    let max = 0;
    for (const row of heatmapMatrix) {
      for (const v of row) if (v > max) max = v;
    }
    return max;
  }, [heatmapMatrix]);

  const dayLabels = [
    t('reports:days.sun'),
    t('reports:days.mon'),
    t('reports:days.tue'),
    t('reports:days.wed'),
    t('reports:days.thu'),
    t('reports:days.fri'),
    t('reports:days.sat'),
  ];

  const exportHeatmap = () => {
    const rows: Record<string, unknown>[] = [];
    for (let dow = 0; dow < 7; dow++) {
      const row: Record<string, unknown> = { gun: dayLabels[dow] };
      for (let h = 0; h < 24; h++) {
        row[`${h}:00`] = heatmapMatrix[dow]![h];
      }
      rows.push(row);
    }
    void exportRowsToExcel('doctor-heatmap.xlsx', 'Heatmap', rows);
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('reports:title')} description={t('reports:description')} />

      {/* #413 — Rapor sorgusu hata verdiyse görünür uyarı (eskiden sessiz boş kalıyordu). */}
      {(revenue.isError || cohort.isError || retention.isError || heatmap.isError) && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t('reports:loadError', {
            defaultValue: 'Bazı raporlar yüklenemedi. Bağlantıyı kontrol edip tekrar deneyin.',
          })}
        </div>
      )}

      {/* #402 — Aylık ciro raporu (tahsilat TJS karşılığı). */}
      <section className="space-y-3 rounded-md border bg-background p-4">
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">
            {t('reports:revenue.title', { defaultValue: 'Aylık Ciro' })}
          </h2>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">
              {t('reports:cohort.months', { defaultValue: 'Ay' })}
            </label>
            <select
              value={revenueMonths}
              onChange={(e) => setRevenueMonths(Number(e.target.value))}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {[3, 6, 12, 24].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void exportRowsToExcel('revenue.xlsx', 'Ciro', revenueRows)}
              disabled={revenueRows.length === 0}
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              {t('reports:export')}
            </Button>
          </div>
        </header>
        <p className="text-xs text-muted-foreground">
          {t('reports:revenue.description', {
            defaultValue: 'İade hariç tahsilatların TJS karşılığı, ay bazında.',
          })}
        </p>
        {revenue.isLoading ? (
          <p className="text-sm text-muted-foreground">{t('common:actions.loading')}</p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueRows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="ay" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => `${Number(v).toLocaleString(dateLocale)} TJS`} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="ciro"
                  name={t('reports:revenue.title', { defaultValue: 'Aylık Ciro' })}
                  stroke="#16a34a"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-md border bg-background p-4">
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t('reports:cohort.title')}</h2>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">{t('reports:cohort.months')}</label>
            <select
              value={cohortMonths}
              onChange={(e) => setCohortMonths(Number(e.target.value))}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {[6, 12, 18, 24].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void exportRowsToExcel('cohort.xlsx', 'Cohort', cohortRows)}
              disabled={cohortRows.length === 0}
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              {t('reports:export')}
            </Button>
          </div>
        </header>
        <p className="text-xs text-muted-foreground">{t('reports:cohort.description')}</p>
        {cohort.isLoading ? (
          <p className="text-sm text-muted-foreground">{t('common:actions.loading')}</p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cohortRows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="ay" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="yeni_hasta"
                  name={t('reports:cohort.newPatients')}
                  stroke="#2563eb"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-md border bg-background p-4">
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t('reports:retention.title')}</h2>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">
              {t('reports:retention.lookAhead')}
            </label>
            <select
              value={retentionDays}
              onChange={(e) => setRetentionDays(Number(e.target.value))}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {[30, 60, 90, 180].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void exportRowsToExcel('retention.xlsx', 'Retention', retentionRows)}
              disabled={retentionRows.length === 0}
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              {t('reports:export')}
            </Button>
          </div>
        </header>
        <p className="text-xs text-muted-foreground">{t('reports:retention.description')}</p>
        {retention.isLoading ? (
          <p className="text-sm text-muted-foreground">{t('common:actions.loading')}</p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={retentionRows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="ay" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Bar dataKey="oran_yuzde" name={t('reports:retention.ratePct')} fill="#16a34a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-md border bg-background p-4">
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t('reports:heatmap.title')}</h2>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">{t('reports:heatmap.days')}</label>
            <select
              value={heatmapDays}
              onChange={(e) => setHeatmapDays(Number(e.target.value))}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {[7, 14, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" onClick={exportHeatmap} disabled={maxCount === 0}>
              <Download className="mr-1 h-3.5 w-3.5" />
              {t('reports:export')}
            </Button>
          </div>
        </header>
        <p className="text-xs text-muted-foreground">{t('reports:heatmap.description')}</p>
        {heatmap.isLoading ? (
          <p className="text-sm text-muted-foreground">{t('common:actions.loading')}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-2 py-1 text-left text-muted-foreground"></TableHead>
                  {Array.from({ length: 24 }, (_, h) => (
                    <TableHead key={h} className="w-7 px-1 text-center text-muted-foreground">
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {heatmapMatrix.map((row, dow) => (
                  <TableRow key={dow}>
                    <TableCell className="px-2 py-1 font-medium text-muted-foreground">
                      {dayLabels[dow]}
                    </TableCell>
                    {row.map((count, h) => {
                      const intensity = maxCount > 0 ? count / maxCount : 0;
                      const bg =
                        count === 0
                          ? 'rgb(243 244 246)'
                          : `rgba(37, 99, 235, ${0.15 + intensity * 0.75})`;
                      return (
                        <TableCell
                          key={h}
                          className="w-7 border border-white text-center"
                          style={{
                            backgroundColor: bg,
                            color: intensity > 0.5 ? 'white' : 'inherit',
                          }}
                          title={`${dayLabels[dow]} ${h}:00 → ${count}`}
                        >
                          {count || ''}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
