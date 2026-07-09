import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight, RefreshCw } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useT } from '../i18n';
import { Alert, Button, PageHeader, Spinner } from '../components/ui';
import { cn } from '../lib/cn';
import type { HealthSnapshot } from '../lib/health-types';

export function HealthPage() {
  const { state } = usePlatformAuth();
  const t = useT();
  const accessToken = state.status === 'authenticated' ? state.accessToken : null;

  const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api<HealthSnapshot>('/platform/health/snapshot', { bearer: accessToken });
      setSnapshot(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('health.loadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30000);
    return () => clearInterval(id);
  }, [accessToken]); // eslint-disable-line

  return (
    <div className="space-y-6" data-testid="health-page">
      <PageHeader
        title={t('health.title')}
        action={
          <>
            {snapshot && (
              <span className="text-xs text-muted-foreground">
                {t('health.last', {
                  time: new Date(snapshot.collectedAt).toLocaleTimeString('tr-TR'),
                })}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void load()}
              loading={loading}
              data-testid="health-refresh"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              {loading ? t('health.refreshing') : t('health.refresh')}
            </Button>
          </>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {!snapshot && !error ? (
        <Spinner label={t('common.loading')} />
      ) : snapshot ? (
        <>
          {/* #1092 — Servis durumu özeti + İZLEME ekranlarına derin-link.
              Deployment detayı → Sunucu, DB detayı → Veritabanı ekranına taşındı. */}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <DetailLink
              to="/monitoring/server"
              label={t('health.linkServer')}
              value={snapshot.deployment.nodeEnv}
              hint={
                snapshot.deployment.gitSha
                  ? snapshot.deployment.gitSha.slice(0, 7)
                  : t('health.hintNoTag')
              }
              warn={snapshot.deployment.nodeEnv !== 'production'}
            />
            <DetailLink
              to="/monitoring/database"
              label={t('health.linkDatabase')}
              value={snapshot.database.sizePretty}
              hint={t('health.hintConnections', {
                active: snapshot.database.connections.active,
                idle: snapshot.database.connections.idle,
              })}
              warn={
                snapshot.database.connections.idleInTransaction > 5 ||
                snapshot.database.connections.total > 80
              }
            />
            <DetailLink
              to="/monitoring/ai"
              label={t('health.linkAi')}
              value={snapshot.database.slowQueryCountLast5m === null ? '—' : t('health.statusOk')}
              hint={t('health.linkAiHint')}
            />
          </section>

          <Section title={t('health.sectionTenantsUsers')}>
            <HealthCard
              label={t('health.cardActiveTenants')}
              value={String(snapshot.tenants.active)}
            />
            <HealthCard
              label={t('health.cardSuspendedTenants')}
              value={String(snapshot.tenants.suspended)}
              hint={t('health.hintTotal', { total: snapshot.tenants.total })}
              warn={snapshot.tenants.suspended > 0}
            />
            <HealthCard
              label={t('health.cardActiveUsers')}
              value={String(snapshot.users.totalActive)}
            />
            <HealthCard
              label={t('health.cardLockedUsers')}
              value={String(snapshot.users.lockedUsers)}
              hint={t('health.hintLockPolicy')}
              warn={snapshot.users.lockedUsers > 0}
            />
            <HealthCard
              label={t('health.cardActiveSessions')}
              value={String(snapshot.sessions.activeRefreshTokens)}
              hint={t('health.hintRefreshToken')}
            />
          </Section>

          <Section title={t('health.sectionActivity')}>
            <HealthCard
              label={t('health.cardAuditLog')}
              value={snapshot.activity.auditLogsLast24h.toLocaleString('tr-TR')}
            />
            <HealthCard
              label={t('health.cardFraudAlerts')}
              value={String(snapshot.activity.activeFraudAlerts)}
              hint={t('health.hintFraudNew')}
              warn={snapshot.activity.activeFraudAlerts > 0}
            />
            <HealthCard
              label={t('health.cardPendingCommissions')}
              value={String(snapshot.activity.commissionsPendingReview)}
              hint={t('health.hintCommissionPending')}
              warn={snapshot.activity.commissionsPendingReview > 10}
            />
          </Section>

          <Section title={t('health.sectionStorage')}>
            <HealthCard
              label={t('health.cardIolLots')}
              value={snapshot.storage.iolLotsCount.toLocaleString('tr-TR')}
              hint={t('health.hintActive')}
            />
            <HealthCard
              label={t('health.cardPatientPhotos')}
              value={snapshot.storage.patientPhotosCount.toLocaleString('tr-TR')}
              hint={t('health.hintActive')}
            />
          </Section>
        </>
      ) : null}
    </div>
  );
}

// #1092 — Sağlık özet kartı → İZLEME ekranına derin-link ("Detay →").
function DetailLink({
  to,
  label,
  value,
  hint,
  warn = false,
}: {
  to: string;
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'group flex items-center justify-between gap-2 rounded-lg border bg-background p-4 transition-colors hover:bg-[var(--hover)]',
        warn ? 'border-[var(--warn-bd)] bg-[var(--warn-bg)]' : 'border-border',
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
          {label}
          {warn && <AlertTriangle className="h-3.5 w-3.5 text-[var(--warn-tx)]" aria-hidden />}
        </div>
        <div
          className={cn(
            'mt-1.5 truncate text-[18px] font-semibold tabular-nums leading-tight',
            warn ? 'text-[var(--warn-tx)]' : 'text-foreground',
          )}
        >
          {value}
        </div>
        {hint && <div className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</div>}
      </div>
      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

function HealthCard({
  label,
  value,
  hint,
  warn = false,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div
      data-testid={`health-card-${label}`}
      className={cn(
        'rounded-lg border bg-background p-4',
        warn ? 'border-[var(--warn-bd)] bg-[var(--warn-bg)]' : 'border-border',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-semibold text-muted-foreground">{label}</div>
        {warn && <AlertTriangle className="h-4 w-4 text-[var(--warn-tx)]" aria-hidden />}
      </div>
      <div
        className={cn(
          'mt-1.5 text-[22px] font-semibold tabular-nums leading-tight',
          warn ? 'text-[var(--warn-tx)]' : 'text-foreground',
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
