// S15-PR3 — WHO Surgical Safety Checklist for Cataract Surgery.
//
// Kaynak: WHO Surgical Safety Checklist (2009 revision) + International
// Council of Ophthalmology (ICO) oftalmoloji uyarlaması. 21 item / 3 faz.
//
// Frontend mirror: apps/web/src/lib/safety-checklist.constants.ts (i18n
// label çağrıları aynı item key'leri kullanır; mirror eşitliği kod review
// ile korunur).

export type SafetyChecklistPhase = 'sign_in' | 'time_out' | 'sign_out';

export interface SafetyChecklistItem {
  /** Unique stable key, items JSON map index'i; phase prefix ile birlikte
   *  `<phase>.<itemKey>` formatında saklanır. */
  key: string;
  phase: SafetyChecklistPhase;
  /** Bu item phase complete olmak için zorunlu mu? Çoğu zorunlu; "comments"
   *  veya "X varsa not al" tipi opsiyonel item'lar false işaretli. */
  required: boolean;
  /** i18n key (apps/web/src/i18n/locales/safety.*.json). */
  i18nLabelKey: string;
}

// Sign In — Anestezi öncesi (hasta odadayken).
const SIGN_IN: SafetyChecklistItem[] = [
  {
    key: 'patient_identity',
    phase: 'sign_in',
    required: true,
    i18nLabelKey: 'safety:items.signIn.patientIdentity',
  },
  {
    key: 'site_marked',
    phase: 'sign_in',
    required: true,
    i18nLabelKey: 'safety:items.signIn.siteMarked',
  },
  {
    key: 'anesthesia_safety_check',
    phase: 'sign_in',
    required: true,
    i18nLabelKey: 'safety:items.signIn.anesthesiaSafetyCheck',
  },
  {
    key: 'pulse_oximeter',
    phase: 'sign_in',
    required: true,
    i18nLabelKey: 'safety:items.signIn.pulseOximeter',
  },
  {
    key: 'allergies_known',
    phase: 'sign_in',
    required: true,
    i18nLabelKey: 'safety:items.signIn.allergiesKnown',
  },
  {
    key: 'difficult_airway_risk',
    phase: 'sign_in',
    required: true,
    i18nLabelKey: 'safety:items.signIn.difficultAirwayRisk',
  },
  {
    key: 'blood_loss_risk',
    phase: 'sign_in',
    required: true,
    i18nLabelKey: 'safety:items.signIn.bloodLossRisk',
  },
];

// Time Out — İnsizyon öncesi son durak (tüm ekip ameliyathanede).
const TIME_OUT: SafetyChecklistItem[] = [
  {
    key: 'team_introduced',
    phase: 'time_out',
    required: true,
    i18nLabelKey: 'safety:items.timeOut.teamIntroduced',
  },
  {
    key: 'patient_procedure_site_confirmed',
    phase: 'time_out',
    required: true,
    i18nLabelKey: 'safety:items.timeOut.patientProcedureSiteConfirmed',
  },
  {
    key: 'surgeon_critical_steps',
    phase: 'time_out',
    required: true,
    i18nLabelKey: 'safety:items.timeOut.surgeonCriticalSteps',
  },
  {
    key: 'anesthesia_patient_specific',
    phase: 'time_out',
    required: true,
    i18nLabelKey: 'safety:items.timeOut.anesthesiaPatientSpecific',
  },
  {
    key: 'nursing_sterility_equipment',
    phase: 'time_out',
    required: true,
    i18nLabelKey: 'safety:items.timeOut.nursingSterilityEquipment',
  },
  {
    key: 'antibiotic_prophylaxis',
    phase: 'time_out',
    required: true,
    i18nLabelKey: 'safety:items.timeOut.antibioticProphylaxis',
  },
  {
    key: 'imaging_displayed',
    phase: 'time_out',
    required: false,
    i18nLabelKey: 'safety:items.timeOut.imagingDisplayed',
  },
  // ICO oftalmoloji eki — lens implant + göz tarafı son kontrol.
  {
    key: 'iol_lot_verified',
    phase: 'time_out',
    required: true,
    i18nLabelKey: 'safety:items.timeOut.iolLotVerified',
  },
  {
    key: 'eye_side_final_check',
    phase: 'time_out',
    required: true,
    i18nLabelKey: 'safety:items.timeOut.eyeSideFinalCheck',
  },
];

// Sign Out — Kapanış öncesi (drape kalkmadan).
const SIGN_OUT: SafetyChecklistItem[] = [
  {
    key: 'procedure_recorded',
    phase: 'sign_out',
    required: true,
    i18nLabelKey: 'safety:items.signOut.procedureRecorded',
  },
  {
    key: 'instrument_count',
    phase: 'sign_out',
    required: true,
    i18nLabelKey: 'safety:items.signOut.instrumentCount',
  },
  {
    key: 'specimen_labeled',
    phase: 'sign_out',
    required: false,
    i18nLabelKey: 'safety:items.signOut.specimenLabeled',
  },
  {
    key: 'equipment_issues',
    phase: 'sign_out',
    required: true,
    i18nLabelKey: 'safety:items.signOut.equipmentIssues',
  },
  {
    key: 'post_op_plan_discussed',
    phase: 'sign_out',
    required: true,
    i18nLabelKey: 'safety:items.signOut.postOpPlanDiscussed',
  },
];

export const SAFETY_CHECKLIST_ITEMS: readonly SafetyChecklistItem[] = [
  ...SIGN_IN,
  ...TIME_OUT,
  ...SIGN_OUT,
] as const;

export const SAFETY_CHECKLIST_ITEMS_BY_PHASE: Record<
  SafetyChecklistPhase,
  readonly SafetyChecklistItem[]
> = {
  sign_in: SIGN_IN,
  time_out: TIME_OUT,
  sign_out: SIGN_OUT,
};

export const SAFETY_CHECKLIST_PHASES: readonly SafetyChecklistPhase[] = [
  'sign_in',
  'time_out',
  'sign_out',
] as const;

/** Bir item'in items JSON map'inde tutulduğu key. */
export function itemMapKey(item: SafetyChecklistItem): string {
  return `${item.phase}.${item.key}`;
}

export interface SafetyItemState {
  confirmed: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
  notes: string | null;
}

export function emptyItemState(): SafetyItemState {
  return { confirmed: false, confirmedBy: null, confirmedAt: null, notes: null };
}

/** Phase için tüm zorunlu item'lar dolu mu? */
export function isPhaseRequiredComplete(
  phase: SafetyChecklistPhase,
  items: Record<string, SafetyItemState>,
): boolean {
  return SAFETY_CHECKLIST_ITEMS_BY_PHASE[phase]
    .filter((it) => it.required)
    .every((it) => items[itemMapKey(it)]?.confirmed === true);
}
