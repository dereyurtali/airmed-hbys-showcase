import {
  ArrowRightLeft,
  BarChart3,
  Boxes,
  ClipboardList,
  Layers,
  Package,
  Truck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { BrandedSidebar, type BrandedGroup, type SidebarProps } from './shared';

/**
 * v0.4 İP-10 (#546) / v0.4.1 (#689) — Stok & Satın Alma: modül-kısıtlı depo +
 * tedarik mockup gruplu menüsü. Envanter (IOL + Yönetim + Sarf) · Tedarik & Sipariş
 * (Tedarikçiler + Satın Alma Siparişleri) · Planlama (Stok Tahmini). Hasta + finans
 * ekranları YOK. "Mal Kabul / Stok Hareketleri" item'ı yeni ekranla (#691) eklenir.
 *
 * Görev ayrılığı: stok PO oluşturur/gönderir/teslim alır ama ONAYLAMAZ (onay
 * action:po.approve yalnız yönetici+finans; bu menüde yer almaz).
 */
export function StokSidebar({ onNavigate }: SidebarProps) {
  const { t } = useTranslation('common');
  const me = trpc.auth.me.useQuery(undefined, { staleTime: 300_000 });

  const groups: BrandedGroup[] = [
    {
      // v0.4.1 #691 — Mal Kabul / Stok Hareketleri (klinik stok hareket trail'i).
      titleKey: 'nav.group.receiving',
      items: [
        {
          labelKey: 'nav.stockMovements',
          to: '/inventory/stock-movements',
          icon: ArrowRightLeft,
        },
      ],
    },
    {
      titleKey: 'nav.group.inventory',
      items: [
        { labelKey: 'nav.iolInventory', to: '/inventory/iol', icon: Package },
        { labelKey: 'nav.iolManage', to: '/inventory/iol/manage', icon: Boxes },
        { labelKey: 'nav.consumables', to: '/inventory/consumables', icon: Layers },
      ],
    },
    {
      titleKey: 'nav.group.procurement',
      items: [
        { labelKey: 'nav.suppliers', to: '/suppliers', icon: Truck },
        { labelKey: 'nav.purchaseOrders', to: '/purchase-orders', icon: ClipboardList },
      ],
    },
    {
      titleKey: 'nav.group.planning',
      items: [{ labelKey: 'nav.stockForecast', to: '/inventory/forecast', icon: BarChart3 }],
    },
  ];

  return (
    <BrandedSidebar
      roleLabel={t('roles.stokSatinalma')}
      groups={groups}
      userName={me.data?.name ?? ''}
      userSubtitle={t('roles.stokSatinalma')}
      onNavigate={onNavigate}
    />
  );
}
