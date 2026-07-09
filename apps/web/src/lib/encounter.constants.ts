// S15 — Encounter (ziyaret akışı / istasyon yolculuğu) frontend constants.
//
// Backend aynası (bire bir uyum gerekir):
// - ENCOUNTER_STAGES, ENCOUNTER_STAGE_TRANSITIONS → apps/api/src/encounter/encounter.constants.ts
//
// appointment.constants.ts deseni gibi: backend'den runtime import etmiyoruz
// (web bundle api package'ı import etmesin). Eşitliği kod review ile koruyoruz.

import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock,
  CreditCard,
  Ruler,
  Scissors,
  Stethoscope,
  UserPlus,
  Wallet,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

export const ENCOUNTER_STAGES = [
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

export type EncounterStage = (typeof ENCOUNTER_STAGES)[number];

export interface EncounterStageMeta {
  badge: string; // chip class
  icon: LucideIcon;
  labelKey: string; // i18n: encounter:stage.<key>
}

export const ENCOUNTER_STAGE_META: Record<EncounterStage, EncounterStageMeta> = {
  registered: {
    badge: 'bg-slate-100 text-slate-700',
    icon: UserPlus,
    labelKey: 'stage.registered',
  },
  awaiting_exam_payment: {
    badge: 'bg-amber-100 text-amber-700',
    icon: Wallet,
    labelKey: 'stage.awaitingExamPayment',
  },
  waiting_doctor: {
    badge: 'bg-blue-100 text-blue-700',
    icon: Clock,
    labelKey: 'stage.waitingDoctor',
  },
  in_exam: {
    badge: 'bg-indigo-100 text-indigo-700',
    icon: Stethoscope,
    labelKey: 'stage.inExam',
  },
  awaiting_measurement_payment: {
    badge: 'bg-orange-100 text-orange-700',
    icon: CreditCard,
    labelKey: 'stage.awaitingMeasurementPayment',
  },
  in_measurement: {
    badge: 'bg-cyan-100 text-cyan-700',
    icon: Ruler,
    labelKey: 'stage.inMeasurement',
  },
  measurement_ready: {
    badge: 'bg-emerald-100 text-emerald-700',
    icon: BellRing,
    labelKey: 'stage.measurementReady',
  },
  awaiting_surgery_sales: {
    badge: 'bg-rose-100 text-rose-700',
    icon: Scissors,
    labelKey: 'stage.awaitingSurgerySales',
  },
  done: {
    badge: 'bg-zinc-100 text-zinc-500',
    icon: CheckCircle2,
    labelKey: 'stage.done',
  },
  cancelled: {
    badge: 'bg-zinc-100 text-zinc-400',
    icon: XCircle,
    labelKey: 'stage.cancelled',
  },
  // S15-PR5 — Break Glass acil bypass; UI'da kırmızı bayrak ile vurgulanır.
  emergency_bypass: {
    badge: 'bg-amber-100 text-amber-800 border border-amber-400',
    icon: AlertTriangle,
    labelKey: 'stage.emergencyBypass',
  },
};

// State machine — backend encounter.constants.ts ile bire bir.
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
  emergency_bypass: ['done', 'cancelled', 'waiting_doctor', 'in_exam'],
};

export function isLegalStageTransition(from: EncounterStage, to: EncounterStage): boolean {
  return ENCOUNTER_STAGE_TRANSITIONS[from].includes(to);
}

// Doktor iş kuyruğunda görünen aktif istasyonlar (ödenmiş + doktora düşmüş).
export const DOCTOR_WORKLIST_STAGES: readonly EncounterStage[] = [
  'waiting_doctor',
  'in_exam',
  'awaiting_measurement_payment',
  'in_measurement',
  'measurement_ready',
  'awaiting_surgery_sales',
] as const;
