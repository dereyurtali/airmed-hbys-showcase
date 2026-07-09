import { z } from 'zod';

// R1 (#723) — Kalıcı klinik problem + ilaç listesi (EHR problem list). Reçete /
// muayene tanısından bağımsız, hasta seviyesinde sürekli izlenen kayıtlar.

export const problemCreateSchema = z.object({
  patientId: z.string().uuid(),
  description: z.string().trim().min(1).max(300),
  icd10: z.string().trim().max(20).optional(),
  onsetDate: z.string().datetime().optional(),
});
export type ProblemCreateInput = z.infer<typeof problemCreateSchema>;

export const medicationCreateSchema = z.object({
  patientId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  dose: z.string().trim().max(80).optional(),
  frequency: z.string().trim().max(80).optional(),
  startedAt: z.string().datetime().optional(),
});
export type MedicationCreateInput = z.infer<typeof medicationCreateSchema>;

export const byPatientSchema = z.object({ patientId: z.string().uuid() });
export const byIdSchema = z.object({ id: z.string().uuid() });
