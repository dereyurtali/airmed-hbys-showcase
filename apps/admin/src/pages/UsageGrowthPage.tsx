import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Users, CalendarDays, UserPlus, ChevronUp, ChevronDown } from 'lucide-react';
import { PageHeader, StatCard, Card, Badge, Spinner } from '../components/ui';
import { Sparkline } from '../components/Sparkline';
import { useApiQuery } from '../lib/useApiQuery';
import { api } from '../lib/api';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useI18n } from '../i18n';
import {
  sortRows,
  type UsageSummary,
  type TenantUsageRow,
  type TrendPoint,
  type SortKey,
} from '../lib/usage-types';

// #1088 — Klinikler › Kullanım & Büyüme. Cross-tenant karşılaştırma (sıralanabilir)
// + 12 haftalık büyüme trendi. Billing KAPSAM DIŞI.

const COLS: { key: SortKey; labelKey: string }[] = [
  { key: 'name', labelKey: 'usage.colName' },
  { key: 'users', labelKey: 'usage.colUsers' },
  { key: 'patients', labelKey: 'usage.colPatients' },
  { key: 'appointments30d', labelKey: 'usage.colAppts' },
  { key: 'invoices30d', labelKey: 'usage.colInvoices' },
  { key: 'aiConversations30d', labelKey: 'usage.colAi' },
  { key: 'dbShareRows', labelKey: 'usage.colDbShare' },
];

export function UsageGrowthPage() {
  const { state } = usePlatformAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const bearer = state.status === 'authenticated' ? state.accessToken : undefined;
  const opts = { enabled: !!bearer };

  const [sortKey, setSortKey] = useState<SortKey>('dbShareRows');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const summary = useApiQuery(
    ['usage-summary'],
    () => api<UsageSummary>('/platform/usage/summary', { bearer }),
    { ...opts, refetchInterval: 60_000 },
  );
  const tenants = useApiQuery(
    ['usage-tenants'],
    () => api<TenantUsageRow[]>('/platform/usage/tenants', { bearer }),
    opts,
  );
  const trend = useApiQuery(
    ['usage-trend'],
    () => api<TrendPoint[]>('/platform/usage/trend', { bearer, query: { weeks: '12' } }),
    opts,
  );

  const s = summary.data;
  const rows = tenants.data ? sortRows(tenants.data, sortKey, sortDir) : [];

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(key === 'name' ? 1 : -1);
    }
  };

  if (summary.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const patientTrend = (trend.data ?? []).map((p) => p.newPatients);
  const apptTrend = (trend.data ?? []).map((p) => p.appointments);

  return (
    <div className="space-y-6" data-testid="usage-growth-page">
      <PageHeader title={t('usage.title')} description={t('usage.desc')} />

      {s && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={Building2}
            tint="primary"
            label={t('usage.activeTenants')}
            value={s.activeTenants}
          />
          <StatCard icon={Users} tint="info" label={t('usage.activeUsers')} value={s.activeUsers} />
          <StatCard
            icon={CalendarDays}
            tint="neutral"
            label={t('usage.appts30d')}
            value={s.appointments30d}
          />
          <StatCard
            icon={UserPlus}
            tint="success"
            label={t('usage.newPatients30d')}
            value={s.newPatients30d}
          />
        </section>
      )}

      {/* Karşılaştırma tablosu */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('usage.comparisonHeading')}</h2>
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {COLS.map((c) => (
                  <th
                    key={c.key}
                    className="cursor-pointer select-none px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    onClick={() => toggleSort(c.key)}
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {t(c.labelKey)}
                      {sortKey === c.key &&
                        (sortDir === 1 ? (
                          <ChevronUp className="h-3 w-3" aria-hidden />
                        ) : (
                          <ChevronDown className="h-3 w-3" aria-hidden />
                        ))}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-[var(--hover)]"
                  onClick={() => navigate(`/tenants/${r.id}`)}
                  data-testid={`usage-row-${r.slug}`}
                >
                  <td className="px-3 py-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{r.name}</span>
                      {r.status !== 'active' && <Badge tone="neutral">{r.status}</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right text-sm tabular-nums">{r.users}</td>
                  <td className="px-3 py-2.5 text-right text-sm tabular-nums">{r.patients}</td>
                  <td className="px-3 py-2.5 text-right text-sm tabular-nums">
                    {r.appointments30d}
                  </td>
                  <td className="px-3 py-2.5 text-right text-sm tabular-nums">{r.invoices30d}</td>
                  <td className="px-3 py-2.5 text-right text-sm tabular-nums">
                    {r.aiConversations30d}
                  </td>
                  <td className="px-3 py-2.5 text-right text-sm tabular-nums">{r.dbShareRows}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={COLS.length}
                    className="px-3 py-8 text-center text-sm text-muted-foreground"
                  >
                    {t('usage.noTenants')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </section>

      {/* Büyüme trendi */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('usage.growthHeading')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="p-4">
            <div className="mb-2 text-xs text-muted-foreground">{t('usage.trendPatients')}</div>
            <Sparkline
              values={patientTrend}
              width={320}
              height={56}
              ariaLabel={t('usage.trendPatients')}
            />
          </Card>
          <Card className="p-4">
            <div className="mb-2 text-xs text-muted-foreground">{t('usage.trendAppts')}</div>
            <Sparkline
              values={apptTrend}
              width={320}
              height={56}
              ariaLabel={t('usage.trendAppts')}
            />
          </Card>
        </div>
      </section>
    </div>
  );
}
