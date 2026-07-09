import { Link, NavLink, Outlet } from 'react-router-dom';
import {
  Activity,
  Bot,
  Building2,
  Flag,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Network,
  ScrollText,
  Database,
  RefreshCw,
  Server,
  ShieldAlert,
  TrendingUp,
  Wrench,
  UserCog,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { usePlatformAuth } from '../providers/PlatformAuthProvider';
import { useI18n, LOCALES, LOCALE_LABEL } from '../i18n';
import { cn } from '../lib/cn';
import { BRAND_GRADIENT, BRAND_MESH, BRAND_LOGO_SRC } from '../lib/brand';
import { useUnreadFeedbackCount } from '../lib/useUnreadFeedbackCount';
import { canManageAdmins } from '../lib/platform-roles';
import { Button } from './ui';
import { AdminBackBar } from './AdminBackBar';
import { ImpersonationBanner } from './ImpersonationBanner';

// DNA Platform Admin shell — airmed-design Bölüm 24.2 "Disciplined Density":
// sidebar 272px (header 104px marka gradient+mesh) + TopBar 56px.

interface NavItem {
  to: string;
  key: string;
  icon: LucideIcon;
  end?: boolean;
  ownerOnly?: boolean;
}

// #954 — Gruplu bilgi mimarisi (GENEL / KLİNİKLER / KULLANIM & GÜVENLİK / SİSTEM).
// Rol'e göre item gizlenir (ownerOnly → yalnız owner); grubun tüm item'ları
// gizlenirse başlık da render edilmez.
export const NAV_GROUPS: Array<{ labelKey: string; items: NavItem[] }> = [
  {
    labelKey: 'nav.groupGeneral',
    items: [{ to: '/', key: 'nav.overview', icon: LayoutDashboard, end: true }],
  },
  {
    labelKey: 'nav.groupClinics',
    items: [
      { to: '/tenants', key: 'nav.tenants', icon: Building2 },
      { to: '/usage', key: 'nav.usage', icon: TrendingUp },
    ],
  },
  {
    // #1092 — Grup sırası: GENEL · KLİNİKLER · İZLEME · GÜVENLİK · SİSTEM.
    // İZLEME (Sunucu/Veritabanı/AI/Senkron) GÜVENLİK'ten önce gelir.
    labelKey: 'nav.groupMonitoring',
    items: [
      { to: '/monitoring/server', key: 'nav.monitoringServer', icon: Server },
      { to: '/monitoring/database', key: 'nav.monitoringDatabase', icon: Database },
      { to: '/monitoring/ai', key: 'nav.monitoringAi', icon: Bot },
      { to: '/monitoring/sync', key: 'nav.monitoringSync', icon: RefreshCw },
    ],
  },
  {
    labelKey: 'nav.groupSecurity',
    items: [
      // #1090 — Güvenlik olayları görünürlük ekranı (login denemeleri + kilitli).
      { to: '/security/events', key: 'nav.securityEvents', icon: ShieldAlert },
      { to: '/impersonation/active', key: 'nav.impersonations', icon: UserCog },
      { to: '/audit', key: 'nav.audit', icon: ScrollText },
      { to: '/admins', key: 'nav.admins', icon: Users, ownerOnly: true },
      { to: '/ip-allowlist', key: 'nav.ipAllowlist', icon: Network, ownerOnly: true },
    ],
  },
  {
    labelKey: 'nav.groupSystem',
    items: [
      { to: '/health', key: 'nav.health', icon: Activity },
      { to: '/feature-flags', key: 'nav.featureFlags', icon: Flag },
      { to: '/system/maintenance', key: 'nav.maintenance', icon: Wrench },
      { to: '/feedback', key: 'nav.feedback', icon: MessageSquare },
    ],
  },
];

export function AdminShell() {
  const { state, logout } = usePlatformAuth();
  const { t, locale, setLocale } = useI18n();

  // #882 — gelen kutusu okunmamış (triyaj edilmemiş) istek sayacı → nav rozeti.
  // #1057 — DashboardPage ile paylaşılan React Query key: tek timer + tek istek.
  const accessToken = state.status === 'authenticated' ? state.accessToken : null;
  const myRole = state.status === 'authenticated' ? state.admin.role : null;
  const unread = useUnreadFeedbackCount(accessToken);
  const unreadCount = unread.data?.count ?? 0;

  if (state.status !== 'authenticated') return null;
  const { admin } = state;

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="flex w-[272px] shrink-0 flex-col border-r border-border bg-background max-lg:hidden">
        <div
          className="relative h-[104px] overflow-hidden p-5"
          style={{ background: BRAND_GRADIENT }}
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-10"
            style={{ backgroundImage: BRAND_MESH }}
          />
          <Link
            to="/"
            aria-label={t('shell.brand')}
            className="focus-ring relative flex h-full items-center gap-3 rounded-md"
          >
            <img src={BRAND_LOGO_SRC} alt="" className="h-9 w-9 shrink-0" />
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight text-white">
                DNA Software Solutions
              </span>
              <span className="text-[13px] font-medium text-white/70">Platform</span>
            </span>
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-4 p-3">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter(
              (n) => !n.ownerOnly || (myRole !== null && canManageAdmins(myRole)),
            );
            if (items.length === 0) return null;
            return (
              <div key={group.labelKey} className="flex flex-col gap-1">
                <div className="px-3 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {t(group.labelKey)}
                </div>
                {items.map((n) => {
                  const Icon = n.icon;
                  return (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end={n.end}
                      data-testid={`nav-${n.to.replace('/', 'home')}`}
                      className={({ isActive }) =>
                        cn(
                          'focus-ring flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-100 ease-swift',
                          isActive
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground',
                        )
                      }
                    >
                      <Icon className="h-[18px] w-[18px]" aria-hidden />
                      {t(n.key)}
                      {n.to === '/feedback' && unreadCount > 0 && (
                        <span
                          className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-badge bg-amber-500 px-1.5 text-xs font-semibold text-white"
                          aria-label={t('nav.feedbackUnread', { count: unreadCount })}
                          data-testid="nav-feedback-unread"
                        >
                          {unreadCount}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6">
          {/* Mobil marka (sidebar gizliyken) */}
          <Link to="/" className="focus-ring rounded-md text-sm font-semibold lg:hidden">
            {t('shell.brand')}
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <div
              className="flex items-center gap-0.5 rounded-lg border border-border p-0.5"
              data-testid="locale-switcher"
            >
              {LOCALES.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLocale(l)}
                  aria-pressed={locale === l}
                  data-testid={`locale-${l}`}
                  className={cn(
                    'focus-ring rounded-md px-2 py-1 text-xs font-semibold transition-colors',
                    locale === l
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {LOCALE_LABEL[l]}
                </button>
              ))}
            </div>
            <div className="hidden text-right sm:block" data-testid="platform-current-admin">
              <div className="text-[13px] font-medium leading-tight text-foreground">
                {admin.email}
              </div>
              <div className="text-xs leading-tight text-muted-foreground">{admin.role}</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void logout()}
              data-testid="platform-logout"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              <span className="max-sm:sr-only">{t('shell.logout')}</span>
            </Button>
          </div>
        </header>

        <ImpersonationBanner />

        <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
          <AdminBackBar />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
