import { describe, expect, it } from 'vitest';
import { filterLeavesForDay, findLeaveOverlap, packDayAppointments } from './schedule.utils';

interface Leave {
  id: string;
  startsAt: Date;
  endsAt: Date;
}

const leave = (id: string, startsAt: string, endsAt: string): Leave => ({
  id,
  startsAt: new Date(startsAt),
  endsAt: new Date(endsAt),
});

describe('findLeaveOverlap', () => {
  const leaves: Leave[] = [leave('L1', '2026-06-01T09:00:00Z', '2026-06-01T12:00:00Z')];

  it('slot fully inside leave window → match', () => {
    const slotStart = new Date('2026-06-01T10:00:00Z');
    const slotEnd = new Date('2026-06-01T10:30:00Z');
    expect(findLeaveOverlap(slotStart, slotEnd, leaves)?.id).toBe('L1');
  });

  it('slot ending at leave start → no match (endsAt exclusive)', () => {
    const slotStart = new Date('2026-06-01T08:30:00Z');
    const slotEnd = new Date('2026-06-01T09:00:00Z');
    expect(findLeaveOverlap(slotStart, slotEnd, leaves)).toBeUndefined();
  });

  it('slot starting at leave end → no match', () => {
    const slotStart = new Date('2026-06-01T12:00:00Z');
    const slotEnd = new Date('2026-06-01T12:30:00Z');
    expect(findLeaveOverlap(slotStart, slotEnd, leaves)).toBeUndefined();
  });

  it('slot partially overlapping leave start → match', () => {
    const slotStart = new Date('2026-06-01T08:45:00Z');
    const slotEnd = new Date('2026-06-01T09:15:00Z');
    expect(findLeaveOverlap(slotStart, slotEnd, leaves)?.id).toBe('L1');
  });

  it('empty / undefined leaves → undefined', () => {
    const slotStart = new Date('2026-06-01T10:00:00Z');
    const slotEnd = new Date('2026-06-01T10:30:00Z');
    expect(findLeaveOverlap(slotStart, slotEnd, [])).toBeUndefined();
    expect(findLeaveOverlap(slotStart, slotEnd, undefined)).toBeUndefined();
  });
});

describe('filterLeavesForDay', () => {
  const multiDayLeave = leave('L_MULTI', '2026-06-01T15:00:00Z', '2026-06-03T09:00:00Z');
  const singleDayLeave = leave('L_SINGLE', '2026-06-05T10:00:00Z', '2026-06-05T14:00:00Z');
  const all = [multiDayLeave, singleDayLeave];

  it('multi-day leave appears in each spanned day', () => {
    expect(filterLeavesForDay(all, new Date('2026-06-01T08:00:00')).map((l) => l.id)).toContain(
      'L_MULTI',
    );
    expect(filterLeavesForDay(all, new Date('2026-06-02T08:00:00')).map((l) => l.id)).toContain(
      'L_MULTI',
    );
    expect(filterLeavesForDay(all, new Date('2026-06-03T08:00:00')).map((l) => l.id)).toContain(
      'L_MULTI',
    );
  });

  it('day outside any leave → empty', () => {
    expect(filterLeavesForDay(all, new Date('2026-06-04T08:00:00'))).toEqual([]);
  });

  it('single-day leave matched only on that day', () => {
    expect(filterLeavesForDay(all, new Date('2026-06-05T08:00:00')).map((l) => l.id)).toEqual([
      'L_SINGLE',
    ]);
    expect(filterLeavesForDay(all, new Date('2026-06-06T08:00:00'))).toEqual([]);
  });
});

describe('packDayAppointments (#394 çakışan randevu sütun-paketleme)', () => {
  interface Appt {
    id: string;
    startsAt: Date;
    endsAt: Date;
  }
  const appt = (id: string, start: string, end: string): Appt => ({
    id,
    startsAt: new Date(start),
    endsAt: new Date(end),
  });
  const byId = (packed: { item: Appt; col: number; cols: number }[]) =>
    Object.fromEntries(packed.map((p) => [p.item.id, { col: p.col, cols: p.cols }]));

  it('ardışık çakışmayan randevular → hepsi tek sütun', () => {
    const r = byId(
      packDayAppointments([
        appt('A', '2026-06-01T10:00:00', '2026-06-01T10:30:00'),
        appt('B', '2026-06-01T11:00:00', '2026-06-01T11:30:00'),
      ]),
    );
    expect(r.A).toEqual({ col: 0, cols: 1 });
    expect(r.B).toEqual({ col: 0, cols: 1 });
  });

  it('aynı saatte 3 doktor → 3 sütun, hepsi görünür', () => {
    const r = byId(
      packDayAppointments([
        appt('A', '2026-06-01T10:00:00', '2026-06-01T10:30:00'),
        appt('B', '2026-06-01T10:00:00', '2026-06-01T10:30:00'),
        appt('C', '2026-06-01T10:00:00', '2026-06-01T10:30:00'),
      ]),
    );
    expect([r.A.cols, r.B.cols, r.C.cols]).toEqual([3, 3, 3]);
    expect([r.A.col, r.B.col, r.C.col].sort()).toEqual([0, 1, 2]);
  });

  it('çakışan çift + ayrık üçüncü → küme bağımsız sütunlanır', () => {
    const r = byId(
      packDayAppointments([
        appt('A', '2026-06-01T10:00:00', '2026-06-01T10:30:00'),
        appt('B', '2026-06-01T10:00:00', '2026-06-01T10:30:00'),
        appt('C', '2026-06-01T11:00:00', '2026-06-01T11:30:00'),
      ]),
    );
    expect(r.A.cols).toBe(2);
    expect(r.B.cols).toBe(2);
    expect(r.C).toEqual({ col: 0, cols: 1 });
  });

  it('merdiven örtüşme → sütun tekrar kullanımı', () => {
    const r = byId(
      packDayAppointments([
        appt('A', '2026-06-01T10:00:00', '2026-06-01T11:00:00'),
        appt('B', '2026-06-01T10:30:00', '2026-06-01T11:30:00'),
        appt('C', '2026-06-01T11:00:00', '2026-06-01T12:00:00'),
      ]),
    );
    expect(r.A).toEqual({ col: 0, cols: 2 });
    expect(r.B).toEqual({ col: 1, cols: 2 });
    expect(r.C.col).toBe(0);
  });
});
