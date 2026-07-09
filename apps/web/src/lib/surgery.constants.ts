// A8 ameliyat — frontend constants.
//
// preOp / intraOp / postOp JSONB: göz cerrahisi için temel alanlar. Backend
// record<unknown> kabul ediyor; frontend bu shape'i form için sabitler.
// B1'de derinleşir (OD/OS, anestezi tipi, lens model, sarf listesi).

export type SurgeryStatus = 'planned' | 'performed' | 'cancelled' | 'postponed';

export const SURGERY_STATUSES: SurgeryStatus[] = ['planned', 'performed', 'cancelled', 'postponed'];

export interface SurgeryPreOp {
  laterality?: 'OD' | 'OS' | 'OU'; // sağ / sol / iki göz
  anesthesia?: string; // topical / local / general
  lens?: string; // IOL model
  notes?: string;
}

export interface SurgeryIntraOp {
  duration?: string; // dk
  technique?: string;
  notes?: string;
}

export interface SurgeryPostOp {
  immediate?: string; // ameliyat sonrası ilk gözlem
  medications?: string; // damla protokolü
  notes?: string;
}

export const PRE_OP_FIELDS = ['laterality', 'anesthesia', 'lens', 'notes'] as const;
export const INTRA_OP_FIELDS = ['duration', 'technique', 'notes'] as const;
export const POST_OP_FIELDS = ['immediate', 'medications', 'notes'] as const;

export type PreOpField = (typeof PRE_OP_FIELDS)[number];
export type IntraOpField = (typeof INTRA_OP_FIELDS)[number];
export type PostOpField = (typeof POST_OP_FIELDS)[number];

export const SAME_DAY_WINDOW_HOURS = 24;

// Same-day window — sadece performedAt set edildiyse uygulanır. Status hala
// "planned" ise (performedAt null) pencere yok.
export function isWithinSameDayWindow(performedAt: Date | string | null): boolean {
  if (!performedAt) return true; // planned surgery → no window
  const d = typeof performedAt === 'string' ? new Date(performedAt) : performedAt;
  const ageMs = Date.now() - d.getTime();
  return ageMs < SAME_DAY_WINDOW_HOURS * 60 * 60 * 1000;
}
