import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AdminShell } from './components/AdminShell';
import { I18nProvider } from './i18n';
import { PlatformAuthProvider, usePlatformAuth } from './providers/PlatformAuthProvider';
import { LoginPage } from './pages/LoginPage';
import { SetupTotpPage } from './pages/SetupTotpPage';
import { VerifyTotpPage } from './pages/VerifyTotpPage';
import { Spinner } from './components/ui';

// #1068 — route-level code splitting (apps/web deseni): 15 sayfa tek 377KB
// eager chunk'taydı; login/TOTP ekranı için bile tüm CRUD kodu iniyordu.
// Login/TOTP eager kalır (ilk boya yolu), shell sayfaları lazy.
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const TenantsListPage = lazy(() =>
  import('./pages/TenantsListPage').then((m) => ({ default: m.TenantsListPage })),
);
const UsageGrowthPage = lazy(() =>
  import('./pages/UsageGrowthPage').then((m) => ({ default: m.UsageGrowthPage })),
);
const NewTenantPage = lazy(() =>
  import('./pages/NewTenantPage').then((m) => ({ default: m.NewTenantPage })),
);
const TenantDetailPage = lazy(() =>
  import('./pages/TenantDetailPage').then((m) => ({ default: m.TenantDetailPage })),
);
const HealthPage = lazy(() =>
  import('./pages/HealthPage').then((m) => ({ default: m.HealthPage })),
);
const SecurityEventsPage = lazy(() =>
  import('./pages/SecurityEventsPage').then((m) => ({ default: m.SecurityEventsPage })),
);
const ServerMonitorPage = lazy(() =>
  import('./pages/ServerMonitorPage').then((m) => ({ default: m.ServerMonitorPage })),
);
const AiMonitorPage = lazy(() =>
  import('./pages/AiMonitorPage').then((m) => ({ default: m.AiMonitorPage })),
);
const SyncMonitorPage = lazy(() =>
  import('./pages/SyncMonitorPage').then((m) => ({ default: m.SyncMonitorPage })),
);
const DatabaseMonitorPage = lazy(() =>
  import('./pages/DatabaseMonitorPage').then((m) => ({ default: m.DatabaseMonitorPage })),
);
const MaintenancePage = lazy(() =>
  import('./pages/MaintenancePage').then((m) => ({ default: m.MaintenancePage })),
);
const FeatureFlagsPage = lazy(() =>
  import('./pages/FeatureFlagsPage').then((m) => ({ default: m.FeatureFlagsPage })),
);
const FeedbackListPage = lazy(() =>
  import('./pages/FeedbackListPage').then((m) => ({ default: m.FeedbackListPage })),
);
const ImpersonationActivePage = lazy(() =>
  import('./pages/ImpersonationActivePage').then((m) => ({ default: m.ImpersonationActivePage })),
);
const AdminsPage = lazy(() =>
  import('./pages/AdminsPage').then((m) => ({ default: m.AdminsPage })),
);
const AuditLogPage = lazy(() =>
  import('./pages/AuditLogPage').then((m) => ({ default: m.AuditLogPage })),
);
const IpAllowlistPage = lazy(() =>
  import('./pages/IpAllowlistPage').then((m) => ({ default: m.IpAllowlistPage })),
);

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner />
    </div>
  );
}

function ProtectedShell() {
  const { state } = usePlatformAuth();
  if (state.status === 'bootstrapping') return null;
  if (state.status !== 'authenticated') return <Navigate to="/login" replace />;
  return <AdminShell />;
}

export default function App() {
  return (
    <BrowserRouter>
      <I18nProvider>
        <PlatformAuthProvider>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/setup-totp" element={<SetupTotpPage />} />
              <Route path="/verify-totp" element={<VerifyTotpPage />} />
              <Route element={<ProtectedShell />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/tenants" element={<TenantsListPage />} />
                <Route path="/usage" element={<UsageGrowthPage />} />
                <Route path="/tenants/new" element={<NewTenantPage />} />
                <Route path="/tenants/:id" element={<TenantDetailPage />} />
                <Route path="/health" element={<HealthPage />} />
                <Route path="/security/events" element={<SecurityEventsPage />} />
                <Route path="/monitoring/server" element={<ServerMonitorPage />} />
                <Route path="/monitoring/database" element={<DatabaseMonitorPage />} />
                <Route path="/monitoring/ai" element={<AiMonitorPage />} />
                <Route path="/monitoring/sync" element={<SyncMonitorPage />} />
                <Route path="/feature-flags" element={<FeatureFlagsPage />} />
                <Route path="/system/maintenance" element={<MaintenancePage />} />
                <Route path="/feedback" element={<FeedbackListPage />} />
                <Route path="/impersonation/active" element={<ImpersonationActivePage />} />
                <Route path="/admins" element={<AdminsPage />} />
                <Route path="/audit" element={<AuditLogPage />} />
                <Route path="/ip-allowlist" element={<IpAllowlistPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </PlatformAuthProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}
