import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { AvailabilityService } from './availability.service';

const DOCTOR_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

// Sabit gelecekteki bir Salı günü (2027-06-01 Salı) — "geçmiş slot elenir"
// filtresine takılmadan deterministik test. Tarihler server-yerel kurulur
// (servis assertDoctorAvailable ile aynı yerel-saat konvansiyonunda çalışır).
const DAY = new Date(2027, 5, 1); // 1 Haziran 2027, Salı (getDay() === 2)
const at = (hh: number, mm = 0) =>
  new Date(DAY.getFullYear(), DAY.getMonth(), DAY.getDate(), hh, mm);
const iso = (d: Date) => d.toISOString();

type DoctorRow = {
  id: string;
  name: string;
  specialty: string;
  type: 'local' | 'visiting' | 'referral';
  availabilities: { dayOfWeek: number; startTime: string; endTime: string }[];
  leaves: { startsAt: Date; endsAt: Date }[];
  visitingWindows: { startsAt: Date; endsAt: Date }[];
};

describe('AvailabilityService', () => {
  let service: AvailabilityService;
  let doctorFindMany: jest.Mock;
  let appointmentFindMany: jest.Mock;
  let tenantFindFirst: jest.Mock;

  const doctorRow = (overrides: Partial<DoctorRow> = {}): DoctorRow => ({
    id: DOCTOR_ID,
    name: 'Dr. Test',
    specialty: 'Katarakt',
    type: 'local',
    availabilities: [{ dayOfWeek: DAY.getDay(), startTime: '09:00', endTime: '12:00' }],
    leaves: [],
    visitingWindows: [],
    ...overrides,
  });

  beforeEach(async () => {
    doctorFindMany = jest.fn().mockResolvedValue([doctorRow()]);
    appointmentFindMany = jest.fn().mockResolvedValue([]);
    // #1048 — mesai ayarı yok (settings: null) = hardcoded fallback; mevcut
    // testler bu varsayımla yeşil kalır.
    tenantFindFirst = jest.fn().mockResolvedValue({ settings: null });
    const prisma = {
      scoped: {
        doctor: { findMany: doctorFindMany },
        appointment: { findMany: appointmentFindMany },
        tenant: { findFirst: tenantFindFirst },
      },
    } as unknown as PrismaService;

    const moduleRef = await Test.createTestingModule({
      providers: [
        AvailabilityService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: TenantContextService,
          useValue: { requireTenantId: () => '11111111-1111-1111-1111-111111111111' },
        },
      ],
    }).compile();
    service = moduleRef.get(AvailabilityService);
  });

  const query = (overrides: Record<string, unknown> = {}) => ({
    doctorId: DOCTOR_ID,
    dateFrom: iso(at(0)),
    dateTo: iso(at(23, 59)),
    durationMinutes: 15,
    ...overrides,
  });

  it('mesai penceresinde 15 dakikalık slotlar üretir (09:00-12:00 → 12 slot)', async () => {
    const { doctors } = await service.freeSlots(query());
    expect(doctors).toHaveLength(1);
    expect(doctors[0].slots).toHaveLength(12);
    expect(doctors[0].slots[0]).toBe(iso(at(9)));
    expect(doctors[0].slots[11]).toBe(iso(at(11, 45)));
  });

  it('dolu randevuyla çakışan slotları eler (half-open overlap)', async () => {
    appointmentFindMany.mockResolvedValue([
      { doctorId: DOCTOR_ID, startsAt: at(9, 30), endsAt: at(10) },
    ]);
    const { doctors } = await service.freeSlots(query());
    const slots = doctors[0].slots;
    expect(slots).not.toContain(iso(at(9, 30)));
    expect(slots).not.toContain(iso(at(9, 45)));
    // Sınır bitişik slotlar dolu SAYILMAZ: [09:15,09:30) ve [10:00,10:15) serbest.
    expect(slots).toContain(iso(at(9, 15)));
    expect(slots).toContain(iso(at(10)));
    expect(slots).toHaveLength(10);
  });

  it('izinle çakışan slotları eler', async () => {
    doctorFindMany.mockResolvedValue([
      doctorRow({ leaves: [{ startsAt: at(9), endsAt: at(11) }] }),
    ]);
    const { doctors } = await service.freeSlots(query());
    expect(doctors[0].slots[0]).toBe(iso(at(11)));
    expect(doctors[0].slots).toHaveLength(4); // 11:00-12:00
  });

  it('mesai satırı hiç yoksa klinik varsayılanını kullanır (09:00-18:00)', async () => {
    doctorFindMany.mockResolvedValue([doctorRow({ availabilities: [] })]);
    const { doctors } = await service.freeSlots(query());
    expect(doctors[0].slots[0]).toBe(iso(at(9)));
    expect(doctors[0].slots).toHaveLength(36); // 9 saat × 4
  });

  it('ziyaretçi doktor: slot yalnız ziyaret penceresi içinde', async () => {
    doctorFindMany.mockResolvedValue([
      doctorRow({ type: 'visiting', visitingWindows: [{ startsAt: at(10), endsAt: at(11) }] }),
    ]);
    const { doctors } = await service.freeSlots(query());
    expect(doctors[0].slots).toEqual([
      iso(at(10)),
      iso(at(10, 15)),
      iso(at(10, 30)),
      iso(at(10, 45)),
    ]);
  });

  it('#1047: penceresiz misafir doktor 0 slot döndürür (varsayılan kapalı)', async () => {
    doctorFindMany.mockResolvedValue([doctorRow({ type: 'visiting', visitingWindows: [] })]);
    const { doctors } = await service.freeSlots(query());
    expect(doctors[0].slots).toHaveLength(0);
  });

  it('#1047: penceresiz YERLEŞİK doktor etkilenmez (mesai slotları üretilir)', async () => {
    doctorFindMany.mockResolvedValue([doctorRow({ type: 'local', visitingWindows: [] })]);
    const { doctors } = await service.freeSlots(query());
    expect(doctors[0].slots).toHaveLength(12);
  });

  it('#1047: misafir doktor pencere + izin çakışmasında izin kazanır', async () => {
    doctorFindMany.mockResolvedValue([
      doctorRow({
        type: 'visiting',
        visitingWindows: [{ startsAt: at(10), endsAt: at(11) }],
        leaves: [{ startsAt: at(10), endsAt: at(10, 30) }],
      }),
    ]);
    const { doctors } = await service.freeSlots(query());
    expect(doctors[0].slots).toEqual([iso(at(10, 30)), iso(at(10, 45))]);
  });

  it('#1018: varsayılan pencere hafta günü duyarlı — cumartesi 09:00-14:00, pazar slot yok', async () => {
    // 2027-06-05 Cumartesi, 2027-06-06 Pazar (DAY = 2027-06-01 Salı).
    const sat = new Date(2027, 5, 5);
    const sun = new Date(2027, 5, 6);
    const dayIso = (d: Date, hh: number, mm = 0) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm).toISOString();
    doctorFindMany.mockResolvedValue([doctorRow({ availabilities: [] })]);

    const satResult = await service.freeSlots(
      query({ dateFrom: dayIso(sat, 0), dateTo: dayIso(sat, 23, 59) }),
    );
    expect(satResult.doctors[0].slots[0]).toBe(dayIso(sat, 9));
    expect(satResult.doctors[0].slots).toHaveLength(20); // 5 saat × 4

    const sunResult = await service.freeSlots(
      query({ dateFrom: dayIso(sun, 0), dateTo: dayIso(sun, 23, 59) }),
    );
    expect(sunResult.doctors[0].slots).toHaveLength(0);
  });

  it('#1018: pazar günü açık mesai satırı varsayılanı yener (slot üretir)', async () => {
    const sun = new Date(2027, 5, 6);
    const dayIso = (d: Date, hh: number, mm = 0) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm).toISOString();
    doctorFindMany.mockResolvedValue([
      doctorRow({ availabilities: [{ dayOfWeek: 0, startTime: '10:00', endTime: '12:00' }] }),
    ]);
    const { doctors } = await service.freeSlots(
      query({ dateFrom: dayIso(sun, 0), dateTo: dayIso(sun, 23, 59) }),
    );
    expect(doctors[0].slots[0]).toBe(dayIso(sun, 10));
    expect(doctors[0].slots).toHaveLength(8);
  });

  it('#1048: tenant workingHours ayarlıysa varsayılan pencere ondan gelir (salı 10:00-12:00)', async () => {
    tenantFindFirst.mockResolvedValue({
      settings: {
        scheduling: {
          workingHours: {
            mon: { start: '09:00', end: '18:00' },
            tue: { start: '10:00', end: '12:00' },
            wed: { start: '09:00', end: '18:00' },
            thu: { start: '09:00', end: '18:00' },
            fri: { start: '09:00', end: '18:00' },
            sat: null,
            sun: null,
          },
        },
      },
    });
    doctorFindMany.mockResolvedValue([doctorRow({ availabilities: [] })]);
    const { doctors } = await service.freeSlots(query());
    // DAY = Salı → 10:00-12:00, 15dk → 8 slot.
    expect(doctors[0].slots[0]).toBe(iso(at(10)));
    expect(doctors[0].slots).toHaveLength(8);
  });

  it('#1048: workingHours günü null ise o gün kapalı; doktorun açık mesai satırı ayarı yener', async () => {
    tenantFindFirst.mockResolvedValue({
      settings: {
        scheduling: {
          workingHours: {
            mon: { start: '09:00', end: '18:00' },
            tue: null, // DAY (Salı) klinik kapalı
            wed: { start: '09:00', end: '18:00' },
            thu: { start: '09:00', end: '18:00' },
            fri: { start: '09:00', end: '18:00' },
            sat: null,
            sun: null,
          },
        },
      },
    });
    // Mesaisiz doktor: kapalı gün → 0 slot.
    doctorFindMany.mockResolvedValue([doctorRow({ availabilities: [] })]);
    const closed = await service.freeSlots(query());
    expect(closed.doctors[0].slots).toHaveLength(0);

    // Doktorun kendi açık mesai satırı varsa klinik varsayılanı devre dışı.
    doctorFindMany.mockResolvedValue([doctorRow()]); // Salı 09:00-12:00 mesai
    const open = await service.freeSlots(query());
    expect(open.doctors[0].slots).toHaveLength(12);
  });

  it('#1048: bozuk workingHours JSON sessizce fallback kullanır', async () => {
    tenantFindFirst.mockResolvedValue({
      settings: { scheduling: { workingHours: { mon: { start: '9am', end: 'noon' } } } },
    });
    doctorFindMany.mockResolvedValue([doctorRow({ availabilities: [] })]);
    const { doctors } = await service.freeSlots(query());
    expect(doctors[0].slots).toHaveLength(36); // fallback 09:00-18:00
  });

  it('mesai günü uyuşmazsa slot üretmez (farklı dayOfWeek)', async () => {
    doctorFindMany.mockResolvedValue([
      doctorRow({
        availabilities: [
          { dayOfWeek: (DAY.getDay() + 1) % 7, startTime: '09:00', endTime: '12:00' },
        ],
      }),
    ]);
    const { doctors } = await service.freeSlots(query());
    expect(doctors[0].slots).toHaveLength(0);
  });

  it('durationMinutes=30 slot adımını ve sığmayan kuyruk slotunu doğru işler', async () => {
    doctorFindMany.mockResolvedValue([
      doctorRow({
        availabilities: [{ dayOfWeek: DAY.getDay(), startTime: '09:00', endTime: '10:45' }],
      }),
    ]);
    const { doctors } = await service.freeSlots(query({ durationMinutes: 30 }));
    // 09:00, 09:30, 10:00 — 10:30+30dk pencereye sığmaz.
    expect(doctors[0].slots).toEqual([iso(at(9)), iso(at(9, 30)), iso(at(10))]);
  });

  it('geçmişte kalan aralık boş döner (geçmiş slot önerilmez)', async () => {
    const past = new Date(2020, 5, 1);
    const { doctors } = await service.freeSlots(
      query({
        dateFrom: iso(past),
        dateTo: iso(new Date(2020, 5, 2)),
      }),
    );
    expect(doctors).toEqual([]);
  });

  it('doctorId bulunamazsa NotFoundException fırlatır', async () => {
    doctorFindMany.mockResolvedValue([]);
    await expect(service.freeSlots(query())).rejects.toThrow(NotFoundException);
  });

  it('doctorId verilmezse tüm aktif doktorları tarar ve doluları doktor bazında ayırır', async () => {
    const OTHER_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    doctorFindMany.mockResolvedValue([doctorRow(), doctorRow({ id: OTHER_ID, name: 'Dr. Other' })]);
    appointmentFindMany.mockResolvedValue([
      { doctorId: DOCTOR_ID, startsAt: at(9), endsAt: at(12) }, // ilk doktor full dolu
    ]);
    const { doctors } = await service.freeSlots(query({ doctorId: undefined }));
    expect(doctors).toHaveLength(2);
    expect(doctors.find((d) => d.doctorId === DOCTOR_ID)?.slots).toHaveLength(0);
    expect(doctors.find((d) => d.doctorId === OTHER_ID)?.slots).toHaveLength(12);
  });
});
