import { useEffect, useState } from 'react';
import { AlertTriangle, LogOut } from 'lucide-react';
import { api, setAccessToken } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';

/**
 * F4 — Impersonation banner.
 *
 * Token'da `imp` claim'i varsa tenant UI'nın en üstünde sticky kırmızı bar
 * gösteriyor; platform admin'in adını, kalan süreyi ve "Çıkış" butonunu
 * yayınlıyor. Plan kuralı: banner kapatılamaz, z-index max, sticky.
 *
 * Stop butonu `/api/auth/stop-impersonation`'a POST atıyor → backend
 * `tenant_impersonations.ended_at` set ediyor, token revoke. Sonra
 * `/api/auth/logout` ile refresh cookie temizleniyor + local state sıfır
 * → ProtectedRoute /login'e yönlendiriyor.
 */
function formatRemaining(remainingMs: number): string {
  if (remainingMs <= 0) return '0:00';
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function ImpersonationBanner() {
  const { user, logout } = useAuth();
  const imp = user?.impersonation;
  const [remaining, setRemaining] = useState<number>(() =>
    imp ? imp.expiresAt.getTime() - Date.now() : 0,
  );
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    if (!imp) return;
    const tick = () => setRemaining(imp.expiresAt.getTime() - Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [imp]);

  if (!imp) return null;

  const expired = remaining <= 0;

  const handleStop = async () => {
    setStopping(true);
    try {
      await api.post('/auth/stop-impersonation').catch(() => undefined);
    } finally {
      setAccessToken(null);
      await logout();
    }
  };

  return (
    <div
      data-testid="impersonation-banner"
      role="alert"
      aria-live="polite"
      // z-index max, sticky top — plan: kapatılamaz, layout override edilemez.
      // CSS güveni yetmediği için tüm sayfaların ÜSTÜNDE konumlandırılıyor.
      className="sticky top-0 z-[9999] flex items-center justify-between gap-3 border-b-2 border-red-700 bg-red-600 px-4 py-2 text-white shadow-md"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
        <span>
          ⚠️ <strong>{imp.byName}</strong> tarafından <strong>{user?.email}</strong> kimliğiyle
          impersonate ediliyorsunuz.
        </span>
        <span
          className="ml-2 rounded bg-red-800 px-2 py-0.5 font-mono text-xs"
          data-testid="impersonation-remaining"
        >
          {expired ? 'Süresi doldu' : `Kalan: ${formatRemaining(remaining)}`}
        </span>
      </div>
      <button
        type="button"
        onClick={handleStop}
        disabled={stopping}
        data-testid="impersonation-stop"
        className="inline-flex items-center gap-1 rounded bg-white px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        Çıkış
      </button>
    </div>
  );
}
