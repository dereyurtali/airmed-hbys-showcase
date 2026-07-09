import { memo, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_SCHEDULE_BOUNDS,
  SCHEDULE_PIXELS_PER_MINUTE,
  SCHEDULE_SLOT_MINUTES,
  findLeaveOverlap,
  isSameDay,
  minutesFromDayStart,
  packDayAppointments,
  scheduleTotalMinutes,
  type ScheduleBounds,
} from '../../lib/schedule.utils';
import { cn } from '../../lib/utils';
import { AppointmentCard, type AppointmentCardData } from './AppointmentCard';

export interface LeaveOverlay {
  id: string;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
}

// #1048 — Misafir doktorun geliş penceresi DIŞI kalan aralıklar (SchedulePage
// pencere komplementini hesaplar). İzin overlay'inin görsel dili, gri tonda.
export interface ClosedOverlay {
  id: string;
  startsAt: Date;
  endsAt: Date;
}

interface Props {
  appointments: AppointmentCardData[];
  selectedDate: Date;
  locale: string;
  leaves?: LeaveOverlay[];
  closed?: ClosedOverlay[];
  bounds?: ScheduleBounds;
  onCardClick?: (id: string) => void;
  onSlotClick?: (start: Date) => void;
}

// #1048 — grid yüksekliği artık tenant mesai ayarına bağlı (bounds).
export function scheduleGridHeightPx(bounds: ScheduleBounds): number {
  return scheduleTotalMinutes(bounds) * SCHEDULE_PIXELS_PER_MINUTE;
}

/**
 * Saat cetveli — mutlak konumlu etiketler saat çizgisinin üzerine ortalanır
 * (Google Calendar kalıbı); ilk etiket kırpılmasın diye translate almaz.
 * Weekly'de tek kopya paylaşılır (#1018 takvim turu).
 */
export function TimeGutter({ bounds = DEFAULT_SCHEDULE_BOUNDS }: { bounds?: ScheduleBounds }) {
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = bounds.startHour; h <= bounds.endHour; h += 1) out.push(h);
    return out;
  }, [bounds]);
  return (
    <div className="relative select-none" style={{ height: `${scheduleGridHeightPx(bounds)}px` }}>
      {hours.map((h) => {
        const top = (h - bounds.startHour) * 60 * SCHEDULE_PIXELS_PER_MINUTE;
        return (
          <span
            key={h}
            className={cn(
              'absolute right-2 text-[11px] font-medium leading-none tabular-nums text-muted-foreground/70',
              h !== bounds.startHour && '-translate-y-1/2',
            )}
            style={{ top: `${top}px` }}
          >
            {h.toString().padStart(2, '0')}:00
          </span>
        );
      })}
    </div>
  );
}

/** Şimdi çizgisi — yalnız bugün görünür; dakikada bir kayar. */
function NowLine({ day, bounds }: { day: Date; bounds: ScheduleBounds }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  if (!isSameDay(day, now)) return null;
  const min = minutesFromDayStart(now, bounds.startHour);
  if (min < 0 || min > scheduleTotalMinutes(bounds)) return null;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20"
      style={{ top: `${min * SCHEDULE_PIXELS_PER_MINUTE}px` }}
      aria-hidden
    >
      <div className="relative border-t-2 border-destructive">
        <span className="absolute -left-[3px] -top-[5px] h-2 w-2 rounded-full bg-destructive" />
      </div>
    </div>
  );
}

/**
 * Tek günün slot şeridi (saat cetveli HARİÇ) — DailySlotGrid ve WeeklyGrid'in
 * ortak gövdesi. Saat çizgisi solid, yarım saat çizgisi soluk kesikli; boş slot
 * hover'ında artı ipucu (yeni randevu affordance'ı).
 */
// #1067 — memo: WeeklyGrid 7 kez render eder; poll'da yalnız props'u değişen
// gün şeridi yeniden render olsun (leaves artık memo'lu Map'ten geliyor).
export const DayLane = memo(function DayLane({
  appointments,
  day,
  locale,
  leaves,
  closed,
  bounds = DEFAULT_SCHEDULE_BOUNDS,
  onCardClick,
  onSlotClick,
  cardVariant = 'full',
}: {
  appointments: AppointmentCardData[];
  day: Date;
  locale: string;
  leaves?: LeaveOverlay[];
  closed?: ClosedOverlay[];
  bounds?: ScheduleBounds;
  onCardClick?: (id: string) => void;
  onSlotClick?: (start: Date) => void;
  cardVariant?: 'full' | 'compact';
}) {
  const { t } = useTranslation('appointment');
  const totalMinutes = scheduleTotalMinutes(bounds);
  const slotRows = useMemo(() => {
    const rows: { hour: number; minute: number }[] = [];
    for (let m = 0; m < totalMinutes; m += SCHEDULE_SLOT_MINUTES) {
      rows.push({
        hour: bounds.startHour + Math.floor(m / 60),
        minute: m % 60,
      });
    }
    return rows;
  }, [bounds, totalMinutes]);

  // #394 — Çakışan randevu sütun-paketlemesi (klasik takvim) schedule.utils'te.
  const packed = useMemo(() => packDayAppointments(appointments, bounds), [appointments, bounds]);

  return (
    <div className="relative" style={{ height: `${scheduleGridHeightPx(bounds)}px` }}>
      {slotRows.map((row, idx) => {
        const slotStart = new Date(day);
        slotStart.setHours(row.hour, row.minute, 0, 0);
        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotEnd.getMinutes() + SCHEDULE_SLOT_MINUTES);
        const leave = findLeaveOverlap(slotStart, slotEnd, leaves);
        // #1048 — izin uyarısı (amber) pencere-dışı griden önceliklidir:
        // ikisi de "kapalı" ama izin daha spesifik bilgi taşır.
        const outsideWindow = !leave && findLeaveOverlap(slotStart, slotEnd, closed);
        const blocked = !!leave || !!outsideWindow;
        const timeLabel = `${row.hour.toString().padStart(2, '0')}:${row.minute
          .toString()
          .padStart(2, '0')}`;
        const reason = leave?.reason?.trim() || t('leave.noReason');
        const blockedTitle = leave
          ? `${t('leave.tooltipPrefix')}: ${reason}`
          : outsideWindow
            ? t('visitingClosed.tooltip')
            : undefined;
        const blockedAria = leave
          ? `${timeLabel} — ${t('leave.label')}: ${reason}`
          : outsideWindow
            ? `${timeLabel} — ${t('visitingClosed.label')}`
            : timeLabel;
        return (
          <button
            type="button"
            key={`row-${idx}`}
            onClick={onSlotClick && !blocked ? () => onSlotClick(slotStart) : undefined}
            // #368 — İzinli/pencere-dışı slot tıklanamaz; backend de create()'te zorlar.
            disabled={!onSlotClick || blocked}
            className={cn(
              'group/slot flex w-full items-center justify-center transition-colors duration-100',
              idx > 0 &&
                (row.minute === 0
                  ? 'border-t border-border'
                  : 'border-t border-dashed border-border/50'),
              leave
                ? 'cursor-not-allowed bg-warning-bg'
                : outsideWindow
                  ? 'cursor-not-allowed bg-muted/70'
                  : 'enabled:hover:bg-primary/[0.05]',
            )}
            style={{ height: `${SCHEDULE_SLOT_MINUTES * SCHEDULE_PIXELS_PER_MINUTE}px` }}
            title={blockedTitle}
            aria-label={blockedAria}
            data-on-leave={leave ? 'true' : undefined}
            data-outside-window={outsideWindow ? 'true' : undefined}
          >
            {onSlotClick && !blocked && (
              <Plus
                className="h-3.5 w-3.5 text-primary opacity-0 transition-opacity duration-100 group-hover/slot:opacity-50"
                aria-hidden
              />
            )}
          </button>
        );
      })}

      {packed.map(({ item: apt, startMin, endMin, col, cols }) => {
        const top = startMin * SCHEDULE_PIXELS_PER_MINUTE;
        const height = Math.max(
          SCHEDULE_SLOT_MINUTES * SCHEDULE_PIXELS_PER_MINUTE,
          (endMin - startMin) * SCHEDULE_PIXELS_PER_MINUTE,
        );
        const widthPct = 100 / cols;
        return (
          <div
            key={apt.id}
            className="absolute z-10"
            style={{
              top: `${top + 1}px`,
              height: `${height - 2}px`,
              left: `calc(${col * widthPct}% + 3px)`,
              width: `calc(${widthPct}% - 5px)`,
            }}
            data-overlap-cols={cols}
          >
            <AppointmentCard
              appointment={apt}
              locale={locale}
              onClick={onCardClick}
              variant={cardVariant}
              heightPx={height - 2}
            />
          </div>
        );
      })}

      <NowLine day={day} bounds={bounds} />
    </div>
  );
});

export function DailySlotGrid({
  appointments,
  selectedDate,
  locale,
  leaves,
  closed,
  bounds = DEFAULT_SCHEDULE_BOUNDS,
  onCardClick,
  onSlotClick,
}: Props) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="grid grid-cols-[56px_minmax(0,1fr)]" aria-label="daily-slot-grid">
        <div className="border-r border-border/70 bg-muted/20">
          <TimeGutter bounds={bounds} />
        </div>
        <DayLane
          appointments={appointments}
          day={selectedDate}
          locale={locale}
          leaves={leaves}
          closed={closed}
          bounds={bounds}
          onCardClick={onCardClick}
          onSlotClick={onSlotClick}
        />
      </div>
    </div>
  );
}
