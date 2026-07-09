import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HomeRedirect } from './components/HomeRedirect';
import { AppShell } from './components/layout/AppShell';
import { PermissionGuard } from './components/PermissionGuard';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider } from './providers/AuthProvider';
import { LocaleProvider } from './providers/LocaleProvider';
import { TrpcProvider } from './providers/TrpcProvider';
import { ConfirmProvider } from './hooks/useConfirm';

// Route-level code-splitting (#407): tüm sayfa bileşenleri lazy — login bundle'ı
// artık recharts/qrcode/admin ekranlarını indirmiyor. Named export'lar default'a
// map'lenir. Shell (sidebar/header) Suspense dışında kalır → sayfa yüklenirken
// iskelet yerine sadece içerik alanı fallback gösterir.
const AdminUsersPage = lazy(() =>
  import('./pages/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })),
);
const UserDetailPage = lazy(() =>
  import('./pages/UserDetailPage').then((m) => ({ default: m.UserDetailPage })),
);
const AnalysisHubPage = lazy(() =>
  import('./pages/AnalysisHubPage').then((m) => ({ default: m.AnalysisHubPage })),
);
const AutomationsPage = lazy(() =>
  import('./pages/AutomationsPage').then((m) => ({ default: m.AutomationsPage })),
);
const AutomationAssistantPage = lazy(() =>
  import('./pages/AutomationAssistantPage').then((m) => ({
    default: m.AutomationAssistantPage,
  })),
);
const ApprovalsPage = lazy(() =>
  import('./pages/ApprovalsPage').then((m) => ({ default: m.ApprovalsPage })),
);
const ClinicSettingsPage = lazy(() =>
  import('./pages/ClinicSettingsPage').then((m) => ({ default: m.ClinicSettingsPage })),
);
const SettingsHubPage = lazy(() =>
  import('./pages/SettingsHubPage').then((m) => ({ default: m.SettingsHubPage })),
);
const RecallPage = lazy(() =>
  import('./pages/RecallPage').then((m) => ({ default: m.RecallPage })),
);
const CosignPage = lazy(() =>
  import('./pages/CosignPage').then((m) => ({ default: m.CosignPage })),
);
const ChangePasswordPage = lazy(() =>
  import('./pages/ChangePasswordPage').then((m) => ({ default: m.ChangePasswordPage })),
);
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })),
);
const CommissionPage = lazy(() =>
  import('./pages/CommissionPage').then((m) => ({ default: m.CommissionPage })),
);
const BillingPage = lazy(() =>
  import('./pages/BillingPage').then((m) => ({ default: m.BillingPage })),
);
const CashRegisterPage = lazy(() =>
  import('./pages/CashRegisterPage').then((m) => ({ default: m.CashRegisterPage })),
);
const ConsentTemplatesPage = lazy(() =>
  import('./pages/ConsentTemplatesPage').then((m) => ({ default: m.ConsentTemplatesPage })),
);
const FraudPage = lazy(() => import('./pages/FraudPage').then((m) => ({ default: m.FraudPage })));
const InvoiceDetailPage = lazy(() =>
  import('./pages/InvoiceDetailPage').then((m) => ({ default: m.InvoiceDetailPage })),
);
const ServiceCatalogPage = lazy(() =>
  import('./pages/ServiceCatalogPage').then((m) => ({ default: m.ServiceCatalogPage })),
);
const OverviewPage = lazy(() =>
  import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })),
);
const SetupPage = lazy(() => import('./pages/SetupPage').then((m) => ({ default: m.SetupPage })));
const DoctorDetailPage = lazy(() =>
  import('./pages/DoctorDetailPage').then((m) => ({ default: m.DoctorDetailPage })),
);
const DoctorFormPage = lazy(() =>
  import('./pages/DoctorFormPage').then((m) => ({ default: m.DoctorFormPage })),
);
const DoctorListPage = lazy(() =>
  import('./pages/DoctorListPage').then((m) => ({ default: m.DoctorListPage })),
);
const ForbiddenPage = lazy(() =>
  import('./pages/ForbiddenPage').then((m) => ({ default: m.ForbiddenPage })),
);
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);
const IolInventoryPage = lazy(() =>
  import('./pages/IolInventoryPage').then((m) => ({ default: m.IolInventoryPage })),
);
const StockTrackingPage = lazy(() =>
  import('./pages/StockTrackingPage').then((m) => ({ default: m.StockTrackingPage })),
);
const ConsumableManagePage = lazy(() =>
  import('./pages/ConsumableManagePage').then((m) => ({ default: m.ConsumableManagePage })),
);
const SuppliersPage = lazy(() =>
  import('./pages/SuppliersPage').then((m) => ({ default: m.SuppliersPage })),
);
const PurchaseOrdersPage = lazy(() =>
  import('./pages/PurchaseOrdersPage').then((m) => ({ default: m.PurchaseOrdersPage })),
);
const PharmacyPosPage = lazy(() =>
  import('./pages/PharmacyPosPage').then((m) => ({ default: m.PharmacyPosPage })),
);
const PharmacyPrescriptionQueuePage = lazy(() =>
  import('./pages/PharmacyPrescriptionQueuePage').then((m) => ({
    default: m.PharmacyPrescriptionQueuePage,
  })),
);
const PharmacyStockPage = lazy(() =>
  import('./pages/PharmacyStockPage').then((m) => ({ default: m.PharmacyStockPage })),
);
const PharmacyMovementsPage = lazy(() =>
  import('./pages/PharmacyMovementsPage').then((m) => ({ default: m.PharmacyMovementsPage })),
);
const PharmacySuppliersPage = lazy(() =>
  import('./pages/PharmacySuppliersPage').then((m) => ({ default: m.PharmacySuppliersPage })),
);
const PharmacyCashPage = lazy(() =>
  import('./pages/PharmacyCashPage').then((m) => ({ default: m.PharmacyCashPage })),
);
const PharmacyReturnsPage = lazy(() =>
  import('./pages/PharmacyReturnsPage').then((m) => ({ default: m.PharmacyReturnsPage })),
);
const PharmacyReportsPage = lazy(() =>
  import('./pages/PharmacyReportsPage').then((m) => ({ default: m.PharmacyReportsPage })),
);
const StockForecastPage = lazy(() =>
  import('./pages/StockForecastPage').then((m) => ({ default: m.StockForecastPage })),
);
const StockMovementsPage = lazy(() =>
  import('./pages/StockMovementsPage').then((m) => ({ default: m.StockMovementsPage })),
);
const LeadFunnelPage = lazy(() =>
  import('./pages/LeadFunnelPage').then((m) => ({ default: m.LeadFunnelPage })),
);
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const MessagingPage = lazy(() =>
  import('./pages/MessagingPage').then((m) => ({ default: m.MessagingPage })),
);
const PatientDetailPage = lazy(() =>
  import('./pages/PatientDetailPage').then((m) => ({ default: m.PatientDetailPage })),
);
const PatientFormPage = lazy(() =>
  import('./pages/PatientFormPage').then((m) => ({ default: m.PatientFormPage })),
);
const PatientListPage = lazy(() =>
  import('./pages/PatientListPage').then((m) => ({ default: m.PatientListPage })),
);
const PermissionsPage = lazy(() =>
  import('./pages/PermissionsPage').then((m) => ({ default: m.PermissionsPage })),
);
const ProcedureListPage = lazy(() =>
  import('./pages/ProcedureListPage').then((m) => ({ default: m.ProcedureListPage })),
);
const ReportsPage = lazy(() =>
  import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const MeasurementQueuePage = lazy(() =>
  import('./pages/MeasurementQueuePage').then((m) => ({ default: m.MeasurementQueuePage })),
);
const ReceptionCockpitPage = lazy(() =>
  import('./pages/ReceptionCockpitPage').then((m) => ({ default: m.ReceptionCockpitPage })),
);
const ReceptionPreferencesPage = lazy(() =>
  import('./pages/ReceptionPreferencesPage').then((m) => ({ default: m.ReceptionPreferencesPage })),
);
const SchedulePage = lazy(() =>
  import('./pages/SchedulePage').then((m) => ({ default: m.SchedulePage })),
);
const PublicWaitingMonitorPage = lazy(() =>
  import('./pages/PublicWaitingMonitorPage').then((m) => ({
    default: m.PublicWaitingMonitorPage,
  })),
);
const SurgeryDayCenterPage = lazy(() =>
  import('./pages/SurgeryDayCenterPage').then((m) => ({ default: m.SurgeryDayCenterPage })),
);
const SurgerySalesQueuePage = lazy(() =>
  import('./pages/SurgerySalesQueuePage').then((m) => ({ default: m.SurgerySalesQueuePage })),
);
const SurgeryCatalogPage = lazy(() =>
  import('./pages/SurgeryCatalogPage').then((m) => ({ default: m.SurgeryCatalogPage })),
);
const SurgeryCalendarPage = lazy(() =>
  import('./pages/SurgeryCalendarPage').then((m) => ({ default: m.SurgeryCalendarPage })),
);
const WorklistPage = lazy(() =>
  import('./pages/WorklistPage').then((m) => ({ default: m.WorklistPage })),
);

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <TrpcProvider>
          <AuthProvider>
            <LocaleProvider>
              <ConfirmProvider>
                <Suspense fallback={<PageFallback />}>
                  <Routes>
                    <Route path="/setup" element={<SetupPage />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/forbidden" element={<ForbiddenPage />} />
                    {/* S15-PR13 / #1159 — Public Waiting Monitor: AppShell DIŞINDA + KİMLİK
                    GEREKTİRMEZ (Raspberry Pi kiosk). Veri erişimi yayın anahtarıyla
                    (?key=), login değil — 7/24 TV login penceresine takılmasın. */}
                    <Route path="/public-monitor" element={<PublicWaitingMonitorPage />} />
                    <Route element={<ProtectedRoute />}>
                      <Route element={<AppShell />}>
                        {/* S16 — page:* guard'ları: ALL_ROLES için no-op, fakat ölçüm
                        hemşiresi (kilitli, ALL_ROLES dışı) bu sayfalara URL'den de
                        erişemez → /forbidden. */}
                        {/* v0.4.2 G2 (#721) — rol-aware "Genel Bakış" landing; her
                          varyantta sidebar'da pinned-top. Guard yok: her kimliği
                          doğrulanmış rol kendi (güvenli) overview'ını görür. */}
                        <Route path="/overview" element={<OverviewPage />} />
                        <Route path="/change-password" element={<ChangePasswordPage />} />
                        {/* #1051 — self-service profil (sidebar dışı; TopBar menüsünden). */}
                        <Route path="/profile" element={<ProfilePage />} />
                        <Route
                          path="/patients"
                          element={
                            <PermissionGuard required="page:patients">
                              <PatientListPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/patients/new"
                          element={
                            <PermissionGuard required="action:patient.create">
                              <PatientFormPage mode="create" />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/patients/:id"
                          element={
                            <PermissionGuard required="page:patients">
                              <PatientDetailPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/patients/:id/edit"
                          element={
                            <PermissionGuard required="action:patient.update">
                              <PatientFormPage mode="edit" />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/doctors"
                          element={
                            <PermissionGuard required="page:doctors">
                              <DoctorListPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/doctors/new"
                          element={
                            // #561 — doktor oluşturma yalnız ADMIN_ROLES (action:doctor.create);
                            // page:doctors (liste) daha geniş, form'a sızmasın (backend de gate'li).
                            <PermissionGuard required="action:doctor.create">
                              <DoctorFormPage mode="create" />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/doctors/:id"
                          element={
                            <PermissionGuard required="page:doctors">
                              <DoctorDetailPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/doctors/:id/edit"
                          element={
                            // #561 — doktor düzenleme yalnız ADMIN_ROLES (action:doctor.update).
                            <PermissionGuard required="action:doctor.update">
                              <DoctorFormPage mode="edit" />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/schedule"
                          element={
                            <PermissionGuard required="page:schedule">
                              <SchedulePage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/worklist"
                          element={
                            <PermissionGuard required="page:worklist">
                              <WorklistPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/measurement-queue"
                          element={
                            <PermissionGuard required="page:measurementQueue">
                              <MeasurementQueuePage />
                            </PermissionGuard>
                          }
                        />
                        {/* S16 — Ölçüm hemşiresi "Tamamlanan" (bugün fulfilled, salt-okunur) */}
                        <Route
                          path="/measurement-completed"
                          element={
                            <PermissionGuard required="page:measurementQueue">
                              <MeasurementQueuePage mode="completed" />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/surgery-sales"
                          element={
                            <PermissionGuard required="page:surgerySales">
                              <SurgerySalesQueuePage />
                            </PermissionGuard>
                          }
                        />
                        {/* S16 — Ameliyat satış: salt-okunur katalog + planlı ameliyat takvimi */}
                        <Route
                          path="/surgery-catalog"
                          element={
                            <PermissionGuard required="page:surgeryCatalog">
                              <SurgeryCatalogPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/surgery-calendar"
                          element={
                            <PermissionGuard required="page:surgeryCalendar">
                              <SurgeryCalendarPage />
                            </PermissionGuard>
                          }
                        />
                        {/* S15-PR9 — Ameliyat Günü Merkezi */}
                        <Route
                          path="/surgery-day"
                          element={
                            <PermissionGuard required="page:surgeryDay">
                              <SurgeryDayCenterPage />
                            </PermissionGuard>
                          }
                        />
                        {/* S15-PR13 — Public Waiting Monitor (lobby TV ekranı, AppShell
                        içinde değil; sidebar/header'sız standalone). */}
                        <Route
                          path="/reception-queue"
                          element={
                            <PermissionGuard required="page:receptionQueue">
                              <ReceptionCockpitPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/reception/preferences"
                          element={
                            <PermissionGuard required="page:receptionQueue">
                              <ReceptionPreferencesPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/leads"
                          element={
                            <PermissionGuard required="page:leads">
                              <LeadFunnelPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/inventory/iol"
                          element={
                            <PermissionGuard required="page:iolInventory">
                              <StockTrackingPage />
                            </PermissionGuard>
                          }
                        />
                        {/* S16 — IOL model/lot/kit yönetimi (CRUD) ayrı alt-rota */}
                        <Route
                          path="/inventory/iol/manage"
                          element={
                            <PermissionGuard required="page:iolInventory">
                              <IolInventoryPage />
                            </PermissionGuard>
                          }
                        />
                        {/* S15-PR22 — Yönetici stok tahmin ekranı */}
                        <Route
                          path="/inventory/forecast"
                          element={
                            <PermissionGuard required="page:iolInventory">
                              <StockForecastPage />
                            </PermissionGuard>
                          }
                        />
                        {/* v0.4.1 #691 — Klinik Mal Kabul / Stok Hareketleri */}
                        <Route
                          path="/inventory/stock-movements"
                          element={
                            <PermissionGuard required="page:iolInventory">
                              <StockMovementsPage />
                            </PermissionGuard>
                          }
                        />
                        {/* #372 — Sarf malzeme (Consumable) + Cerrahi Kit CRUD */}
                        <Route
                          path="/inventory/consumables"
                          element={
                            <PermissionGuard required="page:iolInventory">
                              <ConsumableManagePage />
                            </PermissionGuard>
                          }
                        />
                        {/* v0.4 #547 — Tedarikçiler */}
                        <Route
                          path="/suppliers"
                          element={
                            <PermissionGuard required="page:suppliers">
                              <SuppliersPage />
                            </PermissionGuard>
                          }
                        />
                        {/* v0.4 #550 — Satın Alma Siparişleri + onay kuyruğu */}
                        <Route
                          path="/purchase-orders"
                          element={
                            <PermissionGuard required="page:purchaseOrders">
                              <PurchaseOrdersPage />
                            </PermissionGuard>
                          }
                        />
                        {/* v0.4 #553 — Eczane Satış (POS) */}
                        <Route
                          path="/pharmacy/pos"
                          element={
                            <PermissionGuard required="page:pharmacyPos">
                              <PharmacyPosPage />
                            </PermissionGuard>
                          }
                        />
                        {/* v0.4 #554-558 — Eczane perakende ekranları */}
                        <Route
                          path="/pharmacy/prescriptions"
                          element={
                            <PermissionGuard required="page:pharmacyPrescriptions">
                              <PharmacyPrescriptionQueuePage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/pharmacy/stock"
                          element={
                            <PermissionGuard required="page:pharmacyStock">
                              <PharmacyStockPage />
                            </PermissionGuard>
                          }
                        />
                        {/* v0.4.1 #692 — Eczane Mal Kabul / Stok Hareketleri.
                          #714 — dedicated key page:pharmacyIntake (önceden page:pharmacyStock
                          ile korunup dedicated key ölü kalıyordu). */}
                        <Route
                          path="/pharmacy/purchase"
                          element={
                            <PermissionGuard required="page:pharmacyIntake">
                              <PharmacyMovementsPage />
                            </PermissionGuard>
                          }
                        />
                        {/* v0.4.1 #693 — Eczane Tedarikçileri. #714 — dedicated key
                          page:pharmacySuppliers (drift kapatıldı). */}
                        <Route
                          path="/pharmacy/suppliers"
                          element={
                            <PermissionGuard required="page:pharmacySuppliers">
                              <PharmacySuppliersPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/pharmacy/cash"
                          element={
                            <PermissionGuard required="page:pharmacyCash">
                              <PharmacyCashPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/pharmacy/returns"
                          element={
                            <PermissionGuard required="page:pharmacyReturns">
                              <PharmacyReturnsPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/pharmacy/reports"
                          element={
                            <PermissionGuard required="page:pharmacyReports">
                              <PharmacyReportsPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/prosedurler"
                          element={
                            <PermissionGuard required="page:procedures">
                              <ProcedureListPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/reports"
                          element={
                            <PermissionGuard required="page:reports">
                              <ReportsPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/admin/hakedis"
                          element={
                            <PermissionGuard required="page:commission">
                              <CommissionPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/admin/fraud"
                          element={
                            <PermissionGuard required="page:fraud">
                              <FraudPage />
                            </PermissionGuard>
                          }
                        />
                        {/* S16+ — Yönetici hub sayfaları (Analiz + Ayarlar) */}
                        <Route
                          path="/admin/analiz"
                          element={
                            <PermissionGuard required="page:adminAnalysis">
                              <AnalysisHubPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/admin/ayarlar"
                          element={
                            <PermissionGuard required="page:adminSettings">
                              <SettingsHubPage />
                            </PermissionGuard>
                          }
                        />
                        {/* EPIC #1018 — Otomasyonlar hub'ı + AI asistan detayı (#1022/#1031) */}
                        <Route
                          path="/admin/otomasyonlar"
                          element={
                            <PermissionGuard required="page:adminAutomations">
                              <AutomationsPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/admin/otomasyonlar/hasta-asistani"
                          element={
                            <PermissionGuard required="page:adminAutomations">
                              <AutomationAssistantPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/admin/clinic-settings"
                          element={
                            <PermissionGuard required="page:clinicSettings">
                              <ClinicSettingsPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/admin/users"
                          element={
                            <PermissionGuard required="page:users">
                              <AdminUsersPage />
                            </PermissionGuard>
                          }
                        />
                        {/* #1050 — detay sayfası; sidebar'da YOK (BackBar otomatik) */}
                        <Route
                          path="/admin/users/:id"
                          element={
                            <PermissionGuard required="page:users">
                              <UserDetailPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/admin/permissions"
                          element={
                            <PermissionGuard required="page:permissions">
                              <PermissionsPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/approvals"
                          element={
                            <PermissionGuard required="page:approvals">
                              <ApprovalsPage />
                            </PermissionGuard>
                          }
                        />
                        {/* S15-PR20 — Post-op recall yönetimi */}
                        <Route
                          path="/recall"
                          element={
                            <PermissionGuard required="action:recall.list">
                              <RecallPage />
                            </PermissionGuard>
                          }
                        />
                        {/* S15-PR23 — Doktor co-sign onayları */}
                        <Route
                          path="/cosign"
                          element={
                            <PermissionGuard required="action:audit.cosign">
                              <CosignPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/admin/consent-templates"
                          element={
                            <PermissionGuard required="page:consentTemplates">
                              <ConsentTemplatesPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/admin/messaging"
                          element={
                            <PermissionGuard required="page:messaging">
                              <MessagingPage />
                            </PermissionGuard>
                          }
                        />
                        {/* S11d — Billing */}
                        <Route
                          path="/billing"
                          element={
                            <PermissionGuard required="page:billing">
                              <BillingPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/billing/:id"
                          element={
                            <PermissionGuard required="page:billing">
                              <InvoiceDetailPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/admin/cash-register"
                          element={
                            <PermissionGuard required="page:cashRegister">
                              <CashRegisterPage />
                            </PermissionGuard>
                          }
                        />
                        <Route
                          path="/admin/service-catalog"
                          element={
                            <PermissionGuard required="page:serviceCatalog">
                              <ServiceCatalogPage />
                            </PermissionGuard>
                          }
                        />
                        {/* #403 — Kök "/" rol-bazlı landing; tanımsız route artık sessizce
                        landing'e atmıyor, AppShell içinde 404 gösterir. */}
                        <Route index element={<HomeRedirect />} />
                        <Route path="*" element={<NotFoundPage />} />
                      </Route>
                    </Route>
                  </Routes>
                </Suspense>
              </ConfirmProvider>
            </LocaleProvider>
          </AuthProvider>
        </TrpcProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
