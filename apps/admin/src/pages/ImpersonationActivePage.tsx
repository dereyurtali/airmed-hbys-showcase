import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useT } from '../i18n';
import { Alert, Button, Card, ConfirmDialog, PageHeader, Spinner } from '../components/ui';
import type { ActiveImpersonationRow } from '../lib/impersonation-types';
import { ImpersonationHistory } from './ImpersonationHistory';
import { cn } from '../lib/cn';

// F7 — Aktif impersonation oturumları sayfası.
//
// Yetki:
// - platform_owner: tüm aktif kayıtları görür, force-stop yapabilir
// - platform_engineer/support: sadece kendi açtıklarını görür
//
// 10 saniyede bir auto-refresh (countdown live görünsün).
function formatRemaining(seconds: number): string {
  if (seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ImpersonationActivePage() {
  const { state } = usePlatformAuth();
  const t = useT();
  const accessToken = state.status === 'authenticated' ? state.accessToken : null;
  const myRole = state.status === 'authenticated' ? state.admin.role : null;

  const [rows, setRows] = useState<ActiveImpersonationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [tab, setTab] = useState<'active' | 'history'>('active');

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await api<ActiveImpersonationRow[]>('/platform/impersonate/active', {
        bearer: accessToken,
      });
      setRows(res);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('impersonationActive.loadError'));
    } finally {
      setLoading(false);
    }
  }, [accessToken, t]);

  useEffect(() => {
    void load();
    const id = window.setInterval(load, 10_000);
    return () => window.clearInterval(id);
  }, [load]);

  const handleForceStop = async (id: string) => {
    if (!accessToken) return;
    setStoppingId(id);
    setConfirmId(null);
    try {
      await api(`/platform/impersonate/${id}/force-stop`, {
        method: 'POST',
        bearer: accessToken,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('impersonationActive.forceStopError'));
    } finally {
      setStoppingId(null);
    }
  };

  const th =
    'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground';
  const td = 'px-3 py-2.5 text-[13px] text-foreground';

  return (
    <section className="space-y-4" data-testid="impersonation-active-page">
      <PageHeader
        title={t('impersonationActive.title')}
        description={
          myRole === 'platform_owner'
            ? t('impersonationActive.subtitleOwner')
            : t('impersonationActive.subtitleOther')
        }
      />

      <div className="flex gap-2" role="tablist">
        {(['active', 'history'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            data-testid={`imp-tab-${key}`}
            className={cn(
              'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
              tab === key
                ? 'border-primary bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-[var(--hover)]',
            )}
          >
            {t(
              key === 'active' ? 'impersonationActive.tabActive' : 'impersonationActive.tabHistory',
            )}
          </button>
        ))}
      </div>

      {tab === 'history' && <ImpersonationHistory />}

      {tab === 'active' && (
        <>
          {loading && <Spinner label={t('common.loading')} />}
          {error && (
            <Alert tone="error" testId="impersonation-active-error">
              {error}
            </Alert>
          )}
          {!loading && rows.length === 0 && (
            <Card
              className="p-8 text-center text-sm text-muted-foreground"
              data-testid="impersonation-active-empty"
            >
              {t('impersonationActive.empty')}
            </Card>
          )}
          {rows.length > 0 && (
            <Card className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className={th}>{t('impersonationActive.colAdmin')}</th>
                    <th className={th}>{t('impersonationActive.colTarget')}</th>
                    <th className={th}>{t('impersonationActive.colClinic')}</th>
                    <th className={th}>{t('impersonationActive.colReason')}</th>
                    <th className={th}>{t('impersonationActive.colRemaining')}</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      data-testid={`active-row-${r.id}`}
                      className="border-b border-border last:border-0 hover:bg-[var(--row-hover)]"
                    >
                      <td className={td}>
                        {r.platformAdminName}{' '}
                        <span className="text-muted-foreground">{r.platformAdminEmail}</span>
                      </td>
                      <td className={td}>
                        {r.targetUserName}{' '}
                        <span className="text-muted-foreground">{r.targetUserEmail}</span>
                      </td>
                      <td className={td}>{r.targetTenantName}</td>
                      <td className={`${td} max-w-[240px] truncate`} title={r.reason}>
                        {r.reason}
                      </td>
                      <td className={`${td} font-mono tabular-nums`}>
                        {formatRemaining(r.remainingSeconds)}
                      </td>
                      <td className={td}>
                        {myRole === 'platform_owner' && (
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={stoppingId === r.id}
                            loading={stoppingId === r.id}
                            onClick={() => setConfirmId(r.id)}
                            data-testid={`force-stop-${r.id}`}
                          >
                            {stoppingId === r.id
                              ? t('impersonationActive.forceStopping')
                              : t('impersonationActive.forceStop')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <ConfirmDialog
            open={confirmId !== null}
            title={t('impersonationActive.forceStop')}
            description={t('impersonationActive.forceStopConfirm')}
            confirmLabel={t('impersonationActive.forceStop')}
            cancelLabel={t('common.cancel')}
            tone="danger"
            busy={stoppingId !== null}
            onConfirm={() => confirmId && void handleForceStop(confirmId)}
            onClose={() => setConfirmId(null)}
            testId="force-stop-dialog"
            confirmTestId="force-stop-confirm"
          />
        </>
      )}
    </section>
  );
}
