import { CalendarDays, Inbox, ListChecks, PhoneCall, ShieldCheck, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { useAuth } from '../../../providers/AuthProvider';
import { BrandedSidebar, type BrandedGroup, type BrandedItem, type SidebarProps } from './shared';

// v0.4 İP-8 (#544) — Hemşire çalışma modu (girişte seçilir) menüyü belirler.
// "olcum" ayrı kilitli kiosk (MeasurementNurseSidebar). Bu dosya Genel + Asistan +
// (mod'suz klasik, geri-uyum) varyantlarını besler.
//
// v0.4.1 (#684) — mockup gruplu menü. Genel: Kuyruklar&Görevler / Ameliyat /
// Sonrası / Hastalar. Asistan: Doktor Akışı / Hastalar. Co-sign mockup'ta vardı
// ama hemşire action:audit.cosign'a sahip DEĞİL → ölü link olmasın diye eklenmedi.
// Canlı sayaç yalnız gerçek veri (ölçüm/iş kuyruğu).

/**
 * Hemşire sidebar — moda göre gruplu menü + imza:
 *  - Genel: klinik-geneli görevler; Ölçüm Talepleri canlı rozeti + Post-op Recall.
 *  - Asistan: asiste edilen doktorun kuyruğu/hastaları; alt başlık "Dr. X adına".
 *  - Klasik (mod'suz): eski 3-öğe davranış (düz liste, geri-uyum).
 */
export function NurseSidebar({ onNavigate }: SidebarProps) {
  const { t } = useTranslation(['common', 'nurse']);
  const { user } = useAuth();
  const mode = user?.mode;
  const isAsistan = mode === 'asistan';
  const isGenel = mode === 'genel';
  // Asistan + klasik (mod'suz) acting-doctor akışını kullanır; genel kullanmaz.
  const usesActingDoctor = isAsistan || !mode;

  const me = trpc.auth.me.useQuery(undefined, { staleTime: 300_000 });
  const sessionQuery = trpc.nurseSession.my.useQuery(undefined, {
    staleTime: 60_000,
    enabled: usesActingDoctor,
  });
  const active = usesActingDoctor ? sessionQuery.data : undefined;

  // Asistan/klasik: aktif session'daki doktorun iş kuyruğu sayısı (Dr. X'in kuyruğu).
  const worklistQuery = trpc.encounter.myWorklist.useQuery(
    {},
    { refetchInterval: 30_000, enabled: !!active },
  );
  const queueCount = active ? (worklistQuery.data?.length ?? 0) : 0;

  // Genel: klinik-geneli ölçüm kuyruğu canlı sayısı.
  const measurementQuery = trpc.measurementOrder.listForUnit.useQuery(
    {},
    { refetchInterval: 30_000, enabled: isGenel },
  );
  const measurementCount = isGenel ? (measurementQuery.data?.length ?? 0) : 0;

  const genelGroups: BrandedGroup[] = [
    {
      titleKey: 'nav.group.queuesTasks',
      items: [
        {
          labelKey: 'nav.measurementRequests',
          to: '/measurement-queue',
          icon: Inbox,
          badge: measurementCount || undefined,
          badgeTone: 'live',
        },
        { labelKey: 'nav.examQueue', to: '/worklist', icon: ListChecks },
      ],
    },
    {
      titleKey: 'nav.group.surgery',
      items: [{ labelKey: 'nav.surgeryDay', to: '/surgery-day', icon: ShieldCheck }],
    },
    {
      titleKey: 'nav.group.afterCare',
      items: [{ labelKey: 'nav.recall', to: '/recall', icon: PhoneCall }],
    },
    {
      titleKey: 'nav.group.patients',
      items: [{ labelKey: 'nav.patients', to: '/patients', icon: Users }],
    },
  ];

  const asistanGroups: BrandedGroup[] = [
    {
      titleKey: 'nav.group.doctorFlow',
      items: [
        {
          labelKey: 'nav.examQueue',
          to: '/worklist',
          icon: ListChecks,
          badge: queueCount || undefined,
          badgeTone: 'live',
        },
        { labelKey: 'nav.schedule', to: '/schedule', icon: CalendarDays },
      ],
    },
    {
      titleKey: 'nav.group.patients',
      items: [{ labelKey: 'nav.myPatients', to: '/patients', icon: Users }],
    },
  ];

  // Klasik (mod'suz, legacy): düz liste — eski davranış korunur. Özet/ana-sayfa =
  // pinned-top "Genel Bakış" (/overview); jenerik "Gösterge paneli" kaldırıldı (#778).
  const classicItems: BrandedItem[] = [
    {
      labelKey: 'nav.examQueue',
      to: '/worklist',
      icon: ListChecks,
      badge: queueCount || undefined,
      badgeTone: 'live',
    },
    { labelKey: 'nav.myPatients', to: '/patients', icon: Users },
  ];

  const roleLabel = isAsistan
    ? `${t('roles.hemsire')} · ${t('roles.modeAsistan')}`
    : isGenel
      ? `${t('roles.hemsire')} · ${t('roles.modeGenel')}`
      : t('roles.hemsire');

  // Asistan/klasik: alt başlık aktif doktoru gösterir; genel: sade (acting yok).
  const subtitle = usesActingDoctor
    ? active?.doctorName
      ? t('nurse:session.assistingShort', { name: active.doctorName })
      : t('nurse:session.noActiveShort')
    : undefined;

  return (
    <BrandedSidebar
      roleLabel={roleLabel}
      groups={isAsistan ? asistanGroups : isGenel ? genelGroups : undefined}
      items={!isAsistan && !isGenel ? classicItems : undefined}
      userName={me.data?.name ?? ''}
      userSubtitle={subtitle}
      onNavigate={onNavigate}
    />
  );
}
