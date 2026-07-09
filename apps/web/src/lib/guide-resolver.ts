import { matchPath } from 'react-router-dom';
import type { SidebarVariant } from './sidebar-variant';

// #1072 — Ekran-duyarlı kılavuz: pathname → screenKey + SidebarVariant →
// guide varyant anahtarı. Yeni rol-tespit mantığı YAZILMAZ (getSidebarVariant
// tek kaynak); burada yalnız rota→ekran haritası + varyant adı eşlemesi.

// Rota kalıbı → screenKey. Dinamik segmentler react-router matchPath ile
// (spesifik → genel sıra önemli: '/patients/new' '/patients/:id'den önce).
const ROUTE_GUIDE_MAP: { pattern: string; key: string }[] = [
  { pattern: '/patients/new', key: 'patientForm' },
  { pattern: '/patients/:id/edit', key: 'patientForm' },
  { pattern: '/patients/:id', key: 'patientDetail' },
  { pattern: '/patients', key: 'patients' },
  { pattern: '/doctors/:id/edit', key: 'doctorForm' },
  { pattern: '/doctors/:id', key: 'doctorDetail' },
  { pattern: '/doctors/new', key: 'doctorForm' },
  { pattern: '/doctors', key: 'doctors' },
  { pattern: '/schedule', key: 'schedule' },
  { pattern: '/worklist', key: 'worklist' },
  { pattern: '/measurement-queue', key: 'measurementQueue' },
  { pattern: '/measurement-completed', key: 'measurementCompleted' },
  { pattern: '/reception-queue', key: 'receptionQueue' },
  { pattern: '/surgery-day', key: 'surgeryDay' },
  { pattern: '/surgery-sales', key: 'surgerySales' },
  { pattern: '/surgery-catalog', key: 'surgeryCatalog' },
  { pattern: '/surgery-calendar', key: 'surgeryCalendar' },
  { pattern: '/recall', key: 'recall' },
  { pattern: '/cosign', key: 'cosign' },
  { pattern: '/leads', key: 'leads' },
  { pattern: '/reports', key: 'reports' },
  { pattern: '/approvals', key: 'approvals' },
  { pattern: '/prosedurler', key: 'procedures' },
  { pattern: '/billing/:id', key: 'invoiceDetail' },
  { pattern: '/billing', key: 'billing' },
  { pattern: '/inventory/iol/manage', key: 'iolManage' },
  { pattern: '/inventory/iol', key: 'iolInventory' },
  { pattern: '/inventory/forecast', key: 'stockForecast' },
  { pattern: '/inventory/consumables', key: 'consumables' },
  { pattern: '/inventory/stock-movements', key: 'stockMovements' },
  { pattern: '/suppliers', key: 'suppliers' },
  { pattern: '/purchase-orders', key: 'purchaseOrders' },
  { pattern: '/pharmacy/pos', key: 'pharmacyPos' },
  { pattern: '/pharmacy/prescriptions', key: 'pharmacyPrescriptions' },
  { pattern: '/pharmacy/stock', key: 'pharmacyStock' },
  { pattern: '/pharmacy/purchase', key: 'pharmacyPurchase' },
  { pattern: '/pharmacy/suppliers', key: 'pharmacySuppliers' },
  { pattern: '/pharmacy/returns', key: 'pharmacyReturns' },
  { pattern: '/pharmacy/cash', key: 'pharmacyCash' },
  { pattern: '/pharmacy/reports', key: 'pharmacyReports' },
  { pattern: '/admin/users/:id', key: 'userDetail' },
  { pattern: '/admin/users', key: 'users' },
  { pattern: '/admin/hakedis', key: 'commission' },
  { pattern: '/admin/fraud', key: 'fraud' },
  { pattern: '/admin/messaging', key: 'messaging' },
  { pattern: '/admin/permissions', key: 'permissions' },
  { pattern: '/admin/consent-templates', key: 'consentTemplates' },
  { pattern: '/admin/cash-register', key: 'cashRegister' },
  { pattern: '/admin/service-catalog', key: 'serviceCatalog' },
  { pattern: '/admin/analiz', key: 'adminAnalysis' },
  { pattern: '/admin/ayarlar', key: 'adminSettings' },
  { pattern: '/admin/otomasyonlar/hasta-asistani', key: 'automations' },
  { pattern: '/admin/otomasyonlar', key: 'automations' },
  { pattern: '/admin/clinic-settings', key: 'clinicSettings' },
  { pattern: '/reception/preferences', key: 'receptionPrefs' },
  { pattern: '/overview', key: 'overview' },
  { pattern: '/', key: 'overview' },
];

// #guide-coverage — resolver'ın üretebileceği tüm screenKey'ler. Kapsam testi
// her birinin (guide.default'ta ya da bir varyantta) içeriği olmasını zorlar →
// yeni rota-eşlemesi eklenip içerik yazılmazsa CI kırmızı (comingSoon önlenir).
export const GUIDE_SCREEN_KEYS: readonly string[] = [...new Set(ROUTE_GUIDE_MAP.map((r) => r.key))];

/** pathname → screenKey (dinamik rotalar dahil); eşleşme yoksa null. */
export function resolveGuideScreenKey(pathname: string): string | null {
  for (const { pattern, key } of ROUTE_GUIDE_MAP) {
    if (matchPath({ path: pattern, end: true }, pathname)) return key;
  }
  return null;
}

// SidebarVariant → guide varyant anahtarı. 'full' (çoklu-rol) DEFAULT içeriğe
// düşer (ayrı metin yazılmaz — #1072 bağlayıcı kural).
const VARIANT_GUIDE_KEY: Record<SidebarVariant, string> = {
  doctor: 'doctor',
  reception: 'reception',
  nurse: 'nurse',
  'measurement-nurse': 'measurement',
  sales: 'sales',
  admin: 'admin',
  pharmacy: 'pharmacy',
  finans: 'finans',
  stok: 'stok',
  full: 'default',
};

export function guideVariantKey(variant: SidebarVariant): string {
  return VARIANT_GUIDE_KEY[variant];
}
