import { z } from 'zod';
import { leadSourceSchema } from '../patient/patient.schemas';

// Mirrors `enum AppointmentType` in schema.prisma. Order matches the spec's
// type-color mapping (see gelistirme-plani/03-moduller/A-cekirdek/A6-randevu-takvimi.md
// lines 21-30) so the frontend's enum lookup table reads top-to-bottom.
export const APPOINTMENT_TYPES = [
  'consultation',
  'surgery',
  'control',
  'injection',
  'laser',
  'examination',
  'pre_op',
  'post_op',
] as const;

// Randevu check-in varsayılan istasyonu (tipe göre). Girişimsel tipler
// (surgery/injection/laser) doğrudan doktora; muayene/kontrol ve oto-üretilen
// takipler (examination/pre_op/post_op) ölçüme. Resepsiyon ölçüm-default
// tipleri check-in'de doktora override edebilir (checkIn initialStation).
// Frontend aynası: apps/web/src/lib/appointment.constants.ts (CHECKIN_MEASUREMENT_DEFAULT_TYPES).
export const CHECKIN_STATION_BY_TYPE: Record<
  (typeof APPOINTMENT_TYPES)[number],
  'measurement' | 'examination'
> = {
  consultation: 'measurement',
  control: 'measurement',
  surgery: 'examination',
  injection: 'examination',
  laser: 'examination',
  examination: 'measurement',
  pre_op: 'measurement',
  post_op: 'measurement',
};

// Mirrors `enum AppointmentStatus` in schema.prisma. Matches the A6 state
// machine exactly: scheduled → checked_in → in_progress → completed
// (terminal) | cancelled (terminal) | no_show (terminal).
export const APPOINTMENT_STATUSES = [
  'scheduled',
  'checked_in',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
] as const;

const isoDateTime = z.string().datetime({ offset: true });

export const appointmentCreateSchema = z
  .object({
    patientId: z.string().uuid(),
    // #367 — Doktorsuz "genel randevu" (havuz): null/atlanırsa müsait doktora
    // check-in'de atanır.
    doctorId: z.string().uuid().optional().nullable(),
    type: z.enum(APPOINTMENT_TYPES).default('consultation'),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    notes: z.string().max(2000).optional().nullable(),
    // #378 — Randevu geliş kanalı (LeadFunnel raporu için).
    source: leadSourceSchema.optional().nullable(),
  })
  .refine((v) => new Date(v.startsAt) < new Date(v.endsAt), {
    message: 'startsAt must be before endsAt',
    path: ['endsAt'],
  });

export const appointmentUpdateSchema = z
  .object({
    type: z.enum(APPOINTMENT_TYPES).optional(),
    startsAt: isoDateTime.optional(),
    endsAt: isoDateTime.optional(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .refine(
    (v) =>
      v.startsAt === undefined ||
      v.endsAt === undefined ||
      new Date(v.startsAt) < new Date(v.endsAt),
    { message: 'startsAt must be before endsAt', path: ['endsAt'] },
  );

export const appointmentListQuerySchema = z.object({
  doctorId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  type: z.enum(APPOINTMENT_TYPES).optional(),
  dateFrom: isoDateTime.optional(),
  dateTo: isoDateTime.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

// Calendar view: fetch every appointment overlapping [dateFrom, dateTo).
// Doctor filter is optional — the daily view is per-doctor, the weekly
// view aggregates across doctors.
export const appointmentRangeQuerySchema = z
  .object({
    doctorId: z.string().uuid().optional(),
    dateFrom: isoDateTime,
    dateTo: isoDateTime,
  })
  .refine((v) => new Date(v.dateFrom) < new Date(v.dateTo), {
    message: 'dateFrom must be before dateTo',
    path: ['dateTo'],
  });

export type AppointmentCreateInput = z.infer<typeof appointmentCreateSchema>;
export type AppointmentUpdateInput = z.infer<typeof appointmentUpdateSchema>;
export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;
export type AppointmentRangeQuery = z.infer<typeof appointmentRangeQuerySchema>;
