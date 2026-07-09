import { useState } from 'react';
import { RefreshCw, AlertOctagon, CheckCircle2, GitMerge } from 'lucide-react';
import {
  PageHeader,
  StatCard,
  Card,
  Table,
  Badge,
  Button,
  ConfirmDialog,
  Spinner,
  type Column,
} from '../components/ui';
import { useApiQuery } from '../lib/useApiQuery';
import { api } from '../lib/api';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useI18n } from '../i18n';
import type { SyncSummary, DeadLetterRow, ConflictRow } from '../lib/sync-types';

// #1091 — İZLEME › Senkron. A12 hibrit senkron dead-letter + conflict
// görünürlüğü + requeue. Sync hiç aktif değilse boş-durum bilgi kartı.

export function SyncMonitorPage() {
  const { state } = usePlatformAuth();
  const { t } = useI18n();
  const bearer = state.status === 'authenticated' ? state.accessToken : undefined;
  const opts = { enabled: !!bearer };

  const [requeueId, setRequeueId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const summary = useApiQuery(
    ['sync-summary'],
    () => api<SyncSummary>('/platform/sync/summary', { bearer }),
    { ...opts, refetchInterval: 30_000 },
  );
  const deadLetter = useApiQuery(
    ['sync-dead'],
    () => api<DeadLetterRow[]>('/platform/sync/dead-letter', { bearer }),
    opts,
  );
  const conflicts = useApiQuery(
    ['sync-conflicts'],
    () => api<ConflictRow[]>('/platform/sync/conflicts', { bearer }),
    opts,
  );

  const s = summary.data;
  const dead = deadLetter.data ?? [];
  const conf = conflicts.data ?? [];
  // Sync hiç aktif değil = tüm sayaçlar 0 + liste boş.
  const inactive =
    s !== undefined &&
    s.pendingOutbox === 0 &&
    s.deadLetter === 0 &&
    s.synced24h === 0 &&
    s.openConflicts === 0 &&
    dead.length === 0 &&
    conf.length === 0;

  const doRequeue = async () => {
    if (!requeueId) return;
    setBusy(true);
    try {
      await api(`/platform/sync/dead-letter/${requeueId}/requeue`, { method: 'POST', bearer });
      await Promise.all([summary.refetch(), deadLetter.refetch()]);
      setRequeueId(null);
    } finally {
      setBusy(false);
    }
  };

  const deadCols: Column<DeadLetterRow>[] = [
    {
      key: 'tenant',
      header: t('sync.colTenant'),
      render: (r) => r.tenantId ?? '—',
      cellClassName: 'tabular-nums text-xs',
    },
    {
      key: 'entity',
      header: t('sync.colEntity'),
      render: (r) => `${r.entityType} · ${r.operation}`,
    },
    {
      key: 'retry',
      header: t('sync.colRetry'),
      render: (r) => r.retryCount,
      cellClassName: 'tabular-nums text-right',
    },
    {
      key: 'failed',
      header: t('sync.colFailedAt'),
      render: (r) => (r.failedAt ? new Date(r.failedAt).toLocaleString('tr-TR') : '—'),
      cellClassName: 'whitespace-nowrap text-xs',
    },
    {
      key: 'error',
      header: t('sync.colError'),
      render: (r) => <span className="text-xs text-muted-foreground">{r.lastError ?? '—'}</span>,
      cellClassName: 'max-w-xs',
    },
    {
      key: 'action',
      header: '',
      render: (r) => (
        <Button variant="ghost" size="sm" onClick={() => setRequeueId(r.id)}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          {t('sync.requeue')}
        </Button>
      ),
    },
  ];

  const conflictCols: Column<ConflictRow>[] = [
    {
      key: 'tenant',
      header: t('sync.colTenant'),
      render: (r) => r.tenantId ?? '—',
      cellClassName: 'tabular-nums text-xs',
    },
    { key: 'entity', header: t('sync.colEntity'), render: (r) => r.entityType },
    {
      key: 'type',
      header: t('sync.colConflictType'),
      render: (r) => <Badge tone="warning">{r.conflictType}</Badge>,
    },
    {
      key: 'occurred',
      header: t('sync.colOccurred'),
      render: (r) => new Date(r.occurredAt).toLocaleString('tr-TR'),
      cellClassName: 'whitespace-nowrap text-xs',
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
    <div className="space-y-6" data-testid="sync-monitor-page">
      <PageHeader title={t('sync.title')} description={t('sync.desc')} />

      {inactive ? (
        <Card className="p-6 text-sm text-muted-foreground">{t('sync.inactive')}</Card>
      ) : (
        <>
          {s && (
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon={GitMerge}
                tint="info"
                label={t('sync.pending')}
                value={s.pendingOutbox}
              />
              <StatCard
                icon={AlertOctagon}
                tint={s.deadLetter > 0 ? 'critical' : 'success'}
                label={t('sync.deadLetter')}
                value={s.deadLetter}
              />
              <StatCard
                icon={CheckCircle2}
                tint="success"
                label={t('sync.synced24h')}
                value={s.synced24h}
              />
              <StatCard
                icon={AlertOctagon}
                tint={s.openConflicts > 0 ? 'warning' : 'success'}
                label={t('sync.openConflicts')}
                value={s.openConflicts}
              />
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t('sync.deadLetterHeading')}</h2>
            <Table
              columns={deadCols}
              rows={dead}
              rowKey={(r) => r.id}
              empty={t('sync.noDeadLetter')}
              data-testid="sync-dead"
            />
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t('sync.conflictsHeading')}</h2>
            <Table
              columns={conflictCols}
              rows={conf}
              rowKey={(r) => r.id}
              empty={t('sync.noConflicts')}
            />
          </section>
        </>
      )}

      <ConfirmDialog
        open={requeueId !== null}
        title={t('sync.requeueTitle')}
        description={t('sync.requeueDesc')}
        confirmLabel={t('sync.requeue')}
        cancelLabel={t('common.cancel')}
        tone="primary"
        busy={busy}
        onConfirm={doRequeue}
        onClose={() => setRequeueId(null)}
      />
    </div>
  );
}
