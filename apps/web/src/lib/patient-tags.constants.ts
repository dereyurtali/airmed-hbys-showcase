// E4 patient tags — frontend sabitleri.

export const PATIENT_TAGS = [
  'vip',
  'risk_high',
  'risk_low',
  'follow_up',
  'chronic',
  'no_show_risk',
  'insurance',
  'pediatric',
  'geriatric',
] as const;

export type PatientTag = (typeof PATIENT_TAGS)[number];

// Tag → renk eşlemesi (Tailwind sınıfı kombosu).
export const TAG_COLOR: Record<PatientTag, string> = {
  vip: 'bg-amber-100 text-amber-900 border-amber-300',
  risk_high: 'bg-red-100 text-red-900 border-red-300',
  risk_low: 'bg-orange-100 text-orange-900 border-orange-300',
  follow_up: 'bg-blue-100 text-blue-900 border-blue-300',
  chronic: 'bg-purple-100 text-purple-900 border-purple-300',
  no_show_risk: 'bg-rose-100 text-rose-900 border-rose-300',
  insurance: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  pediatric: 'bg-sky-100 text-sky-900 border-sky-300',
  geriatric: 'bg-slate-100 text-slate-900 border-slate-300',
};
