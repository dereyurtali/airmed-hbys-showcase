import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useT } from '../i18n';
import {
  Alert,
  Badge,
  Button,
  Input,
  PageHeader,
  Spinner,
  Table,
  type Column,
} from '../components/ui';
import type { AuditListResponse, PlatformAuditLog } from '../lib/audit-types';

// #947 (Feature 1) — Platform audit log görüntüleyici. F3 (#945) READ endpoint'i
// üzerine: filtre barı (action/entityType/tarih) + Table (F2) + cursor
// pagination (useInfiniteQuery). Okuma tüm rollere açık; mutasyon yok.

export function AuditLogPage() {
  const { state } = usePlatformAuth();
  const t = useT();
  const accessToken = state.status === 'authenticated' ? state.accessToken : null;

  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const query = useInfiniteQuery({
    queryKey: ['audit', action, entityType, from, to],
    queryFn: ({ pageParam }) =>
      api<AuditListResponse>('/platform/audit', {
        bearer: accessToken ?? undefined,
        query: {
          action: action.trim() || undefined,
          entityType: entityType.trim() || undefined,
          from: from || undefined,
          // Bitiş gününü kapsayacak şekilde gün sonu (backend lte).
          to: to ? `${to}T23:59:59.999Z` : undefined,
          cursor: pageParam,
          take: 50,
        },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!accessToken,
    staleTime: 15_000,
  });

  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  const columns: Column<PlatformAuditLog>[] = [
    {
      key: 'date',
      header: t('audit.colDate'),
      cellClassName: 'whitespace-nowrap text-muted-foreground',
      render: (r) => new Date(r.createdAt).toLocaleString('tr-TR'),
    },
    {
      key: 'admin',
      header: t('audit.colAdmin'),
      render: (r) => r.email ?? '—',
    },
    {
      key: 'action',
      header: t('audit.colAction'),
      render: (r) => <Badge tone="neutral">{r.action}</Badge>,
    },
    {
      key: 'entity',
      header: t('audit.colEntity'),
      render: (r) => (
        <>
          <div>{r.entityType ?? '—'}</div>
          {r.entityId && (
            <div className="font-mono text-xs text-muted-foreground">{r.entityId.slice(0, 8)}</div>
          )}
        </>
      ),
    },
    {
      key: 'ip',
      header: t('audit.colIp'),
      cellClassName: 'whitespace-nowrap font-mono text-xs text-muted-foreground',
      render: (r) => r.ip ?? '—',
    },
  ];

  return (
    <div className="space-y-4" data-testid="audit-log-page">
      <PageHeader title={t('audit.title')} description={t('audit.subtitle')} />

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder={t('audit.filterAction')}
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="h-9 w-48"
          data-testid="audit-filter-action"
        />
        <Input
          placeholder={t('audit.filterEntity')}
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          className="h-9 w-40"
          data-testid="audit-filter-entity"
        />
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="h-9 w-auto"
          aria-label={t('audit.filterFrom')}
          data-testid="audit-filter-from"
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-9 w-auto"
          aria-label={t('audit.filterTo')}
          data-testid="audit-filter-to"
        />
      </div>

      {query.isError && <Alert tone="error">{t('audit.loadError')}</Alert>}

      {query.isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : (
        <>
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            empty={t('audit.empty')}
            data-testid="audit-table"
          />
          {query.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="ghost"
                onClick={() => void query.fetchNextPage()}
                loading={query.isFetchingNextPage}
                data-testid="audit-load-more"
              >
                {t('audit.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
