// A6 schedule — UI yardımcıları.
//
// Klinik tek timezone'da çalışıyor (Asia/Dushanbe varsayılan, Tenant.timezone
// override). Tüm hesaplar browser local TZ'de yapılıyor; backend ISO 8601
// with offset bekliyor (appointment.schemas.ts:29). Bu dosya `new Date()`'in
// local TZ davranışına güveniyor — DST geçişlerinde 1 saat kayma olabilir
// ama klinik 09:00–18:00 sabit aralığında DST kritik değil.

export const SCHEDULE_DAY_START_HOUR = 9; // 09:00
export const SCHEDULE_DAY_END_HOUR = 18; // 18:00 (exclusive)
export const SCHEDULE_SLOT_MINUTES = 30;

export const SCHEDULE_PIXELS_PER_MINUTE = 1.2; // 30dk = 36px, 9 saat = 648px

// #1048 — Klinik mesai ayarı (Tenant.settings.scheduling.workingHours) grid
// saat aralığını belirler. Gün-bazlı daraltma YAPILMAZ (minimal karar): grid
// tüm günlerin min-start/max-end üst-limitini kullanır; ayar yoksa yukarıdaki
// sabitler geçerli.
export interface WorkingHoursDay {
  start: string; // 'HH:MM'
  end: string; // 'HH:MM'
}
export type WorkingHours = Record<
  'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun',
  WorkingHoursDay | null
>;

export interface ScheduleBounds {
  startHour: number;
  endHour: number; // exclusive
}

export const DEFAULT_SCHEDULE_BOUNDS: ScheduleBounds = {
  startHour: SCHEDULE_DAY_START_HOUR,
  endHour: SCHEDULE_DAY_END_HOUR,
};

export function boundsFromWorkingHours(wh: WorkingHours | null | undefined): ScheduleBounds {
  if (!wh) return DEFAULT_SCHEDULE_BOUNDS;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const day of Object.values(wh)) {
    if (!day) continue;
    const startHour = Number(day.start.slice(0, 2));
    const endHour = Number(day.end.slice(0, 2));
    const endMinute = Number(day.end.slice(3, 5));
    if (Number.isNaN(startHour) || Number.isNaN(endHour)) continue;
    min = Math.min(min, startHour);
    // 17:30 biten gün grid'de 18'e yuvarlanır (saat cetveli tam saat çizer).
    max = Math.max(max, endMinute > 0 ? endHour + 1 : endHour);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    return DEFAULT_SCHEDULE_BOUNDS;
  }
  return { startHour: min, endHour: Math.min(max, 24) };
}

export function scheduleTotalMinutes(bounds: ScheduleBounds): number {
  return (bounds.endHour - bounds.startHour) * 60;
}

export function dayBoundsISO(date: Date): { dateFrom: string; dateTo: string } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ISO week: Mon = 1, Sun = 7. Klinik haftası Pazartesi'den başlıyor —
// `selectedDate`'in içinde olduğu hafta'nın Pazartesi'sini döner.
export function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const day = d.getDay(); // Sun=0, Mon=1, ..., Sat=6
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function weekBoundsISO(date: Date): { dateFrom: string; dateTo: string } {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatTimeRange(start: Date, end: Date, locale: string): string {
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };
  return `${start.toLocaleTimeString(locale, opts)} – ${end.toLocaleTimeString(locale, opts)}`;
}

export function formatDayLabel(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// Slot grid pozisyon hesabı: appointment'ın gün içi başlangıç dakikası → top px,
// uzunluk dakikası → height px. Pencere dışı kalan randevular grid'in
// üstüne/altına taşar — clamp burada değil, AppointmentCard'ın içinde olur.
export function minutesFromDayStart(
  date: Date,
  startHour: number = SCHEDULE_DAY_START_HOUR,
): number {
  return date.getHours() * 60 + date.getMinutes() - startHour * 60;
}

export interface PackedAppointment<T> {
  item: T;
  startMin: number;
  endMin: number;
  /** 0-based sütun indeksi (küme içinde). */
  col: number;
  /** Kümedeki toplam sütun sayısı → genişlik = 1/cols. */
  cols: number;
}

// #394 — Çakışan randevu sütun-paketlemesi (klasik takvim). Aynı/örtüşen zaman
// dilimindeki kartlar (örn. 3 farklı doktorun 10:00 randevusu) üst üste binip
// alttakileri tamamen örtüyordu ("randevu yok" yanılgısı). Greedy interval-graf
// renklendirmesi: örtüşen kartları küme içinde sütunlara dağıtır; her kartın
// genişliği 1/cols, sol ofseti col/cols. Görsel min-yükseklik (1 slot) örtüşmesi
// de sayılsın diye efektif bitiş = max(gerçek bitiş, başlangıç + slot).
export function packDayAppointments<T extends { startsAt: Date; endsAt: Date }>(
  appts: readonly T[],
  bounds: ScheduleBounds = DEFAULT_SCHEDULE_BOUNDS,
): PackedAppointment<T>[] {
  const totalMinutes = scheduleTotalMinutes(bounds);
  const items = appts
    .map((item) => {
      const startMin = Math.max(0, minutesFromDayStart(item.startsAt, bounds.startHour));
      const endMin = Math.min(totalMinutes, minutesFromDayStart(item.endsAt, bounds.startHour));
      return {
        item,
        startMin,
        endMin,
        effEnd: Math.max(endMin, startMin + SCHEDULE_SLOT_MINUTES),
      };
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const result: PackedAppointment<T>[] = [];
  let cluster: PackedAppointment<T>[] = [];
  let colEnds: number[] = [];
  let clusterMaxEnd = -1;

  const flush = () => {
    const cols = colEnds.length || 1;
    for (const c of cluster) {
      c.cols = cols;
      result.push(c);
    }
    cluster = [];
    colEnds = [];
    clusterMaxEnd = -1;
  };

  for (const it of items) {
    if (cluster.length > 0 && it.startMin >= clusterMaxEnd) flush();
    let col = colEnds.findIndex((end) => end <= it.startMin);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(it.effEnd);
    } else {
      colEnds[col] = it.effEnd;
    }
    cluster.push({ item: it.item, startMin: it.startMin, endMin: it.endMin, col, cols: 1 });
    clusterMaxEnd = Math.max(clusterMaxEnd, it.effEnd);
  }
  flush();
  return result;
}

// Klasik aralık-overlap testi: slotStart < leaveEnd AND slotEnd > leaveStart.
export function findLeaveOverlap<L extends { startsAt: Date; endsAt: Date }>(
  slotStart: Date,
  slotEnd: Date,
  leaves: readonly L[] | undefined,
): L | undefined {
  if (!leaves || leaves.length === 0) return undefined;
  return leaves.find((l) => l.startsAt < slotEnd && l.endsAt > slotStart);
}

// Verilen günle çakışan izinleri döner (haftalık görünüm her gün için filtreler).
export function filterLeavesForDay<L extends { startsAt: Date; endsAt: Date }>(
  leaves: readonly L[],
  day: Date,
): L[] {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  return leaves.filter((l) => l.startsAt < dayEnd && l.endsAt > dayStart);
}
