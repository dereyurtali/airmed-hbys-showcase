import { Bot, MessagesSquare, PhoneForwarded, Coins } from 'lucide-react';
import { PageHeader, StatCard, Card, Table, Badge, Spinner, type Column } from '../components/ui';
import { useApiQuery } from '../lib/useApiQuery';
import { api } from '../lib/api';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useI18n } from '../i18n';
import type { AiSummary, AiTenantRow, AiErrorRow } from '../lib/ai-types';

// #1089 — İZLEME › AI Asistan. Cross-tenant rollup. KVKK: hasta mesaj İÇERİĞİ
// GÖSTERİLMEZ — yalnız sayısal metrik + hata metadata (AgentAction.summary).

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}
function shortTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

export function AiMonitorPage() {
  const { state } = usePlatformAuth();
  const { t } = useI18n();
  const bearer = state.status === 'authenticated' ? state.accessToken : undefined;
  const opts = { enabled: !!bearer };

  const summary = useApiQuery(
    ['ai-summary'],
    () => api<AiSummary>('/platform/ai/summary', { bearer }),
    {
      ...opts,
      refetchInterval: 60_000,
    },
  );
  const tenants = useApiQuery(
    ['ai-tenants'],
    () => api<AiTenantRow[]>('/platform/ai/tenants', { bearer }),
    opts,
  );
  const errors = useApiQuery(
    ['ai-errors'],
    () => api<AiErrorRow[]>('/platform/ai/errors', { bearer }),
    opts,
  );

  const s = summary.data;

  const tenantCols: Column<AiTenantRow>[] = [
    {
      key: 'tenant',
      header: t('ai.colTenant'),
      render: (r) => r.tenantId,
      cellClassName: 'tabular-nums text-xs',
    },
    {
      key: 'conv',
      header: t('ai.colConversations'),
      render: (r) => r.conversations7d,
      cellClassName: 'tabular-nums text-right',
    },
    {
      key: 'handoff',
      header: t('ai.colHandoffRate'),
      render: (r) => pct(r.conversations7d > 0 ? r.handoffs7d / r.conversations7d : 0),
      cellClassName: 'tabular-nums text-right',
    },
    {
      key: 'errors',
      header: t('ai.colErrors'),
      render: (r) =>
        r.errors7d > 0 ? (
          <Badge tone="warning">{r.errors7d}</Badge>
        ) : (
          <span className="tabular-nums">0</span>
        ),
    },
    {
      key: 'tokens',
      header: t('ai.colTokens'),
      render: (r) => shortTokens(r.inputTokens7d + r.outputTokens7d),
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
    <div className="space-y-6" data-testid="ai-monitor-page">
      <PageHeader title={t('ai.title')} description={t('ai.desc')} />

      {s && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={Bot}
            tint="primary"
            label={t('ai.activeTenants')}
            value={s.activeTenants}
          />
          <StatCard
            icon={MessagesSquare}
            tint="info"
            label={t('ai.conversations7d')}
            value={s.conversations7d}
          />
          <StatCard
            icon={PhoneForwarded}
            tint="neutral"
            label={t('ai.handoffRate')}
            value={pct(s.handoffRate)}
          />
          <StatCard
            icon={Coins}
            tint="neutral"
            label={t('ai.tokens7d')}
            value={shortTokens(s.tokens7d)}
          />
        </section>
      )}

      {/* Tenant rollup */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('ai.tenantsHeading')}</h2>
        <Table
          columns={tenantCols}
          rows={tenants.data ?? []}
          rowKey={(r) => r.tenantId}
          empty={t('ai.noTenants')}
        />
      </section>

      {/* Son hatalar — yalnız metadata */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('ai.errorsHeading')}</h2>
        <p className="text-xs text-muted-foreground">{t('ai.errorsNote')}</p>
        {(errors.data ?? []).length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">{t('ai.noErrors')}</Card>
        ) : (
          <Table
            columns={[
              {
                key: 'time',
                header: t('ai.colTime'),
                render: (r: AiErrorRow) => new Date(r.createdAt).toLocaleString('tr-TR'),
                cellClassName: 'whitespace-nowrap text-xs',
              },
              {
                key: 'tenant',
                header: t('ai.colTenant'),
                render: (r: AiErrorRow) => r.tenantId,
                cellClassName: 'tabular-nums text-xs',
              },
              {
                key: 'summary',
                header: t('ai.colSummary'),
                render: (r: AiErrorRow) => <span className="text-xs">{r.summary}</span>,
                cellClassName: 'max-w-md',
              },
            ]}
            rows={errors.data ?? []}
            rowKey={(r) => r.id}
          />
        )}
      </section>
    </div>
  );
}
