import { api } from '../lib/api';
import { useApiQuery } from '../lib/useApiQuery';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useT } from '../i18n';
import { Alert, Badge, Spinner, Table, type Column, type Tone } from '../components/ui';
import type { ImpersonationHistoryRow } from '../lib/impersonation-types';

// #950 (Feature 2) — biten impersonation oturumları (Aktif|Geçmiş sekmesinin
// Geçmiş içeriği). Table (F2) + useApiQuery. Owner tümünü, engineer/support
// yalnız kendi açtığını görür (backend rol scope'u).

const END_TONE: Record<string, Tone> = {
  manual_stop: 'neutral',
  expired: 'neutral',
  tenant_suspended: 'warning',
  force_stop: 'critical',
};

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ImpersonationHistory() {
  const { state } = usePlatformAuth();
  const t = useT();
  const accessToken = state.status === 'authenticated' ? state.accessToken : null;

  const query = useApiQuery(
    ['impersonation-history'],
    () =>
      api<ImpersonationHistoryRow[]>('/platform/impersonate/history', {
        bearer: accessToken ?? undefined,
      }),
    { enabled: !!accessToken },
  );

  const columns: Column<ImpersonationHistoryRow>[] = [
    {
      key: 'admin',
      header: t('impersonationHistory.colAdmin'),
      render: (r) => (
        <>
          <div className="font-medium">{r.platformAdminName}</div>
          <div className="text-xs text-muted-foreground">{r.platformAdminEmail}</div>
        </>
      ),
    },
    {
      key: 'target',
      header: t('impersonationHistory.colTarget'),
      render: (r) => (
        <>
          <div className="font-medium">{r.targetUserName}</div>
          <div className="text-xs text-muted-foreground">{r.targetUserEmail}</div>
        </>
      ),
    },
    {
      key: 'tenant',
      header: t('impersonationHistory.colClinic'),
      render: (r) => r.targetTenantName,
    },
    {
      key: 'reason',
      header: t('impersonationHistory.colReason'),
      cellClassName: 'max-w-[240px] truncate',
      render: (r) => r.reason,
    },
    {
      key: 'started',
      header: t('impersonationHistory.colStarted'),
      cellClassName: 'whitespace-nowrap text-muted-foreground',
      render: (r) => new Date(r.startedAt).toLocaleString('tr-TR'),
    },
    {
      key: 'duration',
      header: t('impersonationHistory.colDuration'),
      cellClassName: 'font-mono tabular-nums',
      render: (r) => fmtDuration(r.durationSeconds),
    },
    {
      key: 'ended',
      header: t('impersonationHistory.colEnded'),
      render: (r) => {
        const reason = r.endedReason ?? 'unknown';
        return (
          <Badge tone={END_TONE[reason] ?? 'neutral'}>
            {t(`impersonationHistory.reason.${reason}`)}
          </Badge>
        );
      },
    },
  ];

  if (query.isLoading) return <Spinner label={t('common.loading')} />;
  if (query.isError) return <Alert tone="error">{t('impersonationHistory.loadError')}</Alert>;
  return (
    <Table
      columns={columns}
      rows={query.data ?? []}
      rowKey={(r) => r.id}
      empty={t('impersonationHistory.empty')}
      data-testid="impersonation-history-table"
    />
  );
}
