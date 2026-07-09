// S15-PR3 — Frontend mirror; apps/api/src/surgery/safety-checklist.constants.ts
// ile aynı phase/itemKey sırası. UI yalnız tip yardımı + bilinen item key
// listesi için kullanır; gerçek item kataloğu tRPC ile çekilir
// (surgery.safetyChecklist.catalog).

export const SAFETY_PHASES = ['sign_in', 'time_out', 'sign_out'] as const;
export type SafetyChecklistPhase = (typeof SAFETY_PHASES)[number];

export interface SafetyChecklistItem {
  key: string;
  phase: SafetyChecklistPhase;
  required: boolean;
  i18nLabelKey: string;
}

export interface SafetyItemState {
  confirmed: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
  notes: string | null;
}

export interface SafetyChecklistResponse {
  id: string;
  surgeryId: string;
  items: Record<string, SafetyItemState>;
  phaseStatus: {
    sign_in: { complete: boolean; completedAt: string | null; completedBy: string | null };
    time_out: { complete: boolean; completedAt: string | null; completedBy: string | null };
    sign_out: { complete: boolean; completedAt: string | null; completedBy: string | null };
  };
  fullyComplete: boolean;
}

export function itemMapKey(item: { phase: string; key: string }): string {
  return `${item.phase}.${item.key}`;
}
