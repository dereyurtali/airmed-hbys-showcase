import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useT } from '../i18n';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import type { ActiveImpersonationRow } from '../lib/impersonation-types';

// #404 — Aktif impersonation global banner. Impersonation hassas + audit'li bir
// işlem; açık bir oturum varken her ekranda kalıcı uyarı görünmeli. Owner tüm
// oturumları görür; engineer/support yalnız kendi açtıklarını (backend filtreler).
// 30 sn'de bir hafif poll — ActiveImpersonationPage 10 sn ile canlı tabloyu tutar.
const POLL_MS = 30_000;

export function ImpersonationBanner() {
  const { state } = usePlatformAuth();
  const accessToken = state.status === 'authenticated' ? state.accessToken : null;
  const t = useT();
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const rows = await api<ActiveImpersonationRow[]>('/platform/impersonate/active', {
        bearer: accessToken,
      });
      setCount(rows.length);
    } catch {
      // Banner is best-effort; a transient failure shouldn't surface an error.
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
    const id = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  if (count === 0) return null;

  return (
    <div
      data-testid="impersonation-banner"
      className="sticky top-14 z-10 flex items-center justify-center gap-3 border-b border-[var(--warn-bd)] bg-[var(--warn-bg)] px-4 py-2 text-[13px] font-semibold text-[var(--warn-tx)]"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <span>{t('impersonationBanner.text', { count })}</span>
      <Link
        to="/impersonation/active"
        className="focus-ring rounded-md underline underline-offset-2 hover:opacity-80"
        data-testid="impersonation-banner-link"
      >
        {t('impersonationBanner.view')}
      </Link>
    </div>
  );
}
