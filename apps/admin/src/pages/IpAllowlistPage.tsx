import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useApiQuery } from '../lib/useApiQuery';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useT } from '../i18n';
import { canManageIpAllowlist } from '../lib/platform-roles';
import {
  Alert,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
  Table,
  type Column,
} from '../components/ui';
import type { IpAllowlistRule } from '../lib/ip-allowlist-types';

// #948 (Feature 4) — Platform IP allowlist yönetimi. list okuma; ekle/sil yalnız
// owner (canManageIpAllowlist; backend assertOwner otoriter). Sil onayında
// self-lockout uyarısı; backend son kapsayan kuralı silmeyi 409 ile engeller.
// Guard cache 30sn → "değişiklik ~30sn içinde etkinleşir" notu.

export function IpAllowlistPage() {
  const { state } = usePlatformAuth();
  const t = useT();
  const qc = useQueryClient();
  const accessToken = state.status === 'authenticated' ? state.accessToken : null;
  const myRole = state.status === 'authenticated' ? state.admin.role : null;
  const canManage = myRole ? canManageIpAllowlist(myRole) : false;

  const query = useApiQuery(
    ['ip-allowlist'],
    () => api<IpAllowlistRule[]>('/platform/ip-allowlist', { bearer: accessToken ?? undefined }),
    { enabled: !!accessToken },
  );
  const invalidate = () => qc.invalidateQueries({ queryKey: ['ip-allowlist'] });

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ cidr: '', label: '' });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<IpAllowlistRule | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const submitAdd = async () => {
    if (!accessToken) return;
    setAdding(true);
    setAddError(null);
    try {
      await api('/platform/ip-allowlist', {
        method: 'POST',
        bearer: accessToken,
        body: { cidr: form.cidr.trim(), label: form.label.trim() || undefined },
      });
      setAddOpen(false);
      setForm({ cidr: '', label: '' });
      await invalidate();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : t('ipAllowlist.actionError'));
    } finally {
      setAdding(false);
    }
  };

  const confirmDelete = async () => {
    if (!accessToken || !deleteTarget) return;
    const id = deleteTarget.id;
    setBusy(true);
    setActionError(null);
    try {
      await api(`/platform/ip-allowlist/${id}`, { method: 'DELETE', bearer: accessToken });
      setDeleteTarget(null);
      await invalidate();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('ipAllowlist.actionError'));
      setDeleteTarget(null);
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<IpAllowlistRule>[] = [
    {
      key: 'cidr',
      header: t('ipAllowlist.colCidr'),
      cellClassName: 'font-mono',
      render: (r) => r.cidr,
    },
    { key: 'label', header: t('ipAllowlist.colLabel'), render: (r) => r.label ?? '—' },
    {
      key: 'created',
      header: t('ipAllowlist.colCreated'),
      cellClassName: 'whitespace-nowrap text-muted-foreground',
      render: (r) => new Date(r.createdAt).toLocaleString('tr-TR'),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            cellClassName: 'whitespace-nowrap',
            render: (r: IpAllowlistRule) => (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteTarget(r)}
                data-testid={`ip-delete-${r.id}`}
              >
                {t('ipAllowlist.delete')}
              </Button>
            ),
          } satisfies Column<IpAllowlistRule>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4" data-testid="ip-allowlist-page">
      <PageHeader
        title={t('ipAllowlist.title')}
        description={t('ipAllowlist.subtitle')}
        action={
          canManage ? (
            <Button onClick={() => setAddOpen(true)} data-testid="ip-add">
              <Plus className="h-4 w-4" aria-hidden />
              {t('ipAllowlist.add')}
            </Button>
          ) : undefined
        }
      />

      <Alert tone="warning">{t('ipAllowlist.cacheNote')}</Alert>
      {actionError && <Alert tone="error">{actionError}</Alert>}

      {query.isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : query.isError ? (
        <Alert tone="error">{t('ipAllowlist.loadError')}</Alert>
      ) : (
        <Table
          columns={columns}
          rows={query.data ?? []}
          rowKey={(r) => r.id}
          empty={t('ipAllowlist.empty')}
          data-testid="ip-table"
        />
      )}

      <Modal open={addOpen} onClose={() => !adding && setAddOpen(false)} testId="ip-add-modal">
        <h2 className="text-[15px] font-semibold text-foreground">{t('ipAllowlist.add')}</h2>
        {addError && (
          <Alert tone="error" className="mt-3">
            {addError}
          </Alert>
        )}
        <div className="mt-4 space-y-3">
          <Field label={t('ipAllowlist.colCidr')} hint={t('ipAllowlist.cidrHint')}>
            <Input
              value={form.cidr}
              onChange={(e) => setForm({ ...form, cidr: e.target.value })}
              placeholder="203.0.113.0/24"
              data-testid="ip-form-cidr"
            />
          </Field>
          <Field label={t('ipAllowlist.colLabel')}>
            <Input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              data-testid="ip-form-label"
            />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={adding}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={submitAdd}
            loading={adding}
            disabled={!form.cidr.trim()}
            data-testid="ip-form-submit"
          >
            {t('common.save')}
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('ipAllowlist.deleteConfirmTitle')}
        description={
          deleteTarget
            ? `${deleteTarget.cidr} — ${t('ipAllowlist.deleteConfirmDesc')}`
            : t('ipAllowlist.deleteConfirmDesc')
        }
        confirmLabel={t('ipAllowlist.delete')}
        cancelLabel={t('common.cancel')}
        busy={busy}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
