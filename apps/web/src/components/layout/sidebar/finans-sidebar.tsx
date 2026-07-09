import {
  Banknote,
  BarChart3,
  CircleDollarSign,
  FileSignature,
  Receipt,
  ShieldAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { BrandedSidebar, type BrandedGroup, type SidebarProps } from './shared';

/**
 * v0.4 İP-9 (#545) / v0.4.1 (#688) — Finans Yetkilisi: para işlerinin tek-elden
 * mockup gruplu menüsü. Tahsilat · Onaylar (İndirim/İade + PO) · Ödemeler (Hakediş)
 * · Denetim (Fraud) · Analiz (Raporlar). Hasta/klinik ekranları YOK. Landing /billing.
 *
 * Görev ayrılığı: PO onayında oluşturan≠onaylayan (purchase-order.service guard).
 */
export function FinansSidebar({ onNavigate }: SidebarProps) {
  const { t } = useTranslation('common');
  const me = trpc.auth.me.useQuery(undefined, { staleTime: 300_000 });
  // v0.4.1 #694 — bekleyen indirim/iade onayı canlı sayacı (gerçek veri).
  const approvalCount = trpc.approval.countPending.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const groups: BrandedGroup[] = [
    {
      titleKey: 'nav.group.collection',
      items: [
        { labelKey: 'nav.billing', to: '/billing', icon: Receipt },
        { labelKey: 'nav.cashRegister', to: '/admin/cash-register', icon: Banknote },
      ],
    },
    {
      titleKey: 'nav.group.approvals',
      items: [
        {
          labelKey: 'nav.approvals',
          to: '/approvals',
          icon: FileSignature,
          badge: approvalCount.data?.count || undefined,
          badgeTone: 'amber',
        },
        // PO onayları için ayrı öğe kaldırıldı (#904): tek kanonik giriş
        // /approvals (sekmeli merkez, PO sekmesi action:po.approve ile görünür).
      ],
    },
    {
      titleKey: 'nav.group.payments',
      items: [{ labelKey: 'nav.commission', to: '/admin/hakedis', icon: CircleDollarSign }],
    },
    {
      titleKey: 'nav.group.audit',
      items: [{ labelKey: 'nav.fraud', to: '/admin/fraud', icon: ShieldAlert }],
    },
    {
      titleKey: 'nav.group.reports',
      items: [{ labelKey: 'nav.reports', to: '/reports', icon: BarChart3 }],
    },
  ];

  return (
    <BrandedSidebar
      roleLabel={t('roles.finans')}
      groups={groups}
      userName={me.data?.name ?? ''}
      userSubtitle={t('roles.finans')}
      onNavigate={onNavigate}
    />
  );
}
