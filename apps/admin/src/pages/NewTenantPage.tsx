import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useT } from '../i18n';
import { canMutate } from '../lib/platform-roles';
import { Alert, Button, Card, Field, Input, PageHeader, Select } from '../components/ui';
import type { CreateTenantResponse, TenantPlan } from '../lib/tenant-types';

const PLAN_OPTIONS: TenantPlan[] = ['pilot', 'standard', 'enterprise'];

export function NewTenantPage() {
  const navigate = useNavigate();
  const { state } = usePlatformAuth();
  const t = useT();
  const accessToken = state.status === 'authenticated' ? state.accessToken : null;

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [plan, setPlan] = useState<TenantPlan>('pilot');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateTenantResponse | null>(null);
  const [confirmedCopy, setConfirmedCopy] = useState(false);

  // #404 — support rolü tenant oluşturamaz; direkt URL ile gelse de listeye atılır.
  if (state.status === 'authenticated' && !canMutate(state.admin.role)) {
    return <Navigate to="/tenants" replace />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<CreateTenantResponse>('/platform/tenants', {
        method: 'POST',
        bearer: accessToken,
        body: {
          name: name.trim(),
          slug: slug.trim() || undefined,
          plan,
          adminEmail: adminEmail.trim().toLowerCase(),
          adminName: adminName.trim(),
          adminPassword: adminPassword.trim() || undefined,
        },
      });
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('newTenant.createError'));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="max-w-2xl space-y-4" data-testid="new-tenant-success">
        <PageHeader
          title={t('newTenant.successTitle')}
          description={`${result.tenant.name} (${result.tenant.slug})`}
        />
        <Alert tone="warning">
          <p className="font-semibold">{t('newTenant.passwordWarning')}</p>
          <p className="mt-2 text-[13px]">
            {t('newTenant.emailLabel')}:{' '}
            <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono">{result.adminEmail}</code>
          </p>
          <p className="mt-1 text-[13px]">
            {t('newTenant.tempPasswordLabel')}:{' '}
            <code
              className="rounded bg-black/5 px-2 py-1 font-mono text-base"
              data-testid="temp-password"
            >
              {result.adminTempPassword}
            </code>
          </p>
        </Alert>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={confirmedCopy}
            onChange={(e) => setConfirmedCopy(e.target.checked)}
            className="h-4 w-4 accent-[#0166A8]"
            data-testid="confirm-copy"
          />
          {t('newTenant.confirmCopyLabel')}
        </label>
        <Button
          type="button"
          onClick={() => navigate(`/tenants/${result.tenant.id}`)}
          disabled={!confirmedCopy}
          data-testid="go-detail"
        >
          {t('newTenant.goDetail')}
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-4">
      <PageHeader title={t('newTenant.title')} />

      {error && <Alert tone="error">{error}</Alert>}

      <Card className="p-5 sm:p-6">
        <form onSubmit={submit} className="space-y-4" data-testid="new-tenant-form">
          <Field label={t('newTenant.fieldName')} htmlFor="nt-name">
            <Input
              id="nt-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={255}
              data-testid="field-name"
            />
          </Field>
          <Field label={t('newTenant.fieldSlug')} htmlFor="nt-slug">
            <Input
              id="nt-slug"
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              pattern="^[a-z0-9-]{3,63}$"
              data-testid="field-slug"
            />
          </Field>
          <Field label={t('newTenant.fieldPlan')} htmlFor="nt-plan">
            <Select
              id="nt-plan"
              value={plan}
              onChange={(e) => setPlan(e.target.value as TenantPlan)}
              data-testid="field-plan"
            >
              {PLAN_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>

          <div className="border-t border-border pt-4">
            <p className="text-[13px] font-semibold text-foreground">
              {t('newTenant.adminSectionTitle')}
            </p>
          </div>
          <Field label={t('newTenant.fieldAdminEmail')} htmlFor="nt-admin-email">
            <Input
              id="nt-admin-email"
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              required
              data-testid="field-admin-email"
            />
          </Field>
          <Field label={t('newTenant.fieldAdminName')} htmlFor="nt-admin-name">
            <Input
              id="nt-admin-name"
              type="text"
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              required
              minLength={2}
              maxLength={100}
              data-testid="field-admin-name"
            />
          </Field>
          <Field label={t('newTenant.fieldAdminPassword')} htmlFor="nt-admin-password">
            <Input
              id="nt-admin-password"
              type="text"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              minLength={8}
              data-testid="field-admin-password"
            />
          </Field>
          <Button type="submit" loading={busy} data-testid="submit-new-tenant">
            {busy ? t('newTenant.submitting') : t('newTenant.submit')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
