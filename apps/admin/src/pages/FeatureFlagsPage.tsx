import { useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useT } from '../i18n';
import { canMutate } from '../lib/platform-roles';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
  Textarea,
} from '../components/ui';
import type { FlagDefinition, FlagOverride } from '../lib/feature-flag-types';
import type { TenantRow } from '../lib/tenant-types';

const KEY_RE = /^[a-z][a-z0-9_]*$/;
type CreateForm = {
  key: string;
  name: string;
  description: string;
  defaultValue: boolean;
  isGlobal: boolean;
};
const EMPTY_CREATE: CreateForm = {
  key: '',
  name: '',
  description: '',
  defaultValue: false,
  isGlobal: false,
};

export function FeatureFlagsPage() {
  const { state } = usePlatformAuth();
  const t = useT();
  const accessToken = state.status === 'authenticated' ? state.accessToken : null;
  const mayMutate = state.status === 'authenticated' && canMutate(state.admin.role);

  const [flags, setFlags] = useState<FlagDefinition[] | null>(null);
  const [tenants, setTenants] = useState<TenantRow[] | null>(null);
  const [overridesByFlag, setOverridesByFlag] = useState<Record<string, FlagOverride[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expandedFlag, setExpandedFlag] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editTarget, setEditTarget] = useState<FlagDefinition | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; description: string }>({
    name: '',
    description: '',
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const reload = async () => {
    if (!accessToken) return;
    setError(null);
    try {
      const [flagList, tenantList] = await Promise.all([
        api<FlagDefinition[]>('/platform/feature-flags', { bearer: accessToken }),
        api<TenantRow[]>('/platform/tenants', { bearer: accessToken }),
      ]);
      setFlags(flagList);
      setTenants(tenantList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('flags.loadError'));
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line
  }, [accessToken]);

  const loadOverrides = async (key: string) => {
    if (!accessToken) return;
    try {
      const list = await api<FlagOverride[]>(`/platform/feature-flags/${key}/overrides`, {
        bearer: accessToken,
      });
      setOverridesByFlag((prev) => ({ ...prev, [key]: list }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('flags.overrideLoadError'));
    }
  };

  const toggleExpand = async (key: string) => {
    if (expandedFlag === key) {
      setExpandedFlag(null);
      return;
    }
    setExpandedFlag(key);
    if (!overridesByFlag[key]) await loadOverrides(key);
  };

  const setOverride = async (key: string, tenantId: string, value: boolean) => {
    if (!accessToken) return;
    setBusy(`${key}:${tenantId}`);
    setError(null);
    try {
      await api(`/platform/feature-flags/${key}/tenant/${tenantId}`, {
        method: 'PUT',
        bearer: accessToken,
        body: { value },
      });
      await Promise.all([loadOverrides(key), reload()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('flags.overrideSaveError'));
    } finally {
      setBusy(null);
    }
  };

  const clearOverride = async (key: string, tenantId: string) => {
    if (!accessToken) return;
    setBusy(`${key}:${tenantId}`);
    setError(null);
    try {
      await api(`/platform/feature-flags/${key}/tenant/${tenantId}`, {
        method: 'DELETE',
        bearer: accessToken,
      });
      await Promise.all([loadOverrides(key), reload()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('flags.overrideClearError'));
    } finally {
      setBusy(null);
    }
  };

  const toggleDefault = async (key: string, current: boolean) => {
    if (!accessToken) return;
    setBusy(`${key}:default`);
    setError(null);
    try {
      await api(`/platform/feature-flags/${key}`, {
        method: 'PATCH',
        bearer: accessToken,
        body: { defaultValue: !current },
      });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('flags.defaultError'));
    } finally {
      setBusy(null);
    }
  };

  const openCreate = () => {
    setCreateForm(EMPTY_CREATE);
    setCreateError(null);
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    if (!accessToken) return;
    setCreateSaving(true);
    setCreateError(null);
    try {
      const description = createForm.description.trim();
      await api('/platform/feature-flags', {
        method: 'POST',
        bearer: accessToken,
        body: {
          key: createForm.key.trim(),
          name: createForm.name.trim(),
          description: description || undefined,
          defaultValue: createForm.defaultValue,
          isGlobal: createForm.isGlobal,
        },
      });
      setCreateOpen(false);
      await reload();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : t('flags.createError'));
    } finally {
      setCreateSaving(false);
    }
  };

  const openEdit = (f: FlagDefinition) => {
    setEditTarget(f);
    setEditForm({ name: f.name, description: f.description ?? '' });
    setEditError(null);
  };

  const submitEdit = async () => {
    if (!accessToken || !editTarget) return;
    setEditSaving(true);
    setEditError(null);
    try {
      await api(`/platform/feature-flags/${editTarget.key}`, {
        method: 'PATCH',
        bearer: accessToken,
        body: {
          name: editForm.name.trim(),
          description: editForm.description.trim(),
        },
      });
      setEditTarget(null);
      await reload();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : t('flags.updateError'));
    } finally {
      setEditSaving(false);
    }
  };

  const keyValid = KEY_RE.test(createForm.key.trim()) && createForm.key.trim().length >= 3;
  const createValid = keyValid && createForm.name.trim().length >= 2;

  return (
    <div className="space-y-4" data-testid="feature-flags-page">
      <PageHeader
        title={t('flags.title')}
        description={t('flags.desc')}
        action={
          mayMutate ? (
            <Button onClick={openCreate} data-testid="flag-new">
              <Plus className="h-4 w-4" aria-hidden />
              {t('flags.new')}
            </Button>
          ) : undefined
        }
      />
      {!mayMutate && (
        <Alert tone="warning" testId="flags-readonly-note">
          {t('flags.readOnlyNote')}
        </Alert>
      )}

      {error && <Alert tone="error">{error}</Alert>}

      {!flags ? (
        <Spinner label={t('common.loading')} />
      ) : flags.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">{t('flags.empty')}</Card>
      ) : (
        <ul className="space-y-2" data-testid="flags-list">
          {flags.map((f) => (
            <li key={f.key}>
              <Card className="p-4" data-testid={`flag-${f.key}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground">{f.name}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <code className="font-mono">{f.key}</code>
                      {f.isGlobal && <Badge tone="neutral">{t('flags.globalBadge')}</Badge>}
                    </div>
                    {f.description && (
                      <p className="mt-1.5 text-[13px] text-muted-foreground">{f.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-[13px] text-foreground">
                      <input
                        type="checkbox"
                        checked={f.defaultValue}
                        disabled={!mayMutate || busy === `${f.key}:default`}
                        onChange={() => void toggleDefault(f.key, f.defaultValue)}
                        className="h-4 w-4 accent-[#0166A8]"
                        data-testid={`flag-default-${f.key}`}
                      />
                      {t('flags.default')}
                    </label>
                    <span className="text-xs text-muted-foreground">
                      {t('flags.overrideCount', { n: f._count?.overrides ?? 0 })}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void toggleExpand(f.key)}
                      data-testid={`flag-expand-${f.key}`}
                    >
                      {expandedFlag === f.key ? t('flags.close') : t('flags.showOverrides')}
                    </Button>
                    {mayMutate && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(f)}
                        data-testid={`flag-edit-${f.key}`}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                        {t('flags.edit')}
                      </Button>
                    )}
                  </div>
                </div>

                {expandedFlag === f.key && tenants && (
                  <div className="mt-3 border-t border-border pt-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('flags.perTenant')}
                    </div>
                    {f.isGlobal ? (
                      <p className="text-[13px] text-muted-foreground">
                        {t('flags.globalNoOverride')}
                      </p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {tenants.map((tenant) => {
                          const override = overridesByFlag[f.key]?.find(
                            (o) => o.tenantId === tenant.id,
                          );
                          const effective =
                            override !== undefined ? override.value : f.defaultValue;
                          return (
                            <li
                              key={tenant.id}
                              className="flex items-center justify-between gap-3 py-2"
                              data-testid={`override-row-${f.key}-${tenant.slug}`}
                            >
                              <div className="min-w-0">
                                <div className="text-[13px] text-foreground">{tenant.name}</div>
                                <code className="font-mono text-xs text-muted-foreground">
                                  {tenant.slug}
                                </code>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge tone={effective ? 'success' : 'neutral'}>
                                  {effective ? t('flags.on') : t('flags.off')}
                                  {override === undefined && t('flags.defaultSuffix')}
                                </Badge>
                                {mayMutate && (
                                  <Button
                                    variant={effective ? 'danger' : 'success'}
                                    size="sm"
                                    disabled={busy === `${f.key}:${tenant.id}`}
                                    onClick={() => void setOverride(f.key, tenant.id, !effective)}
                                    data-testid={`toggle-${f.key}-${tenant.slug}`}
                                  >
                                    {effective ? t('flags.toggleOff') : t('flags.toggleOn')}
                                  </Button>
                                )}
                                {mayMutate && override !== undefined && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={busy === `${f.key}:${tenant.id}`}
                                    onClick={() => void clearOverride(f.key, tenant.id)}
                                    data-testid={`clear-${f.key}-${tenant.slug}`}
                                  >
                                    {t('flags.backToDefault')}
                                  </Button>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={createOpen}
        onClose={() => !createSaving && setCreateOpen(false)}
        testId="flag-create-modal"
      >
        <h2 className="text-[15px] font-semibold text-foreground">{t('flags.createTitle')}</h2>
        {createError && (
          <Alert tone="error" className="mt-3">
            {createError}
          </Alert>
        )}
        <div className="mt-4 space-y-3">
          <Field
            label={t('flags.fieldKey')}
            hint={t('flags.fieldKeyHint')}
            error={createForm.key.trim() && !keyValid ? t('flags.keyInvalid') : undefined}
          >
            <Input
              value={createForm.key}
              onChange={(e) => setCreateForm({ ...createForm, key: e.target.value })}
              placeholder="new_feature_flag"
              className="font-mono"
              data-testid="flag-form-key"
            />
          </Field>
          <Field label={t('flags.fieldName')}>
            <Input
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              data-testid="flag-form-name"
            />
          </Field>
          <Field label={t('flags.fieldDescription')}>
            <Textarea
              rows={2}
              value={createForm.description}
              onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
              data-testid="flag-form-description"
            />
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-foreground">
            <input
              type="checkbox"
              checked={createForm.defaultValue}
              onChange={(e) => setCreateForm({ ...createForm, defaultValue: e.target.checked })}
              className="h-4 w-4 accent-[#0166A8]"
              data-testid="flag-form-default"
            />
            {t('flags.fieldDefault')}
          </label>
          <div>
            <label className="flex items-center gap-2 text-[13px] text-foreground">
              <input
                type="checkbox"
                checked={createForm.isGlobal}
                onChange={(e) => setCreateForm({ ...createForm, isGlobal: e.target.checked })}
                className="h-4 w-4 accent-[#0166A8]"
                data-testid="flag-form-global"
              />
              {t('flags.fieldGlobal')}
            </label>
            <p className="mt-1 pl-6 text-xs text-muted-foreground">{t('flags.fieldGlobalHint')}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={createSaving}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={submitCreate}
            loading={createSaving}
            disabled={!createValid}
            data-testid="flag-form-submit"
          >
            {t('common.save')}
          </Button>
        </div>
      </Modal>

      <Modal
        open={!!editTarget}
        onClose={() => !editSaving && setEditTarget(null)}
        testId="flag-edit-modal"
      >
        <h2 className="text-[15px] font-semibold text-foreground">{t('flags.editTitle')}</h2>
        {editTarget && (
          <code className="mt-1 block font-mono text-xs text-muted-foreground">
            {editTarget.key}
          </code>
        )}
        {editError && (
          <Alert tone="error" className="mt-3">
            {editError}
          </Alert>
        )}
        <div className="mt-4 space-y-3">
          <Field label={t('flags.fieldName')}>
            <Input
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              data-testid="flag-edit-name"
            />
          </Field>
          <Field label={t('flags.fieldDescription')}>
            <Textarea
              rows={2}
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              data-testid="flag-edit-description"
            />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setEditTarget(null)} disabled={editSaving}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={submitEdit}
            loading={editSaving}
            disabled={editForm.name.trim().length < 2}
            data-testid="flag-edit-submit"
          >
            {t('common.save')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
