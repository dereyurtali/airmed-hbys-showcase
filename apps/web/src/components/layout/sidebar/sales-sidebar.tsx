import { CalendarDays, Layers, Receipt, Tag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { BrandedSidebar, type BrandedGroup, type SidebarProps } from './shared';

/**
 * Sadece-ameliyat satış — v0.4.1 (#687) mockup gruplu menü: Satış Akışı (Satış
 * Hattı canlı devir kuyruğu) · Planlama (Takvim + Katalog) · Tahsilat (Faturalama).
 * Mockup "Post-op Takip" grubu eklenmedi: ameliyat_satis action:recall.list'e sahip
 * değil → ölü link olurdu (erişim kararı ayrı).
 */
export function SalesSidebar({ onNavigate }: SidebarProps) {
  const { t } = useTranslation('common');
  const me = trpc.auth.me.useQuery(undefined, { staleTime: 300_000 });
  const handoffQueue = trpc.surgery.handoffQueue.useQuery(undefined, { refetchInterval: 30_000 });
  const queueCount = handoffQueue.data?.length ?? 0;

  const groups: BrandedGroup[] = [
    {
      titleKey: 'nav.group.salesFlow',
      items: [
        {
          labelKey: 'nav.salesPipeline',
          to: '/surgery-sales',
          icon: Tag,
          badge: queueCount || undefined,
          badgeTone: 'live',
        },
      ],
    },
    {
      titleKey: 'nav.group.planning',
      items: [
        { labelKey: 'nav.surgeryCalendar', to: '/surgery-calendar', icon: CalendarDays },
        { labelKey: 'nav.surgeryCatalog', to: '/surgery-catalog', icon: Layers },
      ],
    },
    {
      // #371 — ameliyat_satis muayene faturası kesip tahsilat alabilir (page:billing, S12a).
      titleKey: 'nav.group.collection',
      items: [{ labelKey: 'nav.billing', to: '/billing', icon: Receipt }],
    },
  ];

  return (
    <BrandedSidebar
      roleLabel={t('roles.ameliyatSatis')}
      groups={groups}
      userName={me.data?.name ?? ''}
      userSubtitle={t('roles.ameliyatSatis')}
      onNavigate={onNavigate}
    />
  );
}
