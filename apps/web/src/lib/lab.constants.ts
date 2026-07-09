// B2 Tetkik (Lab) — frontend sabitleri + helper'lar.

export const LAB_TEST_TYPES = [
  'visual_field',
  'oct_macula',
  'oct_optic_nerve',
  'topography',
  'pachymetry',
  'biometry',
  'fluorescein_angiography',
  'iop_curve',
  'blood_test',
  'ekg',
  'chest_xray',
  'urinalysis',
  'other',
] as const;
export type LabTestType = (typeof LAB_TEST_TYPES)[number];

export const LAB_TEST_SOURCES = ['internal', 'external'] as const;
export type LabTestSource = (typeof LAB_TEST_SOURCES)[number];

// Oftalmik testler: klinik içi yapılır.
const OPHTHALMIC_TYPES: ReadonlySet<LabTestType> = new Set([
  'visual_field',
  'oct_macula',
  'oct_optic_nerve',
  'topography',
  'pachymetry',
  'biometry',
  'fluorescein_angiography',
  'iop_curve',
]);

export function isOphthalmicType(type: LabTestType): boolean {
  return OPHTHALMIC_TYPES.has(type);
}

export const SAME_DAY_WINDOW_HOURS = 24;

export function isWithinSameDayWindow(createdAt: string | Date): boolean {
  const t = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  const hoursElapsed = (Date.now() - t.getTime()) / (1000 * 60 * 60);
  return hoursElapsed <= SAME_DAY_WINDOW_HOURS;
}

// External tetkikte ek dosya MIME whitelist (UI tarafı, sunucu da kontrol eder).
export const ACCEPT_FILE_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

// Sonuç özeti — JSONB içeriğini tabloda kısa gösterimek için.
export function summarizeResults(
  type: LabTestType,
  results: unknown,
  notes: string | null,
): string {
  if (results && typeof results === 'object') {
    const r = results as Record<string, unknown>;
    const parts: string[] = [];
    if (type === 'iop_curve') {
      if (r.od != null) parts.push(`OD ${r.od}`);
      if (r.os != null) parts.push(`OS ${r.os}`);
    } else if (type === 'visual_field') {
      if (r.md != null) parts.push(`MD ${r.md}`);
      if (r.psd != null) parts.push(`PSD ${r.psd}`);
    } else if (type === 'pachymetry') {
      if (r.od != null) parts.push(`OD ${r.od}µm`);
      if (r.os != null) parts.push(`OS ${r.os}µm`);
    } else if (type === 'biometry') {
      if (r.axialLengthOd != null) parts.push(`AL-OD ${r.axialLengthOd}`);
      if (r.axialLengthOs != null) parts.push(`AL-OS ${r.axialLengthOs}`);
    }
    if (parts.length > 0) return parts.join(' / ');
  }
  if (notes && notes.length > 0) return notes.length > 80 ? notes.slice(0, 80) + '…' : notes;
  return '—';
}
