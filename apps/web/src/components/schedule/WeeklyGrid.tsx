import { useMemo } from 'react';
import {
  DEFAULT_SCHEDULE_BOUNDS,
  addDays,
  filterLeavesForDay,
  isSameDay,
  type ScheduleBounds,
} from '../../lib/schedule.utils';
import { cn } from '../../lib/utils';
import { type AppointmentCardData } from './AppointmentCard';
import { DayLane, TimeGutter, type ClosedOverlay, type LeaveOverlay } from './DailySlotGrid';

interface Props {
  weekStart: Date;
  appointments: AppointmentCardData[];
  locale: string;
  leaves?: LeaveOverlay[];
  closed?: ClosedOverlay[];
  bounds?: ScheduleBounds;
  onCardClick?: (id: string) => void;
  onSlotClick?: (start: Date) => void;
}

/**
 * Haftalık görünüm — #1018 takvim turu: eski "7 ayrı mini-grid + 7 saat cetveli"
 * yerine TEK paylaşılan saat cetveli + 7 gün şeridi (klasik takvim yapısı).
 * Bugünün kolonu hafif primary zemin + gün numarası dolgulu rozet.
 */
export function WeeklyGrid({
  weekStart,
  appointments,
  locale,
  leaves,
  closed,
  bounds = DEFAULT_SCHEDULE_BOUNDS,
  onCardClick,
  onSlotClick,
}: Props) {
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const byDay = useMemo(() => {
    const map = new Map<number, AppointmentCardData[]>();
    days.forEach((_, i) => map.set(i, []));
    appointments.forEach((apt) => {
      const idx = days.findIndex((d) => isSameDay(d, apt.startsAt));
      if (idx >= 0) map.get(idx)!.push(apt);
    });
    return map;
  }, [appointments, days]);

  // #1067 — gün→izin dilimleri memo'lu Map: her render'da gün başına yeni
  // array üretmek DayLane memo'sunu kırıyordu.
  const leavesByDay = useMemo(() => {
    const map = new Map<number, LeaveOverlay[] | undefined>();
    days.forEach((day, i) => {
      map.set(i, leaves && leaves.length > 0 ? filterLeavesForDay(leaves, day) : undefined);
    });
    return map;
  }, [leaves, days]);

  // #1048 — misafir doktor pencere-dışı (gri) dilimler, izinle aynı memo kalıbı.
  const closedByDay = useMemo(() => {
    const map = new Map<number, ClosedOverlay[] | undefined>();
    days.forEach((day, i) => {
      map.set(i, closed && closed.length > 0 ? filterLeavesForDay(closed, day) : undefined);
    });
    return map;
  }, [closed, days]);

  const today = useMemo(() => new Date(), []);

  return (
    <div className="overflow-hidden rounded-xl border bg-card" aria-label="weekly-grid">
      {/* Gün başlıkları — cetvel kolonu boş köşe bırakır. */}
      <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b bg-muted/20">
        <div />
        {days.map((day, idx) => {
          const isToday = isSameDay(day, today);
          return (
            <div
              key={idx}
              className={cn(
                'flex flex-col items-center gap-0.5 border-l border-border/60 py-2',
                isToday && 'bg-primary/[0.04]',
              )}
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
                {day.toLocaleDateString(locale, { weekday: 'short' })}
              </span>
              <span
                className={cn(
                  'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[13px] font-semibold tabular-nums leading-none',
                  isToday ? 'bg-primary text-primary-foreground' : 'text-foreground',
                )}
              >
                {day.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      {/* Tek cetvel + 7 şerit */}
      <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]">
        <div className="border-r border-border/70 bg-muted/20">
          <TimeGutter bounds={bounds} />
        </div>
        {days.map((day, idx) => (
          <div
            key={idx}
            className={cn(
              'border-l border-border/60 first:border-l-0',
              isSameDay(day, today) && 'bg-primary/[0.025]',
            )}
          >
            <DayLane
              appointments={byDay.get(idx) ?? []}
              day={day}
              locale={locale}
              leaves={leavesByDay.get(idx)}
              closed={closedByDay.get(idx)}
              bounds={bounds}
              onCardClick={onCardClick}
              onSlotClick={onSlotClick}
              cardVariant="compact"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
