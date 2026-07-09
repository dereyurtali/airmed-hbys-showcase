// S15 — Encounter (ziyaret akışı) backend constants.
//
// Frontend aynası: apps/web/src/lib/encounter.constants.ts (ENCOUNTER_STAGE_TRANSITIONS
// + ENCOUNTER_STAGE_META). appointment.constants.ts deseni gibi kasıtlı duplikasyon —
// web bundle'ı api package'ı runtime import etmesin diye; eşitlik kod review ile korunur.

import type { EncounterStage } from '@airmed/db';

export const ENCOUNTER_STAGES: readonly EncounterStage[] = [
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
  'emergency_bypass',
] as const;

// İstasyon state machine. Ödeme istasyonları (awaiting_*) kapılıdır:
//  - awaiting_exam_payment → waiting_doctor: assertPaidSession(patientId,'examination')
//  - awaiting_measurement_payment → in_measurement: assertPaidSession(patientId,'measurement')
// Bu kapılar EncounterService.advance içinde uygulanır; transition tablosu yalnız
// hangi geçişlerin yasal olduğunu söyler.
export const ENCOUNTER_STAGE_TRANSITIONS: Record<EncounterStage, readonly EncounterStage[]> = {
  registered: ['awaiting_exam_payment', 'waiting_doctor', 'cancelled'],
  awaiting_exam_payment: ['waiting_doctor', 'cancelled'],
  waiting_doctor: ['in_exam', 'cancelled'],
  in_exam: [
    'awaiting_measurement_payment',
    'in_measurement',
    'awaiting_surgery_sales',
    'done',
    'cancelled',
  ],
  awaiting_measurement_payment: ['in_measurement', 'cancelled'],
  in_measurement: ['measurement_ready', 'cancelled'],
  measurement_ready: ['in_exam', 'awaiting_surgery_sales', 'done', 'cancelled'],
  awaiting_surgery_sales: ['in_exam', 'done', 'cancelled'],
  done: [],
  cancelled: [],
  // S15-PR5 — Break Glass advance() ile yönetilmez; activateEmergencyBypass/
  // closeEmergencyBypass servis metodları doğrudan stage'i ayarlar. Tablo
  // sadece "buradan geri normal akışa hangi stage'lere dönülebilir" listesi.
  emergency_bypass: ['done', 'cancelled', 'waiting_doctor', 'in_exam'],
};

export function isLegalStageTransition(from: EncounterStage, to: EncounterStage): boolean {
  return ENCOUNTER_STAGE_TRANSITIONS[from].includes(to);
}

// Doktor iş kuyruğunda (worklist) görünen aktif istasyonlar — ödenmiş + doktora
// düşmüş hastalar. awaiting_exam_payment/registered (resepsiyon tarafı) ve
// terminal (done/cancelled) hariç.
export const DOCTOR_WORKLIST_STAGES: readonly EncounterStage[] = [
  'waiting_doctor',
  'in_exam',
  'awaiting_measurement_payment',
  'in_measurement',
  'measurement_ready',
  'awaiting_surgery_sales',
] as const;
