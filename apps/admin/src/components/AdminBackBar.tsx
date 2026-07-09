import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { useT } from '../i18n';

// #1094 — Sidebar'dan direkt ulaşılan ekranların TAMAMI burada olmalı (geri-buton
// kuralı: sol menüden direkt açılan ekranda geri butonu YOK — CLAUDE.md 2026-07-04).
// admin-backbar.sync.test.ts NAV_GROUPS'tan okuyup drift'i bloklar.
export const TOP_LEVEL_ROUTES = new Set<string>([
  '/',
  '/tenants',
  '/usage',
  '/impersonation/active',
  '/audit',
  '/admins',
  '/ip-allowlist',
  '/health',
  '/feature-flags',
  '/system/maintenance',
  '/feedback',
  // #1086/#1087 — İZLEME grubu top-level (sol menüden direkt ulaşılır → geri butonu yok).
  '/monitoring/server',
  '/security/events',
  '/monitoring/database',
  '/monitoring/ai',
  '/monitoring/sync',
]);

const PARENT_FALLBACKS: Array<[RegExp, string]> = [
  [/^\/tenants\/new$/, '/tenants'],
  [/^\/tenants\/[^/]+$/, '/tenants'],
];

function resolveParent(pathname: string): string {
  for (const [pattern, parent] of PARENT_FALLBACKS) {
    if (pattern.test(pathname)) return parent;
  }
  return '/';
}

/** AdminShell alt rotalarında — küçük, mute breadcrumb geri linki. */
export function AdminBackBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();

  if (TOP_LEVEL_ROUTES.has(location.pathname)) return null;

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(resolveParent(location.pathname), { replace: true });
  };

  return (
    <button
      type="button"
      onClick={handleBack}
      data-testid="admin-back"
      aria-label={t('common.back')}
      className="focus-ring mb-3 inline-flex items-center gap-1 rounded-md py-1 pr-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden />
      {t('common.back')}
    </button>
  );
}
