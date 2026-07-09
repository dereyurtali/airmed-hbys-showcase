import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, Building2, MessageSquare, Plus, UserCog } from 'lucide-react';
import { api } from '../lib/api';
import { useApiQuery } from '../lib/useApiQuery';
import { useUnreadFeedbackCount } from '../lib/useUnreadFeedbackCount';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useT } from '../i18n';
import { Button, Card, PageHeader, Spinner, StatCard } from '../components/ui';
import type { HealthSnapshot } from '../lib/health-types';
import type { TenantRow } from '../lib/tenant-types';
import type { ActiveImpersonationRow } from '../lib/impersonation-types';
import type { AuditListResponse } from '../lib/audit-types';
import { usagePct, type MetricsSnapshot } from '../lib/metric-types';
import type { SyncSummary } from '../lib/sync-types';

// #949 (Feature 7) — Gerçek Genel Bakış. Boş nav-hub yerine canlı KPI (tıkla →
// route) + widget (son platform aktivitesi, son eklenen tenant'lar). Veri paralel
// useApiQuery (Option A — mevcut endpoint'ler, ek backend yok), 60sn refetch.
// Anti-AI-dashboard: activity spam / vanity KPI / line chart yok; tek dominant
// primary "Yeni tenant".

export function DashboardPage() {
  const { state } = usePlatformAuth();
  const t = useT();
  const accessToken = state.status === 'authenticated' ? state.accessToken : null;
  const bearer = accessToken ?? undefined;
  const opts = { enabled: !!accessToken, refetchInterval: 60_000 };

  const health = useApiQuery(
    ['dash-health'],
    () => api<HealthSnapshot>('/platform/health/snapshot', { bearer }),
    opts,
  );
  const imp = useApiQuery(
    ['dash-imp'],
    () => api<ActiveImpersonationRow[]>('/platform/impersonate/active', { bearer }),
    opts,
  );
  // #1057 — AdminShell nav rozetiyle AYNI query key: ikinci 60sn interval yok.
  const feedback = useUnreadFeedbackCount(accessToken);
  const tenants = useApiQuery(
    ['dash-tenants'],
    () => api<TenantRow[]>('/platform/tenants', { bearer }),
    opts,
  );
  const audit = useApiQuery(
    ['dash-audit'],
    () => api<AuditListResponse>('/platform/audit', { bearer, query: { take: 10 } }),
    opts,
  );
  // #1092 — eşik-uyarı şeridi için metrik + senkron özeti (İZLEME ekranlarıyla
  // paylaşılan key değil; Genel Bakış'a özel hafif sorgu).
  const metrics = useApiQuery(
    ['dash-metrics'],
    () => api<MetricsSnapshot | null>('/platform/metrics/latest', { bearer }),
    opts,
  );
  const sync = useApiQuery(
    ['dash-sync'],
    () => api<SyncSummary>('/platform/sync/summary', { bearer }),
    opts,
  );

  const snap = health.data;
  // #1092 — eşik aşımı olan durumlar (yoksa şerit hiç render edilmez): disk >%80,
  // dead-letter >0, kilitli kullanıcı >0, aktif fraud >0.
  const diskPct = metrics.data
    ? usagePct(metrics.data.hostDiskUsedBytes, metrics.data.hostDiskTotalBytes)
    : null;
  const alerts: { key: string; to: string; label: string; critical: boolean }[] = [];
  if (diskPct !== null && diskPct > 80)
    alerts.push({
      key: 'disk',
      to: '/monitoring/server',
      label: t('dashboard.alertDisk', { pct: diskPct.toFixed(0) }),
      critical: diskPct > 90,
    });
  if ((sync.data?.deadLetter ?? 0) > 0)
    alerts.push({
      key: 'dead',
      to: '/monitoring/sync',
      label: t('dashboard.alertDeadLetter', { count: sync.data!.deadLetter }),
      critical: true,
    });
  if (snap && snap.users.lockedUsers > 0)
    alerts.push({
      key: 'locked',
      to: '/security/events',
      label: t('dashboard.alertLocked', { count: snap.users.lockedUsers }),
      critical: false,
    });
  if (snap && snap.activity.activeFraudAlerts > 0)
    alerts.push({
      key: 'fraud',
      to: '/tenants',
      label: t('dashboard.alertFraud', { count: snap.activity.activeFraudAlerts }),
      critical: false,
    });
  const healthAlerts = snap
    ? snap.activity.activeFraudAlerts +
      snap.users.lockedUsers +
      (snap.database.slowQueryCountLast5m ?? 0)
    : 0;
  const recentTenants = (tenants.data ?? [])
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 5);
  const recentAudit = audit.data?.items ?? [];

  return (
    <div className="space-y-6" data-testid="platform-dashboard-root">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title={t('dashboard.overviewTitle')}
          description={t('dashboard.overviewSubtitle')}
        />
        <Link to="/tenants/new">
          <Button data-testid="dashboard-new-tenant">
            <Plus className="h-4 w-4" aria-hidden />
            {t('dashboard.newTenant')}
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          to="/tenants"
          data-testid="dashboard-stat-tenants"
          className="focus-ring block rounded-lg"
        >
          <StatCard
            label={t('dashboard.statActiveTenants')}
            value={snap ? snap.tenants.active : '—'}
            icon={Building2}
            tint="success"
          />
        </Link>
        <Link
          to="/impersonation/active"
          data-testid="dashboard-stat-imp"
          className="focus-ring block rounded-lg"
        >
          <StatCard
            label={t('dashboard.statOpenImpersonations')}
            value={imp.data ? imp.data.length : '—'}
            icon={UserCog}
            tint="primary"
          />
        </Link>
        <Link
          to="/feedback"
          data-testid="dashboard-stat-feedback"
          className="focus-ring block rounded-lg"
        >
          <StatCard
            label={t('dashboard.statUnreadFeedback')}
            value={feedback.data ? feedback.data.count : '—'}
            icon={MessageSquare}
            tint={feedback.data && feedback.data.count > 0 ? 'warning' : 'neutral'}
          />
        </Link>
        <Link
          to="/health"
          data-testid="dashboard-stat-health"
          className="focus-ring block rounded-lg"
        >
          <StatCard
            label={t('dashboard.statHealthAlerts')}
            value={snap ? healthAlerts : '—'}
            icon={Activity}
            tint={healthAlerts > 0 ? 'critical' : 'success'}
            hint={snap ? t('dashboard.healthHint', { db: snap.database.sizePretty }) : undefined}
          />
        </Link>
      </div>

      {/* #1092 — Eşik-uyarı şeridi: yalnız aşım varsa görünür (anti-gürültü). */}
      {alerts.length > 0 && (
        <div className="space-y-1.5" data-testid="dashboard-alerts">
          {alerts.map((a) => (
            <Link
              key={a.key}
              to={a.to}
              className={
                'flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ' +
                (a.critical
                  ? 'border-[var(--crit-bg)] bg-[var(--crit-bg)] text-[var(--crit-tx)] hover:brightness-95'
                  : 'border-[var(--warn-bg)] bg-[var(--warn-bg)] text-[var(--warn-tx)] hover:brightness-95')
              }
            >
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              <span className="flex-1">{a.label}</span>
              <span className="text-xs opacity-70">→</span>
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              {t('dashboard.recentActivityTitle')}
            </h2>
            <Link to="/audit" className="text-xs text-muted-foreground hover:text-foreground">
              {t('dashboard.viewAll')}
            </Link>
          </header>
          <div className="divide-y divide-border">
            {audit.isLoading ? (
              <div className="p-4">
                <Spinner label={t('common.loading')} />
              </div>
            ) : recentAudit.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {t('dashboard.noActivity')}
              </div>
            ) : (
              recentAudit.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{a.action}</div>
                    <div className="truncate text-xs text-muted-foreground">{a.email ?? '—'}</div>
                  </div>
                  <div className="shrink-0 text-xs text-muted-foreground">
                    {new Date(a.createdAt).toLocaleString('tr-TR')}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="p-0">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              {t('dashboard.recentTenantsTitle')}
            </h2>
            <Link to="/tenants" className="text-xs text-muted-foreground hover:text-foreground">
              {t('dashboard.viewAll')}
            </Link>
          </header>
          <div className="divide-y divide-border">
            {tenants.isLoading ? (
              <div className="p-4">
                <Spinner label={t('common.loading')} />
              </div>
            ) : recentTenants.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {t('dashboard.noTenants')}
              </div>
            ) : (
              recentTenants.map((tn) => (
                <Link
                  key={tn.id}
                  to={`/tenants/${tn.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] hover:bg-[var(--hover)]"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{tn.name}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {tn.slug}
                    </div>
                  </div>
                  <div className="shrink-0 text-xs text-muted-foreground">
                    {new Date(tn.createdAt).toLocaleDateString('tr-TR')}
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
