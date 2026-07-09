import { useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDate } from '../../lib/i18n-format';
import { useLocale } from '../../providers/LocaleProvider';
import { trpc } from '../../lib/trpc';
import { DataErrorState } from '../common/DataErrorState';

// #422 — Glokom/retina kronik trend. 10 ölçüm tipi kaydedilirken yalnız "bugün
// en yeni" + düz geçmiş vardı; zaman-içi eğri yoktu. Bu bileşen sayısal ölçüm
// metriklerini (IOP eğrisi, axial length, korneal kalınlık) tarih ekseninde
// OD/OS çizer — glokom IOP takibi + biyometrik seri.

interface Props {
  patientId: string;
}

// Trend'lenebilir tipler: values JSONB'den OD/OS sayısal alanı + birim.
const TREND_METRICS: Record<string, { odKey: string; osKey: string; unit: string }> = {
  intraocular_pressure: { odKey: 'od', osKey: 'os', unit: 'mmHg' },
  biometry: { odKey: 'axialLengthOd', osKey: 'axialLengthOs', unit: 'mm' },
  pachymetry: { odKey: 'od', osKey: 'os', unit: 'µm' },
};

interface MeasurementRow {
  type: string;
  measuredAt: string | Date;
  values: unknown;
}

function numAt(values: unknown, key: string): number | null {
  if (!values || typeof values !== 'object') return null;
  const raw = (values as Record<string, unknown>)[key];
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

export function MeasurementTrendChart({ patientId }: Props) {
  const { t } = useTranslation(['measurement', 'common']);
  const { locale } = useLocale();
  const query = trpc.measurement.listByPatient.useQuery({ patientId }, { enabled: !!patientId });
  const rows = (query.data ?? []) as unknown as MeasurementRow[];

  // Yalnız ≥2 sayısal veri noktası olan trend'lenebilir tipler seçilebilir.
  const availableTypes = useMemo(() => {
    return Object.keys(TREND_METRICS).filter((type) => {
      const metric = TREND_METRICS[type];
      const points = rows.filter(
        (r) =>
          r.type === type &&
          (numAt(r.values, metric.odKey) !== null || numAt(r.values, metric.osKey) !== null),
      );
      return points.length >= 2;
    });
  }, [rows]);

  const [selected, setSelected] = useState<string | null>(null);
  const activeType = selected && availableTypes.includes(selected) ? selected : availableTypes[0];

  const series = useMemo(() => {
    if (!activeType) return [];
    const metric = TREND_METRICS[activeType];
    return rows
      .filter((r) => r.type === activeType)
      .map((r) => ({
        date: formatDate(r.measuredAt, locale),
        ts: new Date(r.measuredAt).getTime(),
        od: numAt(r.values, metric.odKey),
        os: numAt(r.values, metric.osKey),
      }))
      .filter((p) => p.od !== null || p.os !== null)
      .sort((a, b) => a.ts - b.ts);
  }, [rows, activeType, locale]);

  return (
    <section className="rounded-lg border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold">{t('measurement:trend.title')}</h2>
        </div>
        {availableTypes.length > 0 && activeType && (
          <div className="flex flex-wrap gap-1">
            {availableTypes.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setSelected(type)}
                aria-pressed={type === activeType}
                className={
                  'rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ' +
                  (type === activeType
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70')
                }
              >
                {t(`measurement:types.${type}`, { defaultValue: type })}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="p-4">
        {query.isLoading && <div className="h-48 animate-pulse rounded-md bg-muted" />}

        {query.isError && !query.data && (
          <DataErrorState
            onRetry={() => query.refetch()}
            message={t('measurement:trend.loadError')}
          />
        )}

        {!query.isLoading && !query.isError && !activeType && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t('measurement:trend.empty')}
          </p>
        )}

        {activeType && series.length > 0 && (
          <>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    width={44}
                    unit={` ${TREND_METRICS[activeType].unit}`}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip formatter={(v) => `${v} ${TREND_METRICS[activeType].unit}`} />
                  <Line
                    type="monotone"
                    dataKey="od"
                    name={t('measurement:trend.od')}
                    stroke="#2563eb"
                    strokeWidth={2}
                    connectNulls
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="os"
                    name={t('measurement:trend.os')}
                    stroke="#db2777"
                    strokeWidth={2}
                    connectNulls
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex items-center justify-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#2563eb]" /> {t('measurement:trend.od')}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#db2777]" /> {t('measurement:trend.os')}
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
