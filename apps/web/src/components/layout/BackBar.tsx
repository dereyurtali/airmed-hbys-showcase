import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { getSidebarVariant, isTopLevelRoute } from '../../lib/sidebar-variant';
import { useAuth } from '../../providers/AuthProvider';

/**
 * Pathname pattern → parent fallback. Browser history yoksa (deep-link / refresh)
 * bu eşlemeden parent'a gider. Spesifikten genele sırala.
 */
const PARENT_FALLBACKS: Array<[RegExp, string]> = [
  [/^\/patients\/[^/]+\/edit$/, '/patients'],
  [/^\/patients\/[^/]+$/, '/patients'],
  [/^\/patients\/new$/, '/patients'],
  [/^\/doctors\/[^/]+\/edit$/, '/doctors'],
  [/^\/doctors\/[^/]+$/, '/doctors'],
  [/^\/doctors\/new$/, '/doctors'],
  [/^\/billing\/[^/]+$/, '/billing'],
  [/^\/inventory\/iol\/manage$/, '/inventory/iol'],
  [/^\/admin\/clinic-settings$/, '/admin/ayarlar'],
  // Yönetici sade sidebar'ında hub'tan açılan tüm admin alt sayfaları:
  [
    /^\/admin\/(users|permissions|messaging|hakedis|fraud|lab-thresholds|consent-templates|cash-register|service-catalog)$/,
    '/admin/ayarlar',
  ],
  [
    /^\/(reports|recall|cosign|leads|prosedurler|surgery-day|surgery-sales|inventory\/forecast)$/,
    '/admin/analiz',
  ],
];

function resolveParent(pathname: string): string {
  for (const [pattern, parent] of PARENT_FALLBACKS) {
    if (pattern.test(pathname)) return parent;
  }
  // #908 — jenerik /dashboard emekli; evrensel üst = /overview (her varyantta pinned-top).
  return '/overview';
}

/**
 * Alt ekranlarda PageHeader'ın üstünde görünen sade breadcrumb link'i.
 * Rol-aware: aktif sidebar varyantına göre top-level allowlist'i farklı.
 * Örn. sadece-yönetici sidebar'ı 6 öğeli; Ayarlar hub'undan açılan Kullanıcılar
 * /admin/users orada sidebar destinasyonu DEĞİL → BackBar görünür.
 * yonetici_asistani için aynı /admin/users tam sidebar'da top-level → gizli.
 */
export function BackBar() {
  const { t } = useTranslation('common');
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  // v0.4 (#541) — mod-duyarlı varyant: kilitli kiosk / hemşire modu BackBar'ın
  // top-level kabul ettiği rotaları da Sidebar ile aynı tutar.
  const variant = getSidebarVariant(user?.roles ?? [], user?.mode);
  if (isTopLevelRoute(location.pathname, variant)) return null;

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(resolveParent(location.pathname), { replace: true });
    }
  };

  return (
    <button
      type="button"
      onClick={handleBack}
      className="mb-3 -ml-1 inline-flex min-h-11 items-center gap-1 rounded px-2 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t('actions.back')}
    >
      <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
      <span>{t('actions.back')}</span>
    </button>
  );
}
