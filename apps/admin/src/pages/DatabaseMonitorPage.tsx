import { useState } from 'react';
import { Database, Cable, AlertTriangle, Timer } from 'lucide-react';
import { PageHeader, StatCard, Card, Table, Badge, Spinner, type Column } from '../components/ui';
import { useApiQuery } from '../lib/useApiQuery';
import { api } from '../lib/api';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useI18n } from '../i18n';
import {
  formatBytes,
  type MetricsSnapshot,
  type DbTableStat,
  type DbIndexStat,
  type DbSlowQuery,
  type DbPartition,
} from '../lib/metric-types';
import { Freshness } from '../components/Freshness';

// #1087 — İZLEME › Veritabanı ekranı. Tablo-bazlı derin analiz (kullanıcı
// talebi). Veri istek-anında raw SQL (#1085 servisinin db/* endpoint'leri).

export function DatabaseMonitorPage() {
  const { state } = usePlatformAuth();
  const { t } = useI18n();
  const bearer = state.status === 'authenticated' ? state.accessToken : undefined;
  const opts = { enabled: !!bearer };
  const [showAll, setShowAll] = useState(false);

  const latest = useApiQuery(
    ['metrics-latest'],
    () => api<MetricsSnapshot | null>('/platform/metrics/latest', { bearer }),
    { ...opts, refetchInterval: 30_000 },
  );
  const tables = useApiQuery(
    ['db-tables'],
    () => api<DbTableStat[]>('/platform/metrics/db/tables', { bearer }),
    opts,
  );
  const indexes = useApiQuery(
    ['db-indexes'],
    () => api<DbIndexStat[]>('/platform/metrics/db/indexes', { bearer }),
    opts,
  );
  const slow = useApiQuery(
    ['db-slow'],
    () => api<DbSlowQuery[] | null>('/platform/metrics/db/slow-queries', { bearer }),
    opts,
  );
  const partitions = useApiQuery(
    ['db-partitions'],
    () => api<DbPartition[]>('/platform/metrics/db/partitions', { bearer }),
    opts,
  );

  const m = latest.data;
  const rows = tables.data ?? [];
  const shown = showAll ? rows : rows.slice(0, 50);

  const tableCols: Column<DbTableStat>[] = [
    { key: 'name', header: t('monitoring.db.colTable'), render: (r) => r.name },
    {
      key: 'total',
      header: t('monitoring.db.colSize'),
      render: (r) => formatBytes(r.totalBytes),
      cellClassName: 'tabular-nums whitespace-nowrap',
    },
    {
      key: 'breakdown',
      header: t('monitoring.db.colBreakdown'),
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {formatBytes(r.tableBytes)} / {formatBytes(r.indexBytes)} / {formatBytes(r.toastBytes)}
        </span>
      ),
      cellClassName: 'tabular-nums whitespace-nowrap',
    },
    {
      key: 'live',
      header: t('monitoring.db.colLive'),
      render: (r) => r.liveRows.toLocaleString('tr-TR'),
      cellClassName: 'tabular-nums text-right',
    },
    {
      key: 'dead',
      header: t('monitoring.db.colDead'),
      render: (r) =>
        r.deadRatio > 0.2 ? (
          <Badge tone="warning">{(r.deadRatio * 100).toFixed(0)}%</Badge>
        ) : (
          <span className="tabular-nums">{(r.deadRatio * 100).toFixed(0)}%</span>
        ),
    },
    {
      key: 'scan',
      header: t('monitoring.db.colScan'),
      render: (r) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          seq {r.seqScan.toLocaleString('tr-TR')} / idx {r.idxScan.toLocaleString('tr-TR')}
        </span>
      ),
    },
    {
      key: 'vacuum',
      header: t('monitoring.db.colAutovacuum'),
      render: (r) => (r.lastAutovacuum ? new Date(r.lastAutovacuum).toLocaleString('tr-TR') : '—'),
      cellClassName: 'whitespace-nowrap text-xs',
    },
  ];

  if (latest.isLoading && tables.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="database-monitor-page">
      <PageHeader title={t('monitoring.db.title')} description={t('monitoring.db.desc')} />
      <Freshness capturedAt={m?.capturedAt} />

      {m && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={Database}
            tint="primary"
            label={t('monitoring.db.totalSize')}
            value={formatBytes(m.dbSizeBytes)}
          />
          <StatCard
            icon={Cable}
            tint="info"
            label={t('monitoring.db.connections')}
            value={`${m.dbConnActive} / ${m.dbConnTotal}`}
          />
          <StatCard
            icon={AlertTriangle}
            tint={m.dbConnIdleInTx > 0 ? 'warning' : 'success'}
            label={t('monitoring.db.idleInTx')}
            value={m.dbConnIdleInTx}
          />
          <StatCard
            icon={Timer}
            tint="neutral"
            label={t('monitoring.db.slowQueries')}
            value={m.slowQueryCount ?? t('monitoring.unknown')}
          />
        </section>
      )}

      {/* Tablolar */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('monitoring.db.tablesHeading')}</h2>
        <Table
          columns={tableCols}
          rows={shown}
          rowKey={(r) => r.name}
          empty={t('monitoring.db.noTables')}
          data-testid="db-tables"
        />
        {rows.length > 50 && (
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="text-xs text-primary hover:underline"
          >
            {showAll
              ? t('monitoring.db.showTop50')
              : t('monitoring.db.showAll', { count: rows.length })}
          </button>
        )}
      </section>

      {/* Index sağlığı */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('monitoring.db.unusedIndexes')}</h2>
        {(indexes.data ?? []).length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">
            {t('monitoring.db.noUnusedIdx')}
          </Card>
        ) : (
          <Table
            columns={[
              {
                key: 'idx',
                header: t('monitoring.db.colIndex'),
                render: (r: DbIndexStat) => r.index,
              },
              {
                key: 'tbl',
                header: t('monitoring.db.colTable'),
                render: (r: DbIndexStat) => r.table,
              },
              {
                key: 'size',
                header: t('monitoring.db.colSize'),
                render: (r: DbIndexStat) => formatBytes(r.sizeBytes),
                cellClassName: 'tabular-nums',
              },
            ]}
            rows={indexes.data ?? []}
            rowKey={(r) => `${r.table}.${r.index}`}
          />
        )}
      </section>

      {/* Slow queries */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('monitoring.db.slowQueriesHeading')}</h2>
        {slow.data === null ? (
          <Card className="p-4 text-sm text-muted-foreground">{t('monitoring.db.noPgStat')}</Card>
        ) : (slow.data ?? []).length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">{t('monitoring.db.noSlow')}</Card>
        ) : (
          <Table
            columns={[
              {
                key: 'q',
                header: t('monitoring.db.colQuery'),
                render: (r: DbSlowQuery) => <code className="text-xs">{r.query}</code>,
                cellClassName: 'max-w-md',
              },
              {
                key: 'mean',
                header: t('monitoring.db.colMean'),
                render: (r: DbSlowQuery) => `${r.meanMs} ms`,
                cellClassName: 'tabular-nums whitespace-nowrap',
              },
              {
                key: 'calls',
                header: t('monitoring.db.colCalls'),
                render: (r: DbSlowQuery) => r.calls.toLocaleString('tr-TR'),
                cellClassName: 'tabular-nums text-right',
              },
            ]}
            rows={slow.data ?? []}
            rowKey={(r) => r.query.slice(0, 60)}
          />
        )}
      </section>

      {/* Partition / retention */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('monitoring.db.partitionsHeading')}</h2>
        <Table
          columns={[
            {
              key: 'name',
              header: t('monitoring.db.colTable'),
              render: (r: DbPartition) => r.name,
            },
            {
              key: 'size',
              header: t('monitoring.db.colSize'),
              render: (r: DbPartition) => formatBytes(r.sizeBytes),
              cellClassName: 'tabular-nums',
            },
            {
              key: 'rows',
              header: t('monitoring.db.colLive'),
              render: (r: DbPartition) => r.rows.toLocaleString('tr-TR'),
              cellClassName: 'tabular-nums text-right',
            },
          ]}
          rows={partitions.data ?? []}
          rowKey={(r) => r.name}
          empty={t('monitoring.db.noPartitions')}
        />
      </section>
    </div>
  );
}
