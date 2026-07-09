import { useMemo } from 'react';
import { Cpu, MemoryStick, HardDrive, Timer } from 'lucide-react';
import { PageHeader, StatCard, Card, Alert, Spinner, type Tone } from '../components/ui';
import { Sparkline } from '../components/Sparkline';
import { Freshness } from '../components/Freshness';
import { useApiQuery } from '../lib/useApiQuery';
import { api } from '../lib/api';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useI18n } from '../i18n';
import { formatBytes, usagePct, type MetricsSnapshot } from '../lib/metric-types';
import type { HealthSnapshot } from '../lib/health-types';

// #1086 — İZLEME › Sunucu ekranı. #1085 metrik REST'i (latest 30sn poll +
// range on-demand). Deployment kartı Sağlık sayfasından buraya taşınır (tek
// sahibi bu ekran). Grafikler inline SVG (recharts YOK — #1068).

function diskTone(pct: number | null): Tone {
  if (pct === null) return 'neutral';
  if (pct > 90) return 'critical';
  if (pct > 80) return 'warning';
  return 'success';
}
function cpuTone(pct: number): Tone {
  if (pct > 90) return 'critical';
  if (pct > 80) return 'warning';
  return 'primary';
}

export function ServerMonitorPage() {
  const { state } = usePlatformAuth();
  const { t } = useI18n();
  const bearer = state.status === 'authenticated' ? state.accessToken : undefined;
  const opts = { enabled: !!bearer };

  const latest = useApiQuery(
    ['metrics-latest'],
    () => api<MetricsSnapshot | null>('/platform/metrics/latest', { bearer }),
    { ...opts, refetchInterval: 30_000 },
  );
  // Deployment bilgisi Sağlık snapshot'ından (metrik snapshot deployment tutmaz).
  const health = useApiQuery(
    ['metrics-deployment'],
    () => api<HealthSnapshot>('/platform/health/snapshot', { bearer }),
    opts,
  );
  // Trend: son 24s (5dk adım) — 7g'de 60dk adım.
  const range = useApiQuery(
    ['metrics-range-24h'],
    () =>
      api<MetricsSnapshot[]>('/platform/metrics/range', {
        bearer,
        query: { stepMinutes: '15' },
      }),
    opts,
  );

  const trend = useMemo(() => {
    const rows = range.data ?? [];
    return {
      cpu: rows.map((r) => r.hostCpuPct),
      memPct: rows.map((r) => usagePct(r.hostMemUsedBytes, r.hostMemTotalBytes) ?? 0),
      lag: rows.map((r) => r.nodeEventLoopLagMs),
    };
  }, [range.data]);

  if (latest.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const m = latest.data;
  const dep = health.data?.deployment;

  return (
    <div className="space-y-6" data-testid="server-monitor-page">
      <PageHeader title={t('monitoring.server.title')} description={t('monitoring.server.desc')} />
      <Freshness capturedAt={m?.capturedAt} />

      {latest.error && <Alert tone="error">{t('monitoring.loadError')}</Alert>}

      {!m ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            {t('monitoring.emptyCollecting', { count: (range.data ?? []).length })}
          </p>
        </Card>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={Cpu}
              tint={cpuTone(m.hostCpuPct)}
              label={t('monitoring.server.cpu')}
              value={`${m.hostCpuPct.toFixed(0)}%`}
            />
            <StatCard
              icon={MemoryStick}
              tint="primary"
              label={t('monitoring.server.ram')}
              value={`${formatBytes(m.hostMemUsedBytes)} / ${formatBytes(m.hostMemTotalBytes)}`}
              hint={`${(usagePct(m.hostMemUsedBytes, m.hostMemTotalBytes) ?? 0).toFixed(0)}%`}
            />
            <StatCard
              icon={HardDrive}
              tint={diskTone(usagePct(m.hostDiskUsedBytes, m.hostDiskTotalBytes))}
              label={t('monitoring.server.disk')}
              value={
                m.hostDiskTotalBytes > 0
                  ? `${formatBytes(m.hostDiskUsedBytes)} / ${formatBytes(m.hostDiskTotalBytes)}`
                  : t('monitoring.unknown')
              }
              hint={
                usagePct(m.hostDiskUsedBytes, m.hostDiskTotalBytes) !== null
                  ? `${(usagePct(m.hostDiskUsedBytes, m.hostDiskTotalBytes) ?? 0).toFixed(0)}%`
                  : undefined
              }
            />
            <StatCard
              icon={Timer}
              tint="neutral"
              label={t('monitoring.server.uptime')}
              value={
                dep ? new Date(dep.deployedAt).toLocaleString('tr-TR') : t('monitoring.unknown')
              }
            />
          </section>

          {/* Node.js process */}
          <Card>
            <h2 className="mb-3 text-sm font-semibold">{t('monitoring.server.nodeProcess')}</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">{t('monitoring.server.heapUsed')}</dt>
                <dd className="tabular-nums font-medium">{formatBytes(m.nodeHeapUsedBytes)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('monitoring.server.rss')}</dt>
                <dd className="tabular-nums font-medium">{formatBytes(m.nodeRssBytes)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('monitoring.server.eventLoopLag')}</dt>
                <dd className="tabular-nums font-medium">{m.nodeEventLoopLagMs.toFixed(1)} ms</dd>
              </div>
            </dl>
          </Card>

          {/* Trend */}
          <Card>
            <h2 className="mb-3 text-sm font-semibold">{t('monitoring.server.trend24h')}</h2>
            {range.data && range.data.length > 1 ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <TrendCell
                  label={t('monitoring.server.cpu')}
                  values={trend.cpu}
                  threshold={80}
                  max={100}
                />
                <TrendCell label={t('monitoring.server.ram')} values={trend.memPct} max={100} />
                <TrendCell label={t('monitoring.server.eventLoopLag')} values={trend.lag} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('monitoring.emptyCollecting', { count: (range.data ?? []).length })}
              </p>
            )}
          </Card>

          {/* Deployment */}
          <Card>
            <h2 className="mb-3 text-sm font-semibold">{t('monitoring.server.deployment')}</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">gitSha</dt>
                <dd className="tabular-nums font-medium">{dep?.gitSha?.slice(0, 7) ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">imageTag</dt>
                <dd className="font-medium">{dep?.imageTag ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">buildTime</dt>
                <dd className="font-medium">
                  {dep?.buildTime ? new Date(dep.buildTime).toLocaleString('tr-TR') : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">nodeEnv</dt>
                <dd className="font-medium">{dep?.nodeEnv ?? '—'}</dd>
              </div>
            </dl>
          </Card>
        </>
      )}
    </div>
  );
}

function TrendCell({
  label,
  values,
  threshold,
  max,
}: {
  label: string;
  values: number[];
  threshold?: number;
  max?: number;
}) {
  const last = values.length > 0 ? values[values.length - 1] : null;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {last !== null && (
          <span className="tabular-nums text-xs font-medium">{last.toFixed(1)}</span>
        )}
      </div>
      <Sparkline values={values} threshold={threshold} max={max} ariaLabel={label} width={220} />
    </div>
  );
}
