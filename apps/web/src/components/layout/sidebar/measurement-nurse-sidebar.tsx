import { CheckCircle2, Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { BrandedSidebar, type BrandedGroup, type SidebarProps } from './shared';

/**
 * Ölçüm istasyonu (kilitli kiosk): header "Ölçüm Odası" + 2 öğe (Ölçüm Talepleri
 * canlı sayaçlı + Tamamlanan). Dashboard/hasta yok.
 *
 * v0.4 (#541): bu kiosk artık "hemşire + olcum modu" ile de açılır (mod kilitli);
 * eski `olcum_hemsiresi` rolüyle de açılır (çift-yol). Dispatcher mode==='olcum'
 * veya solo olcum_hemsiresi rolünde bunu seçer.
 */
export function MeasurementNurseSidebar({ onNavigate }: SidebarProps) {
  const { t } = useTranslation('common');
  const me = trpc.auth.me.useQuery(undefined, { staleTime: 300_000 });
  // Bekleyen ölçüm talebi sayısı (rozet) — listForUnit default ACTIVE_STATUSES.
  const queueQuery = trpc.measurementOrder.listForUnit.useQuery({}, { refetchInterval: 30_000 });
  const queueCount = queueQuery.data?.length ?? 0;

  const groups: BrandedGroup[] = [
    {
      titleKey: 'nav.group.measurement',
      items: [
        {
          labelKey: 'nav.measurementRequests',
          to: '/measurement-queue',
          icon: Inbox,
          badge: queueCount || undefined,
          badgeTone: 'live',
        },
        { labelKey: 'nav.measurementCompleted', to: '/measurement-completed', icon: CheckCircle2 },
      ],
    },
  ];

  return (
    <BrandedSidebar
      roleLabel={t('roles.measurementRoom')}
      groups={groups}
      lockNote={t('nav.measurementLock')}
      userName={me.data?.name ?? ''}
      userSubtitle={t('roles.olcumHemsiresi')}
      onNavigate={onNavigate}
    />
  );
}
