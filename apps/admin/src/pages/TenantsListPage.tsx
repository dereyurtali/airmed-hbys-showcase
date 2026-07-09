import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useT } from '../i18n';
import { canMutate } from '../lib/platform-roles';
import { Alert, Badge, Card, Input, PageHeader, Select, Spinner } from '../components/ui';
import type { Tone } from '../components/ui';
import type { TenantPlan, TenantRow, TenantStatus } from '../lib/tenant-types';

const STATUS_KEY: Record<TenantStatus, string> = {
  active: 'tenants.statusActive',
  trial: 'tenants.statusTrial',
  suspended: 'tenants.statusSuspended',
  churned: 'tenants.statusChurned',
};
const STATUS_TONE: Record<TenantStatus, Tone> = {
  active: 'success',
  trial: 'info',
  suspended: 'critical',
  churned: 'neutral',
};
const PLAN_KEY: Record<TenantPlan, string> = {
  pilot: 'tenants.planPilot',
  standard: 'tenants.planStandard',
  enterprise: 'tenants.planEnterprise',
};

export function TenantsListPage() {
  const { state } = usePlatformAuth();
  const t = useT();
  const [tenants, setTenants] = useState<TenantRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<TenantStatus | ''>('');
  const [planFilter, setPlanFilter] = useState<TenantPlan | ''>('');
  const [search, setSearch] = useState('');

  const accessToken = state.status === 'authenticated' ? state.accessToken : null;
  const showNew = state.status === 'authenticated' && canMutate(state.admin.role);

  useEffect(() => {
    if (!accessToken) return;
    const ac = new AbortController();
    setTenants(null);
    setError(null);
    api<TenantRow[]>('/platform/tenants', {
      bearer: accessToken,
      signal: ac.signal,
      query: {
        status: statusFilter || undefined,
        plan: planFilter || undefined,
        search: search.trim() || undefined,
      },
    })
      .then(setTenants)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const msg = err instanceof ApiError ? err.message : t('tenants.loadError');
        setError(msg);
      });
    return () => ac.abort();
  }, [accessToken, statusFilter, planFilter, search, t]);

  const th =
    'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground';
  const td = 'px-3 py-2.5 text-sm text-foreground';

  return (
    <div className="space-y-4" data-testid="tenants-list-page">
      <PageHeader
        title={t('tenants.title')}
        action={
          showNew ? (
            <Link
              to="/tenants/new"
              data-testid="new-tenant-link"
              className="focus-ring inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t('tenants.new')}
            </Link>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-2">
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as TenantStatus | '')}
          data-testid="filter-status"
          className="h-9 w-auto"
        >
          <option value="">{t('tenants.filterStatusAll')}</option>
          {(['active', 'trial', 'suspended', 'churned'] as TenantStatus[]).map((s) => (
            <option key={s} value={s}>
              {t(STATUS_KEY[s])}
            </option>
          ))}
        </Select>
        <Select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value as TenantPlan | '')}
          data-testid="filter-plan"
          className="h-9 w-auto"
        >
          <option value="">{t('tenants.filterPlanAll')}</option>
          {(['pilot', 'standard', 'enterprise'] as TenantPlan[]).map((p) => (
            <option key={p} value={p}>
              {t(PLAN_KEY[p])}
            </option>
          ))}
        </Select>
        <Input
          type="text"
          placeholder={t('tenants.filterSearch')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="filter-search"
          className="h-9 w-60"
        />
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {tenants === null && !error ? (
        <Spinner label={t('common.loading')} />
      ) : tenants && tenants.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">{t('tenants.empty')}</Card>
      ) : tenants ? (
        <Card className="overflow-hidden">
          <table className="w-full border-collapse" data-testid="tenants-table">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className={th}>{t('tenants.colName')}</th>
                <th className={th}>{t('tenants.colSlug')}</th>
                <th className={th}>{t('tenants.colStatus')}</th>
                <th className={th}>{t('tenants.colPlan')}</th>
                <th className={th}>{t('tenants.colUsers')}</th>
                <th className={th}>{t('tenants.colCreated')}</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr
                  key={tenant.id}
                  className="border-b border-border last:border-0 hover:bg-[var(--row-hover)]"
                  data-testid={`tenant-row-${tenant.slug}`}
                >
                  <td className={td}>
                    <Link
                      to={`/tenants/${tenant.id}`}
                      className="focus-ring rounded font-medium text-primary hover:underline"
                    >
                      {tenant.name}
                    </Link>
                  </td>
                  <td className={`${td} font-mono text-xs text-muted-foreground`}>{tenant.slug}</td>
                  <td className={td}>
                    <Badge tone={STATUS_TONE[tenant.status]}>{t(STATUS_KEY[tenant.status])}</Badge>
                  </td>
                  <td className={td}>{t(PLAN_KEY[tenant.plan])}</td>
                  <td className={`${td} tabular-nums`}>{tenant._count?.users ?? '—'}</td>
                  <td className={`${td} text-muted-foreground`}>
                    {new Date(tenant.createdAt).toLocaleDateString('tr-TR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
