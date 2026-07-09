import { z } from 'zod';

// S15 — Encounter (ziyaret akışı) tRPC input şemaları.

export const ENCOUNTER_STAGE_VALUES = [
  'registered',
  'awaiting_exam_payment',
  'waiting_doctor',
  'in_exam',
  'awaiting_measurement_payment',
  'in_measurement',
  'measurement_ready',
  'awaiting_surgery_sales',
  'done',
  'cancelled',
] as const;

// Madde 6 — hasta ilk istasyon seçimi: ölçüm odası varsayılan, doktor odası
// alternatif. Walk-in (randevusuz) akışta resepsiyon karar verir; randevu
// check-in'inde varsayılan 'examination' (eski davranış).
export const INITIAL_STATIONS = ['measurement', 'examination'] as const;
export const initialStationSchema = z.enum(INITIAL_STATIONS);
export type InitialStation = z.infer<typeof initialStationSchema>;

export const encounterOpenSchema = z.object({
  patientId: z.string().uuid(),
  appointmentId: z.string().uuid().optional().nullable(),
  doctorId: z.string().uuid().optional().nullable(),
  initialStation: initialStationSchema.optional(),
});
export type EncounterOpenInput = z.infer<typeof encounterOpenSchema>;

export const encounterAdvanceSchema = z.object({
  id: z.string().uuid(),
  toStage: z.enum(ENCOUNTER_STAGE_VALUES),
});
export type EncounterAdvanceInput = z.infer<typeof encounterAdvanceSchema>;

// "Muayeneye başla" — randevudan köprü (randevu → in_exam).
export const encounterStartExamSchema = z.object({
  appointmentId: z.string().uuid(),
});
export type EncounterStartExamInput = z.infer<typeof encounterStartExamSchema>;

// Doktor iş kuyruğu sorgusu. Client doctorId GÖNDERMEZ; sunucu ctx.user.sub'tan
// türetir. doctorId yalnız admin override için (yönetici başka doktorun kuyruğu).
export const encounterWorklistQuerySchema = z.object({
  date: z.string().datetime().optional(),
  doctorId: z.string().uuid().optional(),
});
export type EncounterWorklistQuery = z.infer<typeof encounterWorklistQuerySchema>;
