import { useState } from 'react';
import {
  PageHeader,
  Card,
  Table,
  Badge,
  Button,
  Field,
  Input,
  Select,
  Textarea,
  ConfirmDialog,
  type Column,
} from '../components/ui';
import { cn } from '../lib/cn';
import { useApiQuery } from '../lib/useApiQuery';
import { api } from '../lib/api';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useI18n } from '../i18n';
import type { MaintenanceWindow, AnnouncementRow } from '../lib/maintenance-types';

// #1093 — SİSTEM › Bakım & Duyuru. İki sekme: Bakım pencereleri + Duyurular.
// Mutasyonlar backend'de platform audit'e yazılır.

type Tab = 'maintenance' | 'announcements';

function fmt(iso: string) {
  return new Date(iso).toLocaleString('tr-TR');
}
function nowLocalInput(offsetMin = 0) {
  const d = new Date(Date.now() + offsetMin * 60_000 - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

export function MaintenancePage() {
  const { state } = usePlatformAuth();
  const { t } = useI18n();
  const bearer = state.status === 'authenticated' ? state.accessToken : undefined;
  const opts = { enabled: !!bearer };
  const [tab, setTab] = useState<Tab>('maintenance');
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const windows = useApiQuery(
    ['maint-windows'],
    () => api<MaintenanceWindow[]>('/platform/maintenance/windows', { bearer }),
    opts,
  );
  const anns = useApiQuery(
    ['maint-anns'],
    () => api<AnnouncementRow[]>('/platform/maintenance/announcements', { bearer }),
    opts,
  );

  // Bakım formu
  const [mScope, setMScope] = useState('global');
  const [mTenant, setMTenant] = useState('');
  const [mMsg, setMMsg] = useState('');
  const [mStart, setMStart] = useState(nowLocalInput());
  const [mEnd, setMEnd] = useState(nowLocalInput(60));
  const [mErr, setMErr] = useState<string | null>(null);

  // Duyuru formu
  const [aTitle, setATitle] = useState('');
  const [aBody, setABody] = useState('');
  const [aSev, setASev] = useState('info');
  const [aStart, setAStart] = useState(nowLocalInput());
  const [aEnd, setAEnd] = useState(nowLocalInput(7 * 24 * 60));
  const [aErr, setAErr] = useState<string | null>(null);

  const active = (w: MaintenanceWindow) =>
    !w.cancelledAt && new Date(w.startsAt) <= new Date() && new Date(w.endsAt) > new Date();

  const createWindow = async () => {
    setMErr(null);
    setBusy(true);
    try {
      await api('/platform/maintenance/windows', {
        method: 'POST',
        bearer,
        body: {
          scope: mScope,
          targetTenantId: mScope === 'tenant' ? mTenant : undefined,
          message: mMsg,
          startsAt: new Date(mStart).toISOString(),
          endsAt: new Date(mEnd).toISOString(),
        },
      });
      setMMsg('');
      await windows.refetch();
    } catch (e) {
      setMErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const createAnnouncement = async () => {
    setAErr(null);
    setBusy(true);
    try {
      await api('/platform/maintenance/announcements', {
        method: 'POST',
        bearer,
        body: {
          title: aTitle,
          body: aBody,
          severity: aSev,
          scope: 'global',
          publishAt: new Date(aStart).toISOString(),
          expiresAt: new Date(aEnd).toISOString(),
        },
      });
      setATitle('');
      setABody('');
      await anns.refetch();
    } catch (e) {
      setAErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    if (!cancelId) return;
    setBusy(true);
    try {
      await api(`/platform/maintenance/windows/${cancelId}/cancel`, { method: 'POST', bearer });
      await windows.refetch();
      setCancelId(null);
    } finally {
      setBusy(false);
    }
  };

  const archive = async (id: string) => {
    await api(`/platform/maintenance/announcements/${id}/archive`, { method: 'POST', bearer });
    await anns.refetch();
  };

  const winCols: Column<MaintenanceWindow>[] = [
    {
      key: 'status',
      header: t('maintenance.colStatus'),
      render: (w) =>
        w.cancelledAt ? (
          <Badge tone="neutral">{t('maintenance.cancelled')}</Badge>
        ) : active(w) ? (
          <Badge tone="critical">{t('maintenance.active')}</Badge>
        ) : new Date(w.endsAt) <= new Date() ? (
          <Badge tone="neutral">{t('maintenance.past')}</Badge>
        ) : (
          <Badge tone="warning">{t('maintenance.scheduled')}</Badge>
        ),
    },
    { key: 'scope', header: t('maintenance.colScope'), render: (w) => w.scope },
    {
      key: 'msg',
      header: t('maintenance.colMessage'),
      render: (w) => <span className="text-xs">{w.message}</span>,
      cellClassName: 'max-w-xs',
    },
    {
      key: 'window',
      header: t('maintenance.colWindow'),
      render: (w) => (
        <span className="text-xs">
          {fmt(w.startsAt)} → {fmt(w.endsAt)}
        </span>
      ),
      cellClassName: 'whitespace-nowrap',
    },
    {
      key: 'action',
      header: '',
      render: (w) =>
        !w.cancelledAt && new Date(w.endsAt) > new Date() ? (
          <Button variant="ghost" size="sm" onClick={() => setCancelId(w.id)}>
            {t('maintenance.cancel')}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6" data-testid="maintenance-page">
      <PageHeader title={t('maintenance.title')} description={t('maintenance.desc')} />

      <div className="flex gap-1 border-b border-border" role="tablist">
        {(['maintenance', 'announcements'] as Tab[]).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              'min-h-[40px] px-3 text-sm font-medium',
              tab === k ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground',
            )}
          >
            {t(k === 'maintenance' ? 'maintenance.tabWindows' : 'maintenance.tabAnnouncements')}
          </button>
        ))}
      </div>

      {tab === 'maintenance' ? (
        <>
          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">{t('maintenance.schedule')}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('maintenance.fieldScope')}>
                <Select value={mScope} onChange={(e) => setMScope(e.target.value)}>
                  <option value="global">{t('maintenance.scopeGlobal')}</option>
                  <option value="tenant">{t('maintenance.scopeTenant')}</option>
                </Select>
              </Field>
              {mScope === 'tenant' && (
                <Field label={t('maintenance.fieldTenant')}>
                  <Input
                    value={mTenant}
                    onChange={(e) => setMTenant(e.target.value)}
                    placeholder="tenant UUID"
                  />
                </Field>
              )}
              <Field label={t('maintenance.fieldStart')}>
                <Input
                  type="datetime-local"
                  value={mStart}
                  onChange={(e) => setMStart(e.target.value)}
                />
              </Field>
              <Field label={t('maintenance.fieldEnd')}>
                <Input
                  type="datetime-local"
                  value={mEnd}
                  onChange={(e) => setMEnd(e.target.value)}
                />
              </Field>
            </div>
            <Field label={t('maintenance.fieldMessage')}>
              <Textarea
                value={mMsg}
                onChange={(e) => setMMsg(e.target.value)}
                rows={2}
                maxLength={500}
              />
            </Field>
            {mErr && <p className="text-sm text-[var(--crit-tx)]">{mErr}</p>}
            <Button size="sm" disabled={!mMsg || busy} onClick={createWindow}>
              {t('maintenance.scheduleBtn')}
            </Button>
          </Card>
          <Table
            columns={winCols}
            rows={windows.data ?? []}
            rowKey={(w) => w.id}
            empty={t('maintenance.noWindows')}
          />
        </>
      ) : (
        <>
          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">{t('maintenance.newAnnouncement')}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('maintenance.fieldTitle')}>
                <Input value={aTitle} onChange={(e) => setATitle(e.target.value)} maxLength={200} />
              </Field>
              <Field label={t('maintenance.fieldSeverity')}>
                <Select value={aSev} onChange={(e) => setASev(e.target.value)}>
                  <option value="info">{t('maintenance.sevInfo')}</option>
                  <option value="warning">{t('maintenance.sevWarning')}</option>
                </Select>
              </Field>
              <Field label={t('maintenance.fieldPublish')}>
                <Input
                  type="datetime-local"
                  value={aStart}
                  onChange={(e) => setAStart(e.target.value)}
                />
              </Field>
              <Field label={t('maintenance.fieldExpires')}>
                <Input
                  type="datetime-local"
                  value={aEnd}
                  onChange={(e) => setAEnd(e.target.value)}
                />
              </Field>
            </div>
            <Field label={t('maintenance.fieldBody')}>
              <Textarea
                value={aBody}
                onChange={(e) => setABody(e.target.value)}
                rows={3}
                maxLength={2000}
              />
            </Field>
            {aErr && <p className="text-sm text-[var(--crit-tx)]">{aErr}</p>}
            <Button size="sm" disabled={!aTitle || !aBody || busy} onClick={createAnnouncement}>
              {t('maintenance.publishBtn')}
            </Button>
          </Card>
          <Table
            columns={[
              {
                key: 'title',
                header: t('maintenance.fieldTitle'),
                render: (a: AnnouncementRow) => a.title,
              },
              {
                key: 'sev',
                header: t('maintenance.fieldSeverity'),
                render: (a: AnnouncementRow) => (
                  <Badge tone={a.severity === 'warning' ? 'warning' : 'info'}>{a.severity}</Badge>
                ),
              },
              {
                key: 'win',
                header: t('maintenance.colWindow'),
                render: (a: AnnouncementRow) => (
                  <span className="text-xs">
                    {fmt(a.publishAt)} → {fmt(a.expiresAt)}
                  </span>
                ),
                cellClassName: 'whitespace-nowrap',
              },
              {
                key: 'action',
                header: '',
                render: (a: AnnouncementRow) =>
                  a.archivedAt ? (
                    <Badge tone="neutral">{t('maintenance.archived')}</Badge>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => void archive(a.id)}>
                      {t('maintenance.archive')}
                    </Button>
                  ),
              },
            ]}
            rows={anns.data ?? []}
            rowKey={(a) => a.id}
            empty={t('maintenance.noAnnouncements')}
          />
        </>
      )}

      <ConfirmDialog
        open={cancelId !== null}
        title={t('maintenance.cancelTitle')}
        description={t('maintenance.cancelDesc')}
        confirmLabel={t('maintenance.cancel')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        busy={busy}
        onConfirm={doCancel}
        onClose={() => setCancelId(null)}
      />
    </div>
  );
}
