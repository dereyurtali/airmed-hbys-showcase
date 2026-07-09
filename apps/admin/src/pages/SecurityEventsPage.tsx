import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, ShieldX, Lock, UserCog } from 'lucide-react';
import {
  PageHeader,
  StatCard,
  Card,
  Table,
  Badge,
  Button,
  Spinner,
  type Column,
} from '../components/ui';
import { useApiQuery } from '../lib/useApiQuery';
import { api } from '../lib/api';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useI18n } from '../i18n';
import type { SecuritySummary, LoginAttemptRow, LockedUserRow } from '../lib/security-types';

// #1090 — GÜVENLİK › Güvenlik Olayları. Salt-görünürlük (aksiyon IP Allowlist +
// Audit ekranlarında). Login denemeleri cursor pagination (Audit deseni).

export function SecurityEventsPage() {
  const { state } = usePlatformAuth();
  const { t } = useI18n();
  const bearer = state.status === 'authenticated' ? state.accessToken : undefined;
  const opts = { enabled: !!bearer };

  const [emailFilter, setEmailFilter] = useState('');
  const [ipFilter, setIpFilter] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);

  const summary = useApiQuery(
    ['sec-summary'],
    () => api<SecuritySummary>('/platform/security/summary', { bearer }),
    { ...opts, refetchInterval: 30_000 },
  );
  const attempts = useApiQuery(
    ['sec-attempts', emailFilter, ipFilter, cursor],
    () =>
      api<{ rows: LoginAttemptRow[]; nextCursor: string | null }>(
        '/platform/security/login-attempts',
        {
          bearer,
          query: {
            email: emailFilter || undefined,
            ip: ipFilter || undefined,
            cursor: cursor || undefined,
          },
        },
      ),
    opts,
  );
  const locked = useApiQuery(
    ['sec-locked'],
    () => api<LockedUserRow[]>('/platform/security/locked-users', { bearer }),
    opts,
  );

  const s = summary.data;

  const resultBadge = (r: LoginAttemptRow) => {
    if (r.success) return <Badge tone="success">{t('security.resultSuccess')}</Badge>;
    if (r.failureReason === 'ip_denied')
      return <Badge tone="critical">{t('security.resultIpDenied')}</Badge>;
    if (r.failureReason === 'totp_failed')
      return <Badge tone="warning">{t('security.resultTotp')}</Badge>;
    return <Badge tone="warning">{t('security.resultBadCreds')}</Badge>;
  };

  const attemptCols: Column<LoginAttemptRow>[] = [
    {
      key: 'time',
      header: t('security.colTime'),
      render: (r) => new Date(r.createdAt).toLocaleString('tr-TR'),
      cellClassName: 'whitespace-nowrap text-xs',
    },
    { key: 'email', header: t('security.colEmail'), render: (r) => r.email },
    {
      key: 'ip',
      header: t('security.colIp'),
      render: (r) => r.ip ?? '—',
      cellClassName: 'tabular-nums',
    },
    { key: 'result', header: t('security.colResult'), render: resultBadge },
  ];

  const lockedCols: Column<LockedUserRow>[] = [
    { key: 'tenant', header: t('security.colTenant'), render: (r) => r.tenantName },
    { key: 'user', header: t('security.colUser'), render: (r) => `${r.name} (${r.email})` },
    {
      key: 'until',
      header: t('security.colLockedUntil'),
      render: (r) => new Date(r.lockedUntil).toLocaleString('tr-TR'),
      cellClassName: 'whitespace-nowrap text-xs',
    },
    {
      key: 'fails',
      header: t('security.colAttempts'),
      render: (r) => r.failedLoginCount,
      cellClassName: 'tabular-nums text-right',
    },
  ];

  if (summary.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="security-events-page">
      <PageHeader title={t('security.title')} description={t('security.desc')} />

      {s && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={ShieldX}
            tint={s.platformLoginFails24h > 0 ? 'warning' : 'success'}
            label={t('security.platformFails')}
            value={s.platformLoginFails24h}
          />
          <StatCard
            icon={ShieldAlert}
            tint={s.clinicLoginFails24h > 0 ? 'warning' : 'success'}
            label={t('security.clinicFails')}
            value={s.clinicLoginFails24h}
          />
          <StatCard
            icon={Lock}
            tint={s.lockedClinicUsers > 0 ? 'critical' : 'success'}
            label={t('security.lockedUsers')}
            value={s.lockedClinicUsers}
          />
          <StatCard
            icon={UserCog}
            tint="neutral"
            label={t('security.activeImpersonations')}
            value={s.activeImpersonations}
          />
        </section>
      )}

      {/* Login denemeleri */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('security.attemptsHeading')}</h2>
        <div className="flex flex-wrap gap-2">
          <input
            value={emailFilter}
            onChange={(e) => {
              setEmailFilter(e.target.value);
              setCursor(null);
            }}
            placeholder={t('security.filterEmail')}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          />
          <input
            value={ipFilter}
            onChange={(e) => {
              setIpFilter(e.target.value);
              setCursor(null);
            }}
            placeholder={t('security.filterIp')}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          />
        </div>
        <Table
          columns={attemptCols}
          rows={attempts.data?.rows ?? []}
          rowKey={(r) => r.id}
          empty={t('security.noAttempts')}
          data-testid="sec-attempts"
        />
        {attempts.data?.nextCursor && (
          <Button variant="ghost" size="sm" onClick={() => setCursor(attempts.data!.nextCursor)}>
            {t('security.loadMore')}
          </Button>
        )}
      </section>

      {/* Kilitli hesaplar */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('security.lockedHeading')}</h2>
        <Table
          columns={lockedCols}
          rows={locked.data ?? []}
          rowKey={(r) => r.id}
          empty={t('security.noLocked')}
        />
      </section>

      {/* Hızlı bağlantılar */}
      <Card className="flex flex-wrap gap-4 p-4 text-sm">
        <Link to="/ip-allowlist" className="text-primary hover:underline">
          {t('security.linkAllowlist')}
        </Link>
        <Link to="/audit" className="text-primary hover:underline">
          {t('security.linkAudit')}
        </Link>
      </Card>
    </div>
  );
}
