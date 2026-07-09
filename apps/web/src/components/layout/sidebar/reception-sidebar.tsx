import { CalendarDays, LayoutGrid, PhoneCall, Receipt, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { BrandedSidebar, type BrandedGroup, type SidebarProps } from './shared';

/**
 * Sadece-resepsiyon — v0.4.1 (#687) mockup gruplu menü: Ön Büro (Karşılama&Ödeme
 * canlı + Randevular) · Hasta · Tahsilat · Geri-Çağırma. Özet/ana-sayfa = pinned-top
 * "Genel Bakış" (/overview → ReceptionOverview, #721); jenerik "Gösterge paneli"
 * (/dashboard) menüden kaldırıldı (#778, çift-özet tekrarı).
 */
export function ReceptionSidebar({ onNavigate }: SidebarProps) {
  const { t } = useTranslation('common');
  const me = trpc.auth.me.useQuery(undefined, { staleTime: 300_000 });
  const recQueue = trpc.encounter.receptionQueue.useQuery(undefined, { refetchInterval: 30_000 });
  const todayQuery = trpc.metric.today.useQuery();

  const groups: BrandedGroup[] = [
    {
      titleKey: 'nav.group.frontOffice',
      items: [
        {
          labelKey: 'nav.receptionWelcome',
          to: '/reception-queue',
          icon: LayoutGrid,
          badge: recQueue.data?.length || undefined,
          badgeTone: 'live',
        },
        {
          labelKey: 'nav.appointments',
          to: '/schedule',
          icon: CalendarDays,
          badge: todayQuery.data?.appointments.total || undefined,
          badgeTone: 'live',
        },
      ],
    },
    {
      titleKey: 'nav.group.patients',
      items: [{ labelKey: 'nav.patientRecords', to: '/patients', icon: Users }],
    },
    {
      // #401 — Resepsiyon giriş tahsilatı yapar (page:billing zaten resepsiyonda).
      titleKey: 'nav.group.collection',
      items: [{ labelKey: 'nav.billing', to: '/billing', icon: Receipt }],
    },
    {
      titleKey: 'nav.group.callback',
      items: [{ labelKey: 'nav.recall', to: '/recall', icon: PhoneCall }],
    },
  ];

  return (
    <BrandedSidebar
      roleLabel={t('roles.frontDesk')}
      groups={groups}
      userName={me.data?.name ?? ''}
      userSubtitle={`${t('roles.frontDesk')} / ${t('roles.resepsiyon')}`}
      onNavigate={onNavigate}
    />
  );
}
