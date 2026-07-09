import { ROLES } from '@airmed/contracts';

/**
 * Aktif sidebar varyantı. Aynı detection logic Sidebar.tsx ve BackBar.tsx
 * tarafından paylaşılır — sadece-X kullanıcının sade sidebar'ı, "tam" sidebar
 * destinasyonlarını TOP-LEVEL kabul etmemeli; o rotalar hub'tan (Ayarlar/Analiz)
 * açıldığında BackBar görünmeli.
 */
export type SidebarVariant =
  | 'doctor'
  | 'reception'
  | 'nurse'
  | 'measurement-nurse'
  | 'sales'
  | 'admin'
  | 'pharmacy'
  | 'finans'
  | 'stok'
  | 'full';

const NON_DOCTOR_ROLES: readonly string[] = [
  ROLES.YONETICI,
  ROLES.YONETICI_ASISTANI,
  ROLES.RESEPSIYON,
  ROLES.HEMSIRE,
  ROLES.AMELIYAT_SATIS,
  ROLES.OLCUM_HEMSIRESI,
];

const NON_RECEPTION_ROLES: readonly string[] = [
  ROLES.YONETICI,
  ROLES.YONETICI_ASISTANI,
  ROLES.DOKTOR,
  ROLES.HEMSIRE,
  ROLES.AMELIYAT_SATIS,
  ROLES.OLCUM_HEMSIRESI,
];

const NON_NURSE_ROLES: readonly string[] = [
  ROLES.YONETICI,
  ROLES.YONETICI_ASISTANI,
  ROLES.DOKTOR,
  ROLES.RESEPSIYON,
  ROLES.AMELIYAT_SATIS,
  ROLES.OLCUM_HEMSIRESI,
];

const NON_MEASUREMENT_NURSE_ROLES: readonly string[] = [
  ROLES.YONETICI,
  ROLES.YONETICI_ASISTANI,
  ROLES.DOKTOR,
  ROLES.RESEPSIYON,
  ROLES.HEMSIRE,
  ROLES.AMELIYAT_SATIS,
];

const NON_SALES_ROLES: readonly string[] = [
  ROLES.YONETICI,
  ROLES.YONETICI_ASISTANI,
  ROLES.DOKTOR,
  ROLES.RESEPSIYON,
  ROLES.HEMSIRE,
  ROLES.OLCUM_HEMSIRESI,
];

const NON_ADMIN_ROLES: readonly string[] = [
  ROLES.YONETICI_ASISTANI,
  ROLES.DOKTOR,
  ROLES.RESEPSIYON,
  ROLES.HEMSIRE,
  ROLES.AMELIYAT_SATIS,
  ROLES.OLCUM_HEMSIRESI,
];

// v0.4 #559 — sadece-eczane personeli → kilitli eczane sidebar'ı.
const NON_PHARMACY_ROLES: readonly string[] = [
  ROLES.YONETICI,
  ROLES.YONETICI_ASISTANI,
  ROLES.DOKTOR,
  ROLES.RESEPSIYON,
  ROLES.HEMSIRE,
  ROLES.AMELIYAT_SATIS,
  ROLES.OLCUM_HEMSIRESI,
];

// v0.4 İP-9 (#545) — sadece-finans → markalı finans sidebar'ı (Tahsilat & Onay).
// Başka bir rol de varsa tam sidebar'a düşer. Görev ayrılığı gereği finans +
// stok_satinalma aynı kişi olmamalı; ikisi birden taşınırsa 'full'.
const NON_FINANS_ROLES: readonly string[] = [
  ROLES.YONETICI,
  ROLES.YONETICI_ASISTANI,
  ROLES.DOKTOR,
  ROLES.RESEPSIYON,
  ROLES.HEMSIRE,
  ROLES.AMELIYAT_SATIS,
  ROLES.OLCUM_HEMSIRESI,
  ROLES.ECZANE,
  ROLES.STOK_SATINALMA,
];

// v0.4 İP-10 (#546) — sadece-stok&satınalma → modül-kısıtlı depo sidebar'ı.
// Başka rol de varsa tam sidebar. Görev ayrılığı: stok + finans aynı kişi olmamalı.
const NON_STOK_ROLES: readonly string[] = [
  ROLES.YONETICI,
  ROLES.YONETICI_ASISTANI,
  ROLES.DOKTOR,
  ROLES.RESEPSIYON,
  ROLES.HEMSIRE,
  ROLES.AMELIYAT_SATIS,
  ROLES.OLCUM_HEMSIRESI,
  ROLES.ECZANE,
  ROLES.FINANS,
];

export function getSidebarVariant(roles: readonly string[], mode?: string): SidebarVariant {
  // v0.4 (#541) — Çalışma modu rolden ÖNCE gelir. Migrasyon sonrası bir kullanıcı
  // hem `hemsire` hem `olcum_hemsiresi` rolü taşıyabilir (çift-yol); o yüzden
  // sade sidebar seçiminde mod tek güvenilir sinyaldir.
  //  - olcum (kilitli kiosk) → ölçüm istasyonu sidebar'ı (rol kombinasyonundan bağımsız)
  //  - genel/asistan → hemşire sidebar'ı (Genel↔Asistan ayrımı #544'te derinleşir)
  if (mode === 'olcum') return 'measurement-nurse';
  if (mode === 'genel' || mode === 'asistan') return 'nurse';

  const has = (r: string) => roles.includes(r);
  const anyOf = (forbidden: readonly string[]) => roles.some((r) => forbidden.includes(r));

  if (has(ROLES.DOKTOR) && !anyOf(NON_DOCTOR_ROLES)) return 'doctor';
  if (has(ROLES.RESEPSIYON) && !anyOf(NON_RECEPTION_ROLES)) return 'reception';
  if (has(ROLES.HEMSIRE) && !anyOf(NON_NURSE_ROLES)) return 'nurse';
  if (has(ROLES.OLCUM_HEMSIRESI) && !anyOf(NON_MEASUREMENT_NURSE_ROLES)) return 'measurement-nurse';
  if (has(ROLES.AMELIYAT_SATIS) && !anyOf(NON_SALES_ROLES)) return 'sales';
  if (has(ROLES.YONETICI) && !anyOf(NON_ADMIN_ROLES)) return 'admin';
  if (has(ROLES.ECZANE) && !anyOf(NON_PHARMACY_ROLES)) return 'pharmacy';
  if (has(ROLES.FINANS) && !anyOf(NON_FINANS_ROLES)) return 'finans';
  if (has(ROLES.STOK_SATINALMA) && !anyOf(NON_STOK_ROLES)) return 'stok';
  return 'full';
}

/**
 * Her varyant için TOP-LEVEL rotalar — sidebar'dan tek tıkla ulaşılan
 * destinasyonlar. Bu listede OLMAYAN tüm rotalar "alt ekran" sayılır ve
 * BackBar görünür.
 *
 * 'full': yonetici_asistani + diğer çoklu-rol kombinasyonları (tam sidebar
 * görür) — tüm sidebar NAV destinasyonları top-level.
 * 'admin': sadece-yönetici (markalı sade sidebar) — sadece 6 öğe top-level;
 * Kullanıcılar / Yetkiler / Hakediş / Fraud / Messaging / vb. Ayarlar
 * hub'undan açıldığı için BackBar görünmeli.
 */
// '/overview' her varyantta sidebar'da pinned-top (v0.4.2 #721) → BackBar gösterme.
const ALWAYS_TOP_LEVEL = ['/overview', '/change-password', '/forbidden'] as const;

// #1031 KURAL (Ali): sol menüden DOĞRUDAN ulaşılan hiçbir ekranda geri butonu
// olmaz; yalnız oradan açılan alt ekranlarda olur — TÜM roller için. Bu
// listeler ilgili <variant>-sidebar.tsx dosyasındaki `to:` rotalarının birebir
// kopyasıdır; sapma sidebar-top-level.sync.test.ts ile KIRMIZI yapılır.
// Sidebar'a link eklerken buraya da ekle (test hatırlatır).
export const TOP_LEVEL_BY_VARIANT: Record<SidebarVariant, readonly string[]> = {
  full: [
    '/patients',
    '/doctors',
    '/schedule',
    '/worklist',
    '/measurement-queue',
    '/surgery-sales',
    '/surgery-day',
    '/reception-queue',
    '/leads',
    '/inventory/iol',
    '/inventory/forecast',
    '/prosedurler',
    '/reports',
    '/approvals',
    '/recall',
    '/cosign',
    '/billing',
    '/suppliers',
    '/purchase-orders',
    '/pharmacy/pos',
    '/pharmacy/prescriptions',
    '/pharmacy/stock',
    '/pharmacy/returns',
    '/pharmacy/cash',
    '/pharmacy/reports',
    '/admin/hakedis',
    '/admin/fraud',
    '/admin/messaging',
    '/admin/users',
    '/admin/permissions',
    '/admin/consent-templates',
    '/admin/cash-register',
    '/admin/service-catalog',
  ],
  admin: [
    '/worklist',
    '/schedule',
    '/surgery-day',
    '/billing',
    '/admin/cash-register',
    '/approvals',
    '/cosign',
    '/inventory/iol',
    '/admin/analiz',
    '/admin/otomasyonlar',
    '/admin/ayarlar',
  ],
  doctor: ['/worklist', '/schedule', '/patients', '/surgery-day', '/cosign'],
  reception: ['/reception-queue', '/schedule', '/patients', '/billing', '/recall'],
  nurse: ['/worklist', '/measurement-queue', '/patients', '/schedule', '/surgery-day', '/recall'],
  'measurement-nurse': ['/measurement-queue', '/measurement-completed'],
  sales: ['/surgery-sales', '/surgery-catalog', '/surgery-calendar', '/billing'],
  pharmacy: [
    '/pharmacy/pos',
    '/pharmacy/prescriptions',
    '/pharmacy/stock',
    '/pharmacy/purchase',
    '/pharmacy/suppliers',
    '/pharmacy/returns',
    '/pharmacy/cash',
    '/pharmacy/reports',
  ],
  finans: [
    '/billing',
    '/admin/cash-register',
    '/approvals',
    '/admin/hakedis',
    '/admin/fraud',
    '/reports',
  ],
  stok: [
    '/inventory/iol',
    '/inventory/iol/manage',
    '/inventory/consumables',
    '/inventory/stock-movements',
    '/suppliers',
    '/purchase-orders',
    '/inventory/forecast',
  ],
};

export function isTopLevelRoute(pathname: string, variant: SidebarVariant): boolean {
  if ((ALWAYS_TOP_LEVEL as readonly string[]).includes(pathname)) return true;
  return TOP_LEVEL_BY_VARIANT[variant].includes(pathname);
}
