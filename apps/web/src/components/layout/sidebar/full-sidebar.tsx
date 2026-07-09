import {
  ArrowRightLeft,
  Banknote,
  BarChart3,
  CalendarDays,
  CircleDollarSign,
  ClipboardList,
  FileSignature,
  FlaskConical,
  ListChecks,
  MessageSquare,
  Package,
  PhoneCall,
  Receipt,
  Scissors,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  Syringe,
  TrendingUp,
  UserCog,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { hasPermission } from '@airmed/contracts';
import { trpc } from '../../../lib/trpc';
import { useAuth } from '../../../providers/AuthProvider';
import { BrandedSidebar, type BrandedGroup, type NavGroup, type SidebarProps } from './shared';

// SİS-Y4 — Tam (yönetici/asistan + çoklu-rol) sidebar 4 anlam grubuna bölünmüş:
// Klinik akış · Stok · Finans · Yönetim. Her grup yalnız izinli öğesi varsa
// başlığıyla render olur (boş grup gizlenir).
//
// v0.4 (#541): yeni rollerin (finans, stok_satinalma, eczane) markalı sidebar'ları
// İP-9/10/23'te ayrı dosyalarda eklenir; ortak yetki anahtarları #542'de bu
// gruplara işlenebilir. Bu dosya yalnız "full" varyantı (çoklu-rol) besler.
const NAV_GROUPS: NavGroup[] = [
  {
    titleKey: 'nav.group.clinic',
    items: [
      // Jenerik "Gösterge Paneli" (/dashboard) #908'de emekliye ayrıldı; çoklu-rol
      // açılışı artık /overview (pinned-top, BrandedSidebar) → en öncelikli rol
      // Genel Bakış'ı. Ayrı menü öğesine gerek kalmadı.
      {
        labelKey: 'nav.patients',
        to: '/patients',
        icon: Users,
        requiredPermission: 'page:patients',
      },
      {
        labelKey: 'nav.doctors',
        to: '/doctors',
        icon: Stethoscope,
        requiredPermission: 'page:doctors',
      },
      {
        labelKey: 'nav.schedule',
        to: '/schedule',
        icon: CalendarDays,
        requiredPermission: 'page:schedule',
      },
      {
        labelKey: 'nav.worklist',
        to: '/worklist',
        icon: ListChecks,
        requiredPermission: 'page:worklist',
      },
      {
        labelKey: 'nav.measurementQueue',
        to: '/measurement-queue',
        icon: FlaskConical,
        requiredPermission: 'page:measurementQueue',
      },
      {
        labelKey: 'nav.surgerySales',
        to: '/surgery-sales',
        icon: Scissors,
        requiredPermission: 'page:surgerySales',
      },
      {
        // S15-PR9 — Ameliyat Günü Merkezi (bugünkü ameliyat pipeline)
        labelKey: 'nav.surgeryDay',
        to: '/surgery-day',
        icon: ShieldCheck,
        requiredPermission: 'page:surgeryDay',
      },
      {
        labelKey: 'nav.receptionQueue',
        to: '/reception-queue',
        icon: ArrowRightLeft,
        requiredPermission: 'page:receptionQueue',
      },
      {
        labelKey: 'nav.procedures',
        to: '/prosedurler',
        icon: Syringe,
        requiredPermission: 'page:procedures',
      },
      // S15-PR20 — Post-op recall yönetimi
      {
        labelKey: 'nav.recall',
        to: '/recall',
        icon: PhoneCall,
        requiredPermission: 'action:recall.list',
      },
      // S15-PR23 — Doktor co-sign onayları
      {
        labelKey: 'nav.cosign',
        to: '/cosign',
        icon: ShieldCheck,
        requiredPermission: 'action:audit.cosign',
      },
      {
        labelKey: 'nav.consentTemplates',
        to: '/admin/consent-templates',
        icon: FileSignature,
        requiredPermission: 'page:consentTemplates',
      },
      { labelKey: 'nav.leads', to: '/leads', icon: TrendingUp, requiredPermission: 'page:leads' },
    ],
  },
  {
    titleKey: 'nav.group.stock',
    items: [
      {
        labelKey: 'nav.iolInventory',
        to: '/inventory/iol',
        icon: Package,
        requiredPermission: 'page:iolInventory',
      },
      {
        labelKey: 'nav.stockForecast',
        to: '/inventory/forecast',
        icon: BarChart3,
        requiredPermission: 'page:iolInventory',
      },
      {
        labelKey: 'nav.suppliers',
        to: '/suppliers',
        icon: Package,
        requiredPermission: 'page:suppliers',
      },
      {
        labelKey: 'nav.purchaseOrders',
        to: '/purchase-orders',
        icon: Package,
        requiredPermission: 'page:purchaseOrders',
      },
    ],
  },
  {
    titleKey: 'nav.group.finance',
    items: [
      // S11d — Billing (tahsilat) modülü
      {
        labelKey: 'nav.billing',
        to: '/billing',
        icon: Receipt,
        requiredPermission: 'page:billing',
      },
      // PO onayları için ayrı öğe kaldırıldı (#904): tek kanonik giriş /approvals
      // (sekmeli merkez; PO sekmesi action:po.approve izniyle görünür).
      {
        labelKey: 'nav.cashRegister',
        to: '/admin/cash-register',
        icon: Banknote,
        requiredPermission: 'page:cashRegister',
      },
      {
        labelKey: 'nav.serviceCatalog',
        to: '/admin/service-catalog',
        icon: ClipboardList,
        requiredPermission: 'page:serviceCatalog',
      },
      {
        labelKey: 'nav.commission',
        to: '/admin/hakedis',
        icon: CircleDollarSign,
        requiredPermission: 'page:commission',
      },
      // S14 — v0.1 port: indirim onay sayfası
      {
        labelKey: 'nav.approvals',
        to: '/approvals',
        icon: ShieldAlert,
        requiredPermission: 'page:approvals',
      },
      {
        labelKey: 'nav.fraud',
        to: '/admin/fraud',
        icon: ShieldAlert,
        requiredPermission: 'page:fraud',
      },
    ],
  },
  {
    // v0.4 — Eczane perakende grubu (#553-558)
    titleKey: 'nav.group.pharmacy',
    items: [
      {
        labelKey: 'nav.pharmacyPos',
        to: '/pharmacy/pos',
        icon: Receipt,
        requiredPermission: 'page:pharmacyPos',
      },
      {
        labelKey: 'nav.pharmacyPrescriptions',
        to: '/pharmacy/prescriptions',
        icon: ListChecks,
        requiredPermission: 'page:pharmacyPrescriptions',
      },
      {
        labelKey: 'nav.pharmacyStock',
        to: '/pharmacy/stock',
        icon: Package,
        requiredPermission: 'page:pharmacyStock',
      },
      {
        labelKey: 'nav.pharmacyCash',
        to: '/pharmacy/cash',
        icon: Banknote,
        requiredPermission: 'page:pharmacyCash',
      },
      {
        labelKey: 'nav.pharmacyReturns',
        to: '/pharmacy/returns',
        icon: Receipt,
        requiredPermission: 'page:pharmacyReturns',
      },
      {
        labelKey: 'nav.pharmacyReports',
        to: '/pharmacy/reports',
        icon: BarChart3,
        requiredPermission: 'page:pharmacyReports',
      },
    ],
  },
  {
    titleKey: 'nav.group.management',
    items: [
      {
        labelKey: 'nav.reports',
        to: '/reports',
        icon: BarChart3,
        requiredPermission: 'page:reports',
      },
      {
        labelKey: 'nav.messaging',
        to: '/admin/messaging',
        icon: MessageSquare,
        requiredPermission: 'page:messaging',
      },
      // S10e 7 — Yönetici-only admin sayfaları (eskiden gizliydi)
      {
        labelKey: 'nav.users',
        to: '/admin/users',
        icon: UserCog,
        requiredPermission: 'page:users',
      },
      // S14 — v0.1 port: rol × ekran erişim matrisi yönetimi
      {
        labelKey: 'nav.permissions',
        to: '/admin/permissions',
        icon: ShieldCheck,
        requiredPermission: 'page:permissions',
      },
    ],
  },
];

/**
 * Tam (çoklu-rol / yönetici_asistani) sidebar — anlam gruplarıyla. Markalı sade
 * varyantlardan farkı: tüm izinli ekranlar gruplu liste halinde görünür.
 */
export function FullSidebar({ onNavigate }: SidebarProps) {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const me = trpc.auth.me.useQuery(undefined, { staleTime: 300_000 });
  const userRoles = user?.roles ?? [];

  // v0.4.1 (#686) — markalı gradient omurga (BrandedSidebar). Çoklu-rol/asistan:
  // her grubu izinli öğeleriyle filtrele (boş grup atlanır), gruplu menü olarak ver.
  const groups: BrandedGroup[] = NAV_GROUPS.map((g) => ({
    titleKey: g.titleKey,
    items: g.items
      .filter((item) => hasPermission(userRoles, item.requiredPermission))
      .map((item) => ({ labelKey: item.labelKey, to: item.to, icon: item.icon })),
  })).filter((g) => g.items.length > 0);

  return (
    <BrandedSidebar
      roleLabel={t('roles.multiRole', { defaultValue: 'Çoklu rol' })}
      groups={groups}
      userName={me.data?.name ?? ''}
      onNavigate={onNavigate}
    />
  );
}
