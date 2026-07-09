import {
  BarChart3,
  Banknote,
  Bot,
  CalendarDays,
  FileSignature,
  ListChecks,
  Package,
  Receipt,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { BrandedSidebar, type BrandedGroup, type SidebarProps } from './shared';

/**
 * Sadece-yönetici: "Yönetim" komuta menüsü — v0.4.1 (#685) mockup gruplu yapı:
 * Operasyon · Finans · Onay&Denetim · Stok · Analiz&İletişim · Ayarlar. Rozetler
 * gerçek veriden (bekleyen onay / iade / kritik stok). Yönetici Asistanı solo →
 * 'full' variant (#686), bu dosya yalnız solo-yönetici.
 */
export function AdminSidebar({ onNavigate }: SidebarProps) {
  const { t } = useTranslation('common');
  const me = trpc.auth.me.useQuery(undefined, { staleTime: 300_000 });
  // Rozetler Genel Bakış sayfasıyla AYNI sorgudan (react-query dedupe → tek
  // istek). Onay Talepleri = bekleyen indirim sayısı; Stok & Malzeme = kritik
  // (düşük) stok kalem sayısı (IOL modeli + sarf malzeme).
  const overview = trpc.dashboard.adminOverview.useQuery(undefined, { refetchInterval: 30_000 });
  const approvalCount = overview.data?.pendingApprovalCount ?? 0;
  const stockCount = overview.data?.lowStock.length ?? 0;
  // #401 — Bekleyen iade onayları rozeti (yönetici approves; eskiden Kasa/iade
  // menüden erişilemiyordu → onay kayıp uçtaydı).
  const pendingRefunds = trpc.billing.listPendingRefunds.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const refundCount = pendingRefunds.data?.length ?? 0;

  const groups: BrandedGroup[] = [
    {
      titleKey: 'nav.group.operations',
      items: [
        // "Genel Bakış" sidebar'da pinned-top olarak BrandedSidebar tarafından
        // tek noktadan eklenir (#721 G2 → /overview). Burada ayrıca listelemek
        // solo-yönetici menüsünde çift girişe yol açıyordu; kaldırıldı (#726).
        { labelKey: 'nav.examQueue', to: '/worklist', icon: ListChecks },
        { labelKey: 'nav.schedule', to: '/schedule', icon: CalendarDays },
        { labelKey: 'nav.surgeryDay', to: '/surgery-day', icon: ShieldCheck },
      ],
    },
    {
      titleKey: 'nav.group.finance',
      items: [
        {
          labelKey: 'nav.billing',
          to: '/billing',
          icon: Receipt,
          badge: refundCount || undefined,
          badgeTone: 'amber',
        },
        { labelKey: 'nav.cashRegister', to: '/admin/cash-register', icon: Banknote },
        // Hakediş sidebar'dan kaldırıldı (#903): Analiz hub'ında (/admin/analiz)
        // kart olarak var → çift-giriş önlenir.
      ],
    },
    {
      titleKey: 'nav.group.approvalAudit',
      items: [
        {
          labelKey: 'nav.approvalRequests',
          to: '/approvals',
          icon: ShieldCheck,
          badge: approvalCount || undefined,
          badgeTone: 'amber',
        },
        { labelKey: 'nav.cosign', to: '/cosign', icon: FileSignature },
        // Fraud sidebar'dan kaldırıldı (#903): Analiz hub kartından erişilir.
      ],
    },
    {
      titleKey: 'nav.group.stock',
      items: [
        {
          labelKey: 'nav.stockMaterials',
          to: '/inventory/iol',
          icon: Package,
          badge: stockCount || undefined,
          badgeTone: 'amber',
        },
      ],
    },
    {
      titleKey: 'nav.group.analysisComms',
      items: [
        // Hakediş/Fraud/Mesajlaşma bu hub'ın kartları (#903 dedup); sidebar'da
        // yalnız hub girişi durur → analitik/denetim/iletişim ekranları tek yerde.
        { labelKey: 'nav.analysis', to: '/admin/analiz', icon: BarChart3 },
        // EPIC #1018 — AI hasta asistanı izleme/yönetim (#1022)
        { labelKey: 'nav.automations', to: '/admin/otomasyonlar', icon: Bot },
      ],
    },
    {
      titleKey: 'nav.group.settings',
      items: [{ labelKey: 'nav.settings', to: '/admin/ayarlar', icon: Settings }],
    },
  ];

  return (
    <BrandedSidebar
      roleLabel={t('roles.management')}
      groups={groups}
      userName={me.data?.name ?? ''}
      userSubtitle={t('roles.clinicAdmin')}
      onNavigate={onNavigate}
    />
  );
}
