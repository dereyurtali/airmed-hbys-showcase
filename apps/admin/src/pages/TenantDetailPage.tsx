import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ImpersonateDialog } from '../components/ImpersonateDialog';
import { api, ApiError } from '../lib/api';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useT } from '../i18n';
import { canImpersonate, canMutate } from '../lib/platform-roles';
import {
  Alert,
  Badge,
  Button,
  Field,
  Input,
  Modal,
  PageHeader,
  SectionCard,
  Select,
  Spinner,
  StatCard,
  Textarea,
} from '../components/ui';
import type { ImpersonationStartResponse, TenantUserRow } from '../lib/impersonation-types';
import type { SuspendReason, TenantPlan, TenantStats } from '../lib/tenant-types';

const PLAN_OPTIONS: TenantPlan[] = ['pilot', 'standard', 'enterprise'];
const LOCALE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'tr', label: 'Türkçe (tr)' },
  { value: 'ru', label: 'Русский (ru)' },
  { value: 'tg', label: 'Тоҷикӣ (tg)' },
];
// Dağıtım bölgesi (klinik Tacikistan; ekip Türkiye) + yaygın UTC ofsetleri.
const TIMEZONE_OPTIONS: string[] = [
  'Asia/Dushanbe',
  'Europe/Istanbul',
  'Asia/Tashkent',
  'Europe/Moscow',
  'UTC',
];
const SUSPEND_REASONS: SuspendReason[] = [
  'payment_overdue',
  'violation',
  'customer_request',
  'security_incident',
  'other',
];
const REASON_KEY: Record<SuspendReason, string> = {
  payment_overdue: 'tenantDetail.reasonPaymentOverdue',
  violation: 'tenantDetail.reasonViolation',
  customer_request: 'tenantDetail.reasonCustomerRequest',
  security_incident: 'tenantDetail.reasonSecurityIncident',
  other: 'tenantDetail.reasonOther',
};

export function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { state } = usePlatformAuth();
  const t = useT();
  const accessToken = state.status === 'authenticated' ? state.accessToken : null;
  const role = state.status === 'authenticated' ? state.admin.role : null;
  const mayMutate = role ? canMutate(role) : false;
  const mayImpersonate = role ? canImpersonate(role) : false;

  const [data, setData] = useState<TenantStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showSuspend, setShowSuspend] = useState(false);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editPlan, setEditPlan] = useState<TenantPlan>('pilot');
  const [editLocale, setEditLocale] = useState('tr');
  const [editTimezone, setEditTimezone] = useState('Asia/Dushanbe');
  const [editSettings, setEditSettings] = useState('{}');
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // Suspend dialog state
  const [reason, setReason] = useState<SuspendReason>('payment_overdue');
  const [note, setNote] = useState('');

  // F7 impersonation state
  const [users, setUsers] = useState<TenantUserRow[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [impersonateTarget, setImpersonateTarget] = useState<TenantUserRow | null>(null);
  const [impersonateResult, setImpersonateResult] = useState<ImpersonationStartResponse | null>(
    null,
  );

  const reload = async () => {
    if (!accessToken || !id) return;
    try {
      const res = await api<TenantStats>(`/platform/tenants/${id}/stats`, { bearer: accessToken });
      setData(res);
      setEditName(res.tenant.name);
      setEditPlan(res.tenant.plan);
      setEditLocale(res.tenant.locale);
      setEditTimezone(res.tenant.timezone);
      setEditSettings(JSON.stringify(res.tenant.settings ?? {}, null, 2));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('tenantDetail.detailError'));
    }
  };

  useEffect(() => {
    void reload();
  }, [accessToken, id]); // eslint-disable-line

  const loadUsers = async () => {
    if (!accessToken || !id) return;
    try {
      const res = await api<TenantUserRow[]>(`/platform/tenants/${id}/users`, {
        bearer: accessToken,
      });
      setUsers(res);
      setUsersError(null);
    } catch (err) {
      setUsersError(err instanceof ApiError ? err.message : t('tenantDetail.usersLoadError'));
    }
  };

  useEffect(() => {
    void loadUsers();
  }, [accessToken, id]); // eslint-disable-line

  const saveEdit = async () => {
    if (!accessToken || !id) return;
    // settings serbest-biçim JSON blob → gönderimden önce parse doğrula (bozuk
    // JSON tenant config'ini bozmasın). Obje olmalı (dizi/skaler reddet).
    let settings: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(editSettings || '{}');
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setSettingsError(t('tenantDetail.settingsInvalid'));
        return;
      }
      settings = parsed as Record<string, unknown>;
    } catch {
      setSettingsError(t('tenantDetail.settingsInvalid'));
      return;
    }
    setSettingsError(null);
    setBusy(true);
    setError(null);
    try {
      await api(`/platform/tenants/${id}`, {
        method: 'PATCH',
        bearer: accessToken,
        body: {
          name: editName.trim(),
          plan: editPlan,
          locale: editLocale,
          timezone: editTimezone,
          settings,
        },
      });
      setEditing(false);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('tenantDetail.saveError'));
    } finally {
      setBusy(false);
    }
  };

  const suspend = async () => {
    if (!accessToken || !id) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/platform/tenants/${id}/suspend`, {
        method: 'POST',
        bearer: accessToken,
        body: { reason, note: note.trim() || undefined },
      });
      setShowSuspend(false);
      setNote('');
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('tenantDetail.suspendError'));
    } finally {
      setBusy(false);
    }
  };

  const reactivate = async () => {
    if (!accessToken || !id) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/platform/tenants/${id}/reactivate`, { method: 'POST', bearer: accessToken });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('tenantDetail.reactivateError'));
    } finally {
      setBusy(false);
    }
  };

  if (!id) {
    navigate('/tenants', { replace: true });
    return null;
  }

  if (data === null && !error) {
    return <Spinner label={t('common.loading')} />;
  }
  if (error && !data) {
    return (
      <div className="space-y-3" data-testid="tenant-detail-error">
        <Alert tone="error">{error}</Alert>
        <Link to="/tenants" className="text-sm text-primary hover:underline">
          {t('tenantDetail.backToList')}
        </Link>
      </div>
    );
  }
  if (!data) return null;
  const tenant = data.tenant;
  const isSuspended = tenant.status === 'suspended';

  return (
    <div className="space-y-5" data-testid="tenant-detail-page">
      <PageHeader
        title={tenant.name}
        action={
          mayMutate ? (
            <>
              {!editing && !isSuspended && (
                <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                  {t('tenantDetail.edit')}
                </Button>
              )}
              {isSuspended ? (
                <Button
                  variant="success"
                  size="sm"
                  onClick={() => void reactivate()}
                  loading={busy}
                  data-testid="reactivate-btn"
                >
                  {t('tenantDetail.reactivate')}
                </Button>
              ) : (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setShowSuspend(true)}
                  disabled={busy}
                  data-testid="suspend-btn"
                >
                  {t('tenantDetail.suspend')}
                </Button>
              )}
            </>
          ) : undefined
        }
      />
      <div className="-mt-3 flex items-center gap-3">
        <code className="font-mono text-[13px] text-muted-foreground">{tenant.slug}</code>
        {isSuspended && (
          <Badge tone="critical">
            {t('tenantDetail.suspendedBadge', {
              reason: tenant.suspendReason
                ? t(REASON_KEY[tenant.suspendReason as SuspendReason])
                : '',
            })}
          </Badge>
        )}
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t('tenantDetail.statUsers')} value={data.stats.userCount} tint="info" />
        <StatCard
          label={t('tenantDetail.statPatients')}
          value={data.stats.patientCount}
          tint="success"
        />
        <StatCard
          label={t('tenantDetail.statAppointments30')}
          value={data.stats.recentAppointmentCount}
          tint="primary"
        />
        <StatCard
          label={t('tenantDetail.statLastLogin')}
          value={
            data.stats.lastLogin
              ? new Date(data.stats.lastLogin.lastLoginAt).toLocaleDateString('tr-TR')
              : '—'
          }
          tint="neutral"
        />
      </div>

      <SectionCard title={t('tenantDetail.settingsTitle')}>
        {editing ? (
          <div className="grid max-w-md gap-4">
            <Field label={t('tenantDetail.fieldName')} htmlFor="td-name">
              <Input
                id="td-name"
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                data-testid="edit-name"
              />
            </Field>
            <Field label={t('tenantDetail.fieldPlan')} htmlFor="td-plan">
              <Select
                id="td-plan"
                value={editPlan}
                onChange={(e) => setEditPlan(e.target.value as TenantPlan)}
                data-testid="edit-plan"
              >
                {PLAN_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('tenantDetail.fieldLocale')} htmlFor="td-locale">
              <Select
                id="td-locale"
                value={editLocale}
                onChange={(e) => setEditLocale(e.target.value)}
                data-testid="edit-locale"
              >
                {LOCALE_OPTIONS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('tenantDetail.fieldTimezone')} htmlFor="td-timezone">
              <Select
                id="td-timezone"
                value={editTimezone}
                onChange={(e) => setEditTimezone(e.target.value)}
                data-testid="edit-timezone"
              >
                {(TIMEZONE_OPTIONS.includes(editTimezone)
                  ? TIMEZONE_OPTIONS
                  : [editTimezone, ...TIMEZONE_OPTIONS]
                ).map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('tenantDetail.fieldSettings')}
              htmlFor="td-settings"
              hint={t('tenantDetail.settingsHint')}
              error={settingsError ?? undefined}
            >
              <Textarea
                id="td-settings"
                value={editSettings}
                onChange={(e) => setEditSettings(e.target.value)}
                rows={5}
                spellCheck={false}
                className="font-mono text-[13px]"
                data-testid="edit-settings"
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              {t('tenantDetail.featureFlagsNote')}{' '}
              <Link to="/feature-flags" className="text-primary hover:underline">
                {t('nav.featureFlags')}
              </Link>
            </p>
            <div className="flex gap-2">
              <Button onClick={() => void saveEdit()} loading={busy} data-testid="edit-save">
                {t('common.save')}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t('tenantDetail.fieldPlan')}</dt>
            <dd className="text-foreground">{tenant.plan}</dd>
            <dt className="text-muted-foreground">{t('tenantDetail.fieldLocale')}</dt>
            <dd className="text-foreground">{tenant.locale}</dd>
            <dt className="text-muted-foreground">{t('tenantDetail.fieldTimezone')}</dt>
            <dd className="text-foreground">{tenant.timezone}</dd>
            <dt className="text-muted-foreground">{t('tenantDetail.fieldCreated')}</dt>
            <dd className="text-foreground">
              {new Date(tenant.createdAt).toLocaleString('tr-TR')}
            </dd>
            {tenant.suspendNote && (
              <>
                <dt className="text-muted-foreground">{t('tenantDetail.fieldSuspendNote')}</dt>
                <dd className="text-foreground">{tenant.suspendNote}</dd>
              </>
            )}
          </dl>
        )}
      </SectionCard>

      {/* F7 — Kullanıcılar + Impersonate */}
      <SectionCard title={t('tenantDetail.usersTitle')} testId="tenant-users-section">
        {usersError && <Alert tone="error">{usersError}</Alert>}
        {users.length === 0 && !usersError && (
          <p className="text-[13px] text-muted-foreground">{t('tenantDetail.usersEmpty')}</p>
        )}
        {users.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('tenantDetail.userColEmail')}
                  </th>
                  <th className="px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('tenantDetail.userColName')}
                  </th>
                  <th className="px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('tenantDetail.userColRoles')}
                  </th>
                  <th className="px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('tenantDetail.userColStatus')}
                  </th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    data-testid={`tenant-user-${u.id}`}
                    className="border-b border-border text-[13px] last:border-0"
                  >
                    <td className="px-2 py-2 text-foreground">{u.email}</td>
                    <td className="px-2 py-2 text-foreground">{u.name}</td>
                    <td className="px-2 py-2 text-muted-foreground">{u.roles.join(', ')}</td>
                    <td className="px-2 py-2">
                      <Badge tone={u.status === 'active' ? 'success' : 'neutral'}>{u.status}</Badge>
                    </td>
                    <td className="px-2 py-2 text-right">
                      {mayImpersonate && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setImpersonateTarget(u)}
                          disabled={isSuspended || u.status !== 'active'}
                          data-testid={`impersonate-btn-${u.id}`}
                          title={
                            isSuspended
                              ? t('tenantDetail.impersonateSuspended')
                              : u.status !== 'active'
                                ? t('tenantDetail.impersonateInactive')
                                : ''
                          }
                        >
                          {t('tenantDetail.impersonate')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Suspend dialog */}
      <Modal
        open={showSuspend}
        onClose={() => setShowSuspend(false)}
        dismissable={!busy}
        testId="suspend-dialog"
        labelledBy="suspend-title"
      >
        <h2 id="suspend-title" className="text-[15px] font-semibold text-foreground">
          {t('tenantDetail.suspendTitle')}
        </h2>
        <p className="mt-2 text-[13px] text-muted-foreground">{t('tenantDetail.suspendDesc')}</p>
        <div className="mt-4 space-y-4">
          <Field label={t('tenantDetail.suspendReasonLabel')} htmlFor="suspend-reason-sel">
            <Select
              id="suspend-reason-sel"
              value={reason}
              onChange={(e) => setReason(e.target.value as SuspendReason)}
              data-testid="suspend-reason"
            >
              {SUSPEND_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(REASON_KEY[r])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('tenantDetail.suspendNoteLabel')} htmlFor="suspend-note-ta">
            <Textarea
              id="suspend-note-ta"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              data-testid="suspend-note"
            />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setShowSuspend(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => void suspend()}
            loading={busy}
            data-testid="suspend-confirm"
          >
            {t('tenantDetail.suspend')}
          </Button>
        </div>
      </Modal>

      {impersonateTarget && accessToken && (
        <ImpersonateDialog
          accessToken={accessToken}
          user={impersonateTarget}
          onClose={() => setImpersonateTarget(null)}
          onSuccess={(resp) => {
            setImpersonateTarget(null);
            setImpersonateResult(resp);
          }}
        />
      )}

      {impersonateResult && (
        <ImpersonationStartedToast
          result={impersonateResult}
          onDismiss={() => setImpersonateResult(null)}
        />
      )}
    </div>
  );
}

interface ImpersonationStartedToastProps {
  result: ImpersonationStartResponse;
  onDismiss: () => void;
}

function ImpersonationStartedToast({ result, onDismiss }: ImpersonationStartedToastProps) {
  const t = useT();
  // Pilot için: token'ı kopyalanabilir gösteriyoruz. Tenant URL'ine açma akışı
  // wildcard SSL + hosts konfigine bağlı (A15 deployment'a kadar tenant slug
  // subdomain üretim ortamında yok).
  return (
    <div
      data-testid="impersonation-started-toast"
      className="shadow-float motion-pop fixed bottom-4 right-4 z-50 max-w-md rounded-lg border border-primary/40 bg-background p-4"
    >
      <div className="font-semibold text-foreground">{t('impersonationToast.title')}</div>
      <div className="mt-1 text-[13px] text-muted-foreground">
        {t('impersonationToast.target')}:{' '}
        <strong className="text-foreground">{result.targetUser.email}</strong> ·{' '}
        {t('impersonationToast.clinic')}:{' '}
        <strong className="text-foreground">{result.targetUser.tenantSlug}</strong> ·{' '}
        {t('impersonationToast.expires')}: {new Date(result.expiresAt).toLocaleTimeString('tr-TR')}
      </div>
      <textarea
        readOnly
        value={result.impersonationToken}
        data-testid="impersonation-token"
        className="focus-ring mt-2 min-h-[60px] w-full rounded-lg border border-input bg-[var(--ro)] p-2 font-mono text-[11px] text-foreground"
        onClick={(e) => (e.target as HTMLTextAreaElement).select()}
      />
      <div className="mt-2 text-xs text-muted-foreground">{t('impersonationToast.hint')}</div>
      <div className="mt-2 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          data-testid="impersonation-toast-dismiss"
        >
          {t('impersonationToast.ok')}
        </Button>
      </div>
    </div>
  );
}
