import {
  Banknote,
  BarChart3,
  ClipboardList,
  Package,
  PackagePlus,
  Receipt,
  Truck,
  Undo2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { BrandedSidebar, type BrandedGroup, type SidebarProps } from './shared';

/**
 * v0.4 #559 / v0.4.1 (#690) — Sadece-eczane personeli mockup gruplu sidebar:
 * Satış (POS + Reçete + İade) · Stok & Tedarik (Eczane Stoğu) · Kasa & Raporlama
 * (Kasa + Raporlar). Yalnız eczane ekranları; landing /pharmacy/pos. "Mal Kabul/
 * Sipariş" (#692) + "Tedarikçiler" (#693) yeni ekranlarıyla eklenir.
 */
export function PharmacySidebar({ onNavigate }: SidebarProps) {
  const { t } = useTranslation('common');
  const me = trpc.auth.me.useQuery(undefined, { staleTime: 300_000 });
  // v0.4.1 #694 — bekleyen reçete kuyruğu canlı sayacı (gerçek veri).
  const rxQueue = trpc.pharmacyRetail.dispensablePrescriptions.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const groups: BrandedGroup[] = [
    {
      titleKey: 'nav.group.sales',
      items: [
        { labelKey: 'nav.pharmacyPos', to: '/pharmacy/pos', icon: Receipt },
        {
          labelKey: 'nav.pharmacyPrescriptions',
          to: '/pharmacy/prescriptions',
          icon: ClipboardList,
          badge: rxQueue.data?.length || undefined,
          badgeTone: 'amber',
        },
        { labelKey: 'nav.pharmacyReturns', to: '/pharmacy/returns', icon: Undo2 },
      ],
    },
    {
      titleKey: 'nav.group.stockSupply',
      items: [
        { labelKey: 'nav.pharmacyStock', to: '/pharmacy/stock', icon: Package },
        // v0.4.1 #692 — Mal Kabul / Stok Hareketleri (eczane stok trail'i).
        { labelKey: 'nav.pharmacyPurchase', to: '/pharmacy/purchase', icon: PackagePlus },
        // v0.4.1 #693 — Eczane Tedarikçileri (partilerden türetilmiş).
        { labelKey: 'nav.pharmacySuppliers', to: '/pharmacy/suppliers', icon: Truck },
      ],
    },
    {
      titleKey: 'nav.group.cashReporting',
      items: [
        { labelKey: 'nav.pharmacyCash', to: '/pharmacy/cash', icon: Banknote },
        { labelKey: 'nav.pharmacyReports', to: '/pharmacy/reports', icon: BarChart3 },
      ],
    },
  ];

  return (
    <BrandedSidebar
      roleLabel={t('roles.eczane')}
      groups={groups}
      userName={me.data?.name ?? ''}
      userSubtitle={t('roles.eczane')}
      onNavigate={onNavigate}
    />
  );
}
