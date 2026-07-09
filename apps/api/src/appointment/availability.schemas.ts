import { z } from 'zod';

const isoDateTime = z.string().datetime({ offset: true });

const MAX_RANGE_DAYS = 31;

// #1019 — Boş-slot sorgusu. doctorId verilmezse aktif tüm doktorlar taranır
// (agent "en erken müsait doktor" için kullanır). Aralık 31 günle sınırlı:
// slot üretimi gün×doktor×slot kombinasyonu — sınırsız aralık payload'ı ve
// sorguyu şişirir; takvim UI'ı da haftalık/aylık pencereyle çalışır.
export const freeSlotsQuerySchema = z
  .object({
    doctorId: z.string().uuid().optional(),
    dateFrom: isoDateTime,
    dateTo: isoDateTime,
    durationMinutes: z.number().int().multipleOf(5).min(5).max(240).default(15),
  })
  .refine((v) => new Date(v.dateFrom) < new Date(v.dateTo), {
    message: 'dateFrom must be before dateTo',
    path: ['dateTo'],
  })
  .refine(
    (v) =>
      new Date(v.dateTo).getTime() - new Date(v.dateFrom).getTime() <=
      MAX_RANGE_DAYS * 24 * 60 * 60 * 1000,
    { message: `range must be at most ${MAX_RANGE_DAYS} days`, path: ['dateTo'] },
  );

export type FreeSlotsQuery = z.infer<typeof freeSlotsQuerySchema>;

export interface DoctorFreeSlots {
  doctorId: string;
  name: string;
  specialty: string;
  // ISO 8601, artan sırada; her slot [startsAt, startsAt+durationMinutes).
  slots: string[];
}
