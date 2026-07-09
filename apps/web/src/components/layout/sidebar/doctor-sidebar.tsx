import { CalendarDays, FileSignature, ListChecks, Scissors, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { useAuth } from '../../../providers/AuthProvider';
import { BrandedSidebar, type BrandedGroup, type SidebarProps } from './shared';

// v0.4.1 (#683) — Doktor sidebar mockup gruplu yapıya taşındı
// (docs/mockups/rol-menuleri-chatgpt.html). Yerleşik: Günlük Akış / Hastalar /
// Ameliyat. Misafir (nitelik, User.flags.is_visiting_doctor): kilit şeridi + dar
// menü (Bugün / Hastalar / İmza). "Muayene Sırası" canlı kuyruk sayacı (gerçek
// veri); diğer item'larda sayaç yok (sahte sayı yasak).
//
// Erişim notu: doktor page:surgeryCalendar'a sahip DEĞİL → Ameliyat item'ı
// /surgery-day'e (page:surgeryDay var) gider, ölü link olmaz.

/** Sadece-doktor: gruplu menü + iş kuyruğu canlı sayacı. Misafir niteliğinde kilit + dar menü. */
export function DoctorSidebar({ onNavigate }: SidebarProps) {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const isVisiting = user?.flags?.is_visiting_doctor === true;
  const profileQuery = trpc.doctor.myProfile.useQuery(undefined, { staleTime: 300_000 });
  const worklistQuery = trpc.encounter.myWorklist.useQuery({}, { refetchInterval: 30_000 });
  const queueCount = worklistQuery.data?.length ?? 0;

  const residentGroups: BrandedGroup[] = [
    {
      titleKey: 'nav.group.dailyFlow',
      items: [
        {
          labelKey: 'nav.examQueue',
          to: '/worklist',
          icon: ListChecks,
          badge: queueCount,
          badgeTone: 'live',
        },
        { labelKey: 'nav.myAppointments', to: '/schedule', icon: CalendarDays },
        { labelKey: 'nav.cosign', to: '/cosign', icon: FileSignature },
      ],
    },
    {
      titleKey: 'nav.group.patients',
      items: [{ labelKey: 'nav.myPatients', to: '/patients', icon: Users }],
    },
    {
      titleKey: 'nav.group.surgery',
      items: [{ labelKey: 'nav.surgeryDay', to: '/surgery-day', icon: Scissors }],
    },
  ];

  const visitingGroups: BrandedGroup[] = [
    {
      titleKey: 'nav.group.today',
      items: [
        {
          labelKey: 'nav.todayList',
          to: '/surgery-day',
          icon: ListChecks,
          badge: queueCount,
          badgeTone: 'live',
        },
        { labelKey: 'nav.myAppointments', to: '/schedule', icon: CalendarDays },
      ],
    },
    {
      titleKey: 'nav.group.patients',
      items: [{ labelKey: 'nav.myAssignedPatients', to: '/patients', icon: Users }],
    },
    {
      titleKey: 'nav.group.signature',
      items: [{ labelKey: 'nav.cosign', to: '/cosign', icon: FileSignature }],
    },
  ];

  const roleLabel = isVisiting
    ? `${t('roles.doktor')} · ${t('roles.visiting')}`
    : t('roles.doktor');

  return (
    <BrandedSidebar
      roleLabel={roleLabel}
      groups={isVisiting ? visitingGroups : residentGroups}
      lockNote={isVisiting ? t('nav.visitingLock') : undefined}
      userName={profileQuery.data?.name ?? ''}
      userSubtitle={profileQuery.data?.specialty ?? ''}
      onNavigate={onNavigate}
    />
  );
}
