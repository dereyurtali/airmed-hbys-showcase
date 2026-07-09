import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useApiQuery } from '../lib/useApiQuery';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useT } from '../i18n';
import { canManageAdmins } from '../lib/platform-roles';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Table,
  type Column,
} from '../components/ui';
import type { PlatformRole } from '../lib/types';
import type { PlatformAdminRow } from '../lib/admin-types';

// #946 (Feature 3) — Platform admin yönetimi. Liste tüm rollere okuma; mutasyon
// (ekle/rol/deaktive/TOTP-reset) yalnız platform_owner (canManageAdmins). Backend
// assertOwner otoriter; buradaki gate yalnız UX. Yeni admin → tek-seferlik şifre.

const ROLES: PlatformRole[] = ['platform_owner', 'platform_engineer', 'platform_support'];
const ROLE_KEY: Record<PlatformRole, string> = {
  platform_owner: 'admins.roleOwner',
  platform_engineer: 'admins.roleEngineer',
  platform_support: 'admins.roleSupport',
};

export function AdminsPage() {
  const { state } = usePlatformAuth();
  const t = useT();
  const qc = useQueryClient();
  const accessToken = state.status === 'authenticated' ? state.accessToken : null;
  const myRole = state.status === 'authenticated' ? state.admin.role : null;
  const canManage = myRole ? canManageAdmins(myRole) : false;

  const adminsQuery = useApiQuery(
    ['admins'],
    () => api<PlatformAdminRow[]>('/platform/admins', { bearer: accessToken ?? undefined }),
    { enabled: !!accessToken },
  );
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admins'] });

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<{ email: string; name: string; role: PlatformRole }>({
    email: '',
    name: '',
    role: 'platform_engineer',
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(
    null,
  );

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<PlatformAdminRow | null>(null);
  const [resetTarget, setResetTarget] = useState<PlatformAdminRow | null>(null);

  const submitCreate = async () => {
    if (!accessToken) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await api<{ admin: PlatformAdminRow; tempPassword: string }>('/platform/admins', {
        method: 'POST',
        bearer: accessToken,
        body: form,
      });
      setTempPassword({ email: res.admin.email, password: res.tempPassword });
      setCreateOpen(false);
      setForm({ email: '', name: '', role: 'platform_engineer' });
      await invalidate();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : t('admins.actionError'));
    } finally {
      setCreating(false);
    }
  };

  const runAction = async (id: string, run: () => Promise<unknown>) => {
    setBusyId(id);
    setActionError(null);
    try {
      await run();
      await invalidate();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('admins.actionError'));
    } finally {
      setBusyId(null);
    }
  };

  const changeRole = (row: PlatformAdminRow, role: PlatformRole) => {
    if (!accessToken || role === row.role) return;
    void runAction(row.id, () =>
      api(`/platform/admins/${row.id}/role`, {
        method: 'PATCH',
        bearer: accessToken,
        body: { role },
      }),
    );
  };

  const confirmDeactivate = () => {
    if (!accessToken || !deactivateTarget) return;
    const id = deactivateTarget.id;
    setDeactivateTarget(null);
    void runAction(id, () =>
      api(`/platform/admins/${id}/deactivate`, { method: 'POST', bearer: accessToken }),
    );
  };

  const confirmReset = () => {
    if (!accessToken || !resetTarget) return;
    const id = resetTarget.id;
    setResetTarget(null);
    void runAction(id, () =>
      api(`/platform/admins/${id}/reset-totp`, { method: 'POST', bearer: accessToken }),
    );
  };

  const columns: Column<PlatformAdminRow>[] = [
    {
      key: 'email',
      header: t('admins.colEmail'),
      render: (r) => (
        <>
          <div className="font-medium">{r.email}</div>
          <div className="text-xs text-muted-foreground">{r.name}</div>
        </>
      ),
    },
    {
      key: 'role',
      header: t('admins.colRole'),
      render: (r) =>
        canManage ? (
          <Select
            value={r.role}
            disabled={busyId === r.id}
            onChange={(e) => changeRole(r, e.target.value as PlatformRole)}
            className="h-8 w-auto"
            data-testid={`admin-role-${r.id}`}
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {t(ROLE_KEY[role])}
              </option>
            ))}
          </Select>
        ) : (
          <Badge tone="neutral">{t(ROLE_KEY[r.role])}</Badge>
        ),
    },
    {
      key: 'status',
      header: t('admins.colStatus'),
      render: (r) => (
        <Badge tone={r.isActive ? 'success' : 'neutral'}>
          {r.isActive ? t('admins.active') : t('admins.inactive')}
        </Badge>
      ),
    },
    {
      key: 'totp',
      header: t('admins.colTotp'),
      render: (r) => (
        <Badge tone={r.totpVerifiedAt ? 'success' : 'warning'}>
          {r.totpVerifiedAt ? t('admins.totpSet') : t('admins.totpPending')}
        </Badge>
      ),
    },
    {
      key: 'lastLogin',
      header: t('admins.colLastLogin'),
      cellClassName: 'whitespace-nowrap text-muted-foreground',
      render: (r) => (r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleString('tr-TR') : '—'),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            cellClassName: 'whitespace-nowrap',
            render: (r: PlatformAdminRow) => (
              <div className="flex gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyId === r.id || !r.isActive}
                  onClick={() => setDeactivateTarget(r)}
                  data-testid={`admin-deactivate-${r.id}`}
                >
                  {t('admins.deactivate')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyId === r.id}
                  onClick={() => setResetTarget(r)}
                  data-testid={`admin-reset-${r.id}`}
                >
                  {t('admins.resetTotp')}
                </Button>
              </div>
            ),
          } satisfies Column<PlatformAdminRow>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4" data-testid="admins-page">
      <PageHeader
        title={t('admins.title')}
        description={t('admins.subtitle')}
        action={
          canManage ? (
            <Button onClick={() => setCreateOpen(true)} data-testid="admin-new">
              <UserPlus className="h-4 w-4" aria-hidden />
              {t('admins.new')}
            </Button>
          ) : undefined
        }
      />

      {actionError && <Alert tone="error">{actionError}</Alert>}

      {tempPassword && (
        <Alert tone="success">
          <div className="space-y-1">
            <div className="font-medium">{t('admins.tempPasswordTitle')}</div>
            <div className="text-[13px]">
              {tempPassword.email} —{' '}
              <span className="font-mono font-semibold">{tempPassword.password}</span>
            </div>
            <div className="text-xs text-muted-foreground">{t('admins.tempPasswordHint')}</div>
            <Button variant="ghost" size="sm" onClick={() => setTempPassword(null)}>
              {t('common.dismiss')}
            </Button>
          </div>
        </Alert>
      )}

      {adminsQuery.isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : adminsQuery.isError ? (
        <Alert tone="error">{t('admins.loadError')}</Alert>
      ) : (
        <Table
          columns={columns}
          rows={adminsQuery.data ?? []}
          rowKey={(r) => r.id}
          rowTestId={(r) => `admin-row-${r.id}`}
          empty={t('admins.empty')}
          data-testid="admins-table"
        />
      )}

      <Modal
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        testId="admin-create-modal"
      >
        <h2 className="text-[15px] font-semibold text-foreground">{t('admins.new')}</h2>
        {createError && (
          <Alert tone="error" className="mt-3">
            {createError}
          </Alert>
        )}
        <div className="mt-4 space-y-3">
          <Field label={t('admins.colEmail')}>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              data-testid="admin-form-email"
            />
          </Field>
          <Field label={t('admins.fieldName')}>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              data-testid="admin-form-name"
            />
          </Field>
          <Field label={t('admins.colRole')}>
            <Select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as PlatformRole })}
              data-testid="admin-form-role"
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(ROLE_KEY[role])}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={submitCreate}
            loading={creating}
            disabled={!form.email.trim() || !form.name.trim()}
            data-testid="admin-form-submit"
          >
            {t('common.save')}
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deactivateTarget}
        title={t('admins.deactivateConfirmTitle')}
        description={t('admins.deactivateConfirmDesc')}
        confirmLabel={t('admins.deactivate')}
        cancelLabel={t('common.cancel')}
        busy={!!busyId}
        onConfirm={confirmDeactivate}
        onClose={() => setDeactivateTarget(null)}
      />

      <ConfirmDialog
        open={!!resetTarget}
        tone="primary"
        title={t('admins.resetTotpConfirmTitle')}
        description={t('admins.resetTotpConfirmDesc')}
        confirmLabel={t('admins.resetTotp')}
        cancelLabel={t('common.cancel')}
        busy={!!busyId}
        onConfirm={confirmReset}
        onClose={() => setResetTarget(null)}
      />
    </div>
  );
}
