import { Suspense, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '../ui/skeleton';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { ImpersonationBanner } from '../ImpersonationBanner';
import { SyncBanner } from '../SyncBanner';
import { Toaster } from '../Toaster';
import { NotificationSocketProvider } from '../../providers/NotificationSocketProvider';
import { BackBar } from './BackBar';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { AnnouncementBanner } from './AnnouncementBanner';

export function AppShell() {
  const { t } = useTranslation('common');
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  // On navigation: close the mobile drawer, reset scroll to top, and move
  // focus to the main region so keyboard/screen-reader users land on the new
  // content instead of staying on a stale element.
  useEffect(() => {
    setMobileOpen(false);
    mainRef.current?.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  return (
    <NotificationSocketProvider>
      {/* Kabuk viewport yüksekliğine sabit; sayfa boyu büyümez, yalnız main
          kayar → sidebar yanda sabit kalır, içerikle uzamaz. */}
      <div className="flex h-screen flex-col overflow-hidden">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:border focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('nav.skipToContent')}
        </a>
        {/* F4 — Banner her sayfanın üstünde; sticky top, z-index max. */}
        <ImpersonationBanner />
        {/* A12 — Sync/offline banner (impersonation banner'ın altında). */}
        <SyncBanner />
        <div className="flex min-h-0 flex-1">
          <div className="hidden lg:block">
            <Sidebar />
          </div>

          <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
            <DialogContent variant="drawer" className="lg:hidden p-0">
              <DialogTitle className="sr-only">{t('nav.mainMenu')}</DialogTitle>
              <Sidebar onNavigate={() => setMobileOpen(false)} />
            </DialogContent>
          </Dialog>

          {/* min-w-0: kolon flex item'ı; yoksa nowrap/truncate içerik min-content'e
              genişletir ve tüm ekran sağa taşar (#1038). */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <TopBar onMenuClick={() => setMobileOpen(true)} />
            <main
              id="main-content"
              ref={mainRef}
              tabIndex={-1}
              className="min-h-0 flex-1 overflow-auto bg-muted/30 p-6 outline-none md:p-8"
            >
              <BackBar />
              <AnnouncementBanner />
              {/* #407/#808 — Lazy sayfa yüklenirken kabuk (sidebar/header) sabit
                  kalır; yalnız içerik alanı bölüm skeleton'ları gösterir
                  (Bölüm 24: statik iskelet, shimmer yok). */}
              <Suspense
                fallback={
                  <div className="space-y-4" aria-busy="true" aria-live="polite">
                    <Skeleton className="h-7 w-48" />
                    <Skeleton className="h-24 w-full" />
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <Skeleton className="h-28 w-full" />
                      <Skeleton className="h-28 w-full" />
                      <Skeleton className="h-28 w-full" />
                    </div>
                    <Skeleton className="h-64 w-full" />
                  </div>
                }
              >
                <Outlet />
              </Suspense>
            </main>
          </div>
        </div>
        <Toaster />
      </div>
    </NotificationSocketProvider>
  );
}
