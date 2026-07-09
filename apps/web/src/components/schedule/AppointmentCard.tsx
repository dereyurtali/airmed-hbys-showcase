import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  APPOINTMENT_STATUS_META,
  APPOINTMENT_TYPE_META,
  type AppointmentStatus,
  type AppointmentType,
} from '../../lib/appointment.constants';
import { doctorColor, doctorInitials } from '../../lib/doctor-colors';
import { formatTimeRange } from '../../lib/schedule.utils';
import { cn } from '../../lib/utils';

export interface AppointmentCardData {
  id: string;
  type: AppointmentType;
  status: AppointmentStatus;
  startsAt: Date;
  endsAt: Date;
  patientLabel?: string; // "Ad Soyad · MRN"
  // #1018 — doktor renk sistemi: sol şerit + baş harf rozeti doktora göre
  // boyanır (zemin tonu türü anlatmaya devam eder). Havuz randevusunda yok.
  doctorId?: string | null;
  doctorName?: string | null;
}

interface Props {
  appointment: AppointmentCardData;
  locale: string;
  onClick?: (id: string) => void;
  /**
   * #1018 takvim turu — yoğunluğa duyarlı kart. Dar/kısa alanda iki satırlı
   * düzen + rozet SIĞMAZ (kırpılıp "bok gibi" görünüyordu): compact tek satır
   * "SS:dd İsim" gösterir, tam bilgi tooltip'te (tıkla → detay zaten var).
   * - 'full': ikon + isim + saat aralığı + durum rozeti (günlük, ≥52px kart)
   * - 'compact': saat + isim tek/iki satır, rozet ve MRN yok (haftalık şerit)
   */
  variant?: 'full' | 'compact';
  /** Kart yüksekliği px — düzen kaç satır kaldıracak ona göre seçilir. */
  heightPx?: number;
}

// #1067 — memo: takvim şeritleri poll'da tüm kartları yeniden render ediyordu;
// props (appointment referansı) değişmeyen kart artık atlanır.
export const AppointmentCard = memo(function AppointmentCard({
  appointment,
  locale,
  onClick,
  variant = 'full',
  heightPx,
}: Props) {
  const { t } = useTranslation('appointment');
  const typeMeta = APPOINTMENT_TYPE_META[appointment.type];
  const statusMeta = APPOINTMENT_STATUS_META[appointment.status];
  const Icon = typeMeta.icon;
  const isCancelled = appointment.status === 'cancelled' || appointment.status === 'no_show';
  const interactive = Boolean(onClick);

  const fullLabel = appointment.patientLabel ?? appointment.id.slice(0, 8);
  // Compact'ta MRN gürültü — yalnız isim.
  const nameOnly = fullLabel.split(' · ')[0]!;
  const timeRange = formatTimeRange(appointment.startsAt, appointment.endsAt, locale);
  const startTime = timeRange.split(/\s*[–-]\s*/)[0]!;
  const doctor = appointment.doctorId ? doctorColor(appointment.doctorId) : null;
  const tooltip = [
    fullLabel,
    `${timeRange} · ${t(statusMeta.labelKey)}`,
    ...(appointment.doctorName ? [appointment.doctorName] : []),
  ].join('\n');

  // İki metin satırı ~46px ister; altında tek satıra düş.
  const twoLines = (heightPx ?? 999) >= 46;

  // #1018 — sol şerit 6px: 3px'te doktor rengi seçilemiyordu (Ali). Asıl
  // ayırt edici baş harf rozeti; şerit tarama sırasında hizalı renk bloğu verir.
  const shell = cn(
    'flex h-full w-full overflow-hidden rounded-md border-l-[6px] ring-1 ring-black/[0.04] transition-shadow duration-100',
    typeMeta.bg,
    typeMeta.color,
    doctor ? doctor.border : typeMeta.border,
    interactive && 'cursor-pointer hover:shadow-md hover:ring-black/[0.08]',
    isCancelled && 'opacity-60 line-through',
  );
  const a11y = {
    role: interactive ? ('button' as const) : undefined,
    tabIndex: interactive ? 0 : undefined,
    onClick: () => onClick?.(appointment.id),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (interactive && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        onClick?.(appointment.id);
      }
    },
    title: tooltip,
  };

  const doctorChip = doctor && appointment.doctorName && (
    <span
      className={cn(
        'inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none text-white',
        doctor.dot,
      )}
    >
      {doctorInitials(appointment.doctorName)}
    </span>
  );

  if (variant === 'compact') {
    return (
      <div {...a11y} className={cn(shell, 'flex-col justify-center gap-0 px-1 py-0.5')}>
        {twoLines ? (
          <>
            <span className="flex items-center gap-1">
              {doctorChip}
              <span className="text-[10px] font-semibold leading-tight tabular-nums opacity-80">
                {startTime}
              </span>
            </span>
            <span className="truncate text-[11px] font-medium leading-tight">{nameOnly}</span>
          </>
        ) : (
          <span className="flex min-w-0 items-center gap-1">
            {doctorChip}
            <span className="min-w-0 truncate text-[11px] leading-tight">
              <span className="font-semibold tabular-nums opacity-80">{startTime}</span>{' '}
              <span className="font-medium">{nameOnly}</span>
            </span>
          </span>
        )}
      </div>
    );
  }

  // full — kısa kartta (30dk ≈ 36px) tek satıra düş: ikon + isim + saat; durum rozeti yok.
  if (!twoLines) {
    return (
      <div {...a11y} className={cn(shell, 'items-center gap-1.5 px-1.5')}>
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{nameOnly}</span>
        <span className="shrink-0 text-[10px] tabular-nums opacity-80">{startTime}</span>
        {doctorChip}
      </div>
    );
  }

  return (
    <div {...a11y} className={cn(shell, 'flex-col gap-0.5 p-1.5 text-xs')}>
      <div className="flex items-center gap-1.5 font-medium">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{fullLabel}</span>
      </div>
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[10px] tabular-nums opacity-80">{timeRange}</span>
        <span className="flex shrink-0 items-center gap-1">
          {doctorChip}
          <span
            className={cn(
              'inline-flex rounded-full px-1.5 py-0.5 text-[10px] leading-tight',
              statusMeta.badge,
            )}
          >
            {t(statusMeta.labelKey)}
          </span>
        </span>
      </div>
    </div>
  );
});
