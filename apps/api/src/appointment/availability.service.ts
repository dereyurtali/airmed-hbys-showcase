import { Injectable, NotFoundException } from '@nestjs/common';
import { extractWorkingHours, type WorkingHours } from '../clinic-settings/clinic-settings.schemas';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import type { DoctorFreeSlots, FreeSlotsQuery } from './availability.schemas';

// #1019 — Boş-slot hesabı. Tek doğru kaynak service katmanı: mesai
// (DoctorAvailability) − izin (DoctorLeave) − ziyaret penceresi
// (VisitingWindow) − dolu randevular → durationMinutes'lık slotlar.
//
// KRİTİK TUTARLILIK KURALI: Bu servisin önerdiği her slot,
// AppointmentService.assertDoctorAvailable + appointments_no_overlap
// EXCLUDE constraint'inden geçebilmeli. O yüzden:
//   - Gün/saat karşılaştırması assertDoctorAvailable ile aynı konvansiyonda
//     (server-yerel getDay/getHours; "HH:MM" stringleri yerel saat).
//   - Overlap testi half-open [start, end): aStart < bEnd && aEnd > bStart
//     (EXCLUDE tsrange varsayılanıyla aynı).
// Buradaki kuralı değiştiren, appointment.service.ts'teki eşini de değiştirmeli.
//
// Mesai satırı hiç tanımlı olmayan doktor create tarafında serbesttir; slot
// önerirken sınırsız gün üretmemek için klinik varsayılanı kullanılır.
// #1048 — varsayılan pencere artık tenant ayarından (settings.scheduling.
// workingHours, yönetici Klinik Ayarları) gelir; ayar yoksa hardcoded fallback:
// hafta içi 09:00-18:00, cumartesi 09:00-14:00, pazar kapalı (demoeyeclinic.tj,
// #1018). Doktorun açık mesai satırı varsa her iki durumda da o kazanır.
const WORKING_HOURS_DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function defaultWindowFor(
  dayOfWeek: number,
  workingHours?: WorkingHours,
): { start: string; end: string } | null {
  if (workingHours) return workingHours[WORKING_HOURS_DAY_KEYS[dayOfWeek]!] ?? null;
  if (dayOfWeek === 0) return null;
  if (dayOfWeek === 6) return { start: '09:00', end: '14:00' };
  return { start: '09:00', end: '18:00' };
}

// Payload sigortası: doktor başına bu kadar slot yeter (31 gün × tam boş
// takvim kombinasyonunda cevabı şişirmemek için).
const MAX_SLOTS_PER_DOCTOR = 200;

interface Interval {
  start: Date;
  end: Date;
}

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async freeSlots(query: FreeSlotsQuery): Promise<{ doctors: DoctorFreeSlots[] }> {
    const rangeStart = new Date(query.dateFrom);
    const rangeEnd = new Date(query.dateTo);
    // Geçmişe slot önerilmez — aralık geçmişte başlıyorsa şimdiden itibaren bak.
    const now = new Date();
    const effectiveStart = rangeStart < now ? now : rangeStart;
    if (effectiveStart >= rangeEnd) return { doctors: [] };

    // #1048 — klinik mesai penceresi tenant ayarından (RLS tx içinde). Bozuk/
    // eksik ayar = undefined → hardcoded fallback. Doktor sorgusu bundan
    // bağımsız → paralel (bu endpoint AppointmentDialog slot-önericisiyle
    // interaktif yola girdi, seri round-trip'ten kaçınılır).
    const [tenant, doctors] = await Promise.all([
      this.prisma.scoped.tenant.findFirst({
        where: { id: this.tenantContext.requireTenantId() },
        select: { settings: true },
      }),
      this.prisma.scoped.doctor.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          ...(query.doctorId ? { id: query.doctorId } : {}),
        },
        select: {
          id: true,
          name: true,
          specialty: true,
          type: true,
          availabilities: { select: { dayOfWeek: true, startTime: true, endTime: true } },
          leaves: {
            where: { startsAt: { lt: rangeEnd }, endsAt: { gt: effectiveStart } },
            select: { startsAt: true, endsAt: true },
          },
          visitingWindows: { select: { startsAt: true, endsAt: true } },
        },
        orderBy: { name: 'asc' },
      }),
    ]);
    const workingHours = extractWorkingHours(tenant?.settings ?? null);
    if (query.doctorId && doctors.length === 0) {
      throw new NotFoundException('Doctor not found');
    }
    if (doctors.length === 0) return { doctors: [] };

    // Aralıktaki dolu randevular tek sorguda; iptal/gelmedi slot tutmaz
    // (EXCLUDE constraint'in WHERE filtresiyle aynı küme).
    const busy = await this.prisma.scoped.appointment.findMany({
      where: {
        deletedAt: null,
        doctorId: { in: doctors.map((d) => d.id) },
        status: { notIn: ['cancelled', 'no_show'] },
        startsAt: { lt: rangeEnd },
        endsAt: { gt: effectiveStart },
      },
      select: { doctorId: true, startsAt: true, endsAt: true },
    });
    const busyByDoctor = new Map<string, Interval[]>();
    for (const b of busy) {
      if (!b.doctorId) continue;
      const list = busyByDoctor.get(b.doctorId) ?? [];
      list.push({ start: b.startsAt, end: b.endsAt });
      busyByDoctor.set(b.doctorId, list);
    }

    const durationMs = query.durationMinutes * 60 * 1000;
    const result: DoctorFreeSlots[] = doctors.map((doctor) => ({
      doctorId: doctor.id,
      name: doctor.name,
      specialty: doctor.specialty,
      // #1047 — penceresiz misafir doktor randevuya KAPALI (assertDoctorAvailable
      // ikizi): slot hiç üretilmez; bot musaitlik_sorgula da otomatik uyar.
      slots:
        doctor.type === 'visiting' && doctor.visitingWindows.length === 0
          ? []
          : computeSlots({
              effectiveStart,
              rangeEnd,
              durationMs,
              workingHours,
              availabilities: doctor.availabilities,
              leaves: doctor.leaves.map((l) => ({ start: l.startsAt, end: l.endsAt })),
              visitingWindows: doctor.visitingWindows.map((v) => ({
                start: v.startsAt,
                end: v.endsAt,
              })),
              busy: busyByDoctor.get(doctor.id) ?? [],
            }),
    }));

    return { doctors: result };
  }
}

function computeSlots(args: {
  effectiveStart: Date;
  rangeEnd: Date;
  durationMs: number;
  workingHours?: WorkingHours;
  availabilities: { dayOfWeek: number; startTime: string; endTime: string }[];
  leaves: Interval[];
  visitingWindows: Interval[];
  busy: Interval[];
}): string[] {
  const {
    effectiveStart,
    rangeEnd,
    durationMs,
    workingHours,
    availabilities,
    leaves,
    visitingWindows,
    busy,
  } = args;
  const slots: string[] = [];

  // Gün gün yürü (server-yerel gün sınırları — assertDoctorAvailable'ın
  // getDay/getHours konvansiyonuyla aynı).
  const day = new Date(
    effectiveStart.getFullYear(),
    effectiveStart.getMonth(),
    effectiveStart.getDate(),
  );
  for (; day < rangeEnd; day.setDate(day.getDate() + 1)) {
    const fallback = defaultWindowFor(day.getDay(), workingHours);
    const windows =
      availabilities.length > 0
        ? availabilities
            .filter((a) => a.dayOfWeek === day.getDay())
            .map((a) => ({ start: atTime(day, a.startTime), end: atTime(day, a.endTime) }))
        : fallback
          ? [{ start: atTime(day, fallback.start), end: atTime(day, fallback.end) }]
          : [];

    for (const w of windows) {
      // Slotlar pencere başlangıcına hizalanır (09:00, 09:15, ...) — pencere
      // ortasından kırpılan aralıkta hizalama kaymasın diye üretim kırpılmamış
      // pencereden yapılıp filtrelenir.
      for (let t = w.start.getTime(); t + durationMs <= w.end.getTime(); t += durationMs) {
        const slot: Interval = { start: new Date(t), end: new Date(t + durationMs) };
        if (slot.start < effectiveStart || slot.end > rangeEnd) continue;
        if (visitingWindows.length > 0 && !visitingWindows.some((v) => contains(v, slot))) {
          continue;
        }
        if (leaves.some((l) => overlaps(l, slot))) continue;
        if (busy.some((b) => overlaps(b, slot))) continue;
        slots.push(slot.start.toISOString());
        if (slots.length >= MAX_SLOTS_PER_DOCTOR) return slots;
      }
    }
  }
  return slots;
}

function atTime(day: Date, hhmm: string): Date {
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm);
}

// Half-open [start, end) — appointments_no_overlap EXCLUDE tsrange'iyle aynı.
function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && a.end > b.start;
}

function contains(outer: Interval, inner: Interval): boolean {
  return outer.start <= inner.start && outer.end >= inner.end;
}
