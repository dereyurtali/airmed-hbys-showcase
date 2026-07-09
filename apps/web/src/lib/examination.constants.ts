// A7 muayene — frontend constants.
//
// Findings JSONB: göz spesifik 4 alan ile başlıyoruz. Backend record<unknown>
// kabul ediyor; frontend bu shape'i form için sabitler. İleri faza yapılandırılır.

export interface ExaminationFindings {
  odVa?: string; // OD görme keskinliği (sağ göz, "0.8" veya "20/25")
  osVa?: string; // OS görme keskinliği (sol göz)
  anteriorSegment?: string; // ön segment notu
  fundus?: string; // fundus notu
}

export const FINDINGS_FIELDS = ['odVa', 'osVa', 'anteriorSegment', 'fundus'] as const;
export type FindingsField = (typeof FINDINGS_FIELDS)[number];

export const SAME_DAY_WINDOW_HOURS = 24;

// Aynı gün düzenleme penceresi kontrolü. Backend de bu kuralı uygular —
// frontend disabled state için.
export function isWithinSameDayWindow(examinedAt: Date | string): boolean {
  const d = typeof examinedAt === 'string' ? new Date(examinedAt) : examinedAt;
  const ageMs = Date.now() - d.getTime();
  return ageMs < SAME_DAY_WINDOW_HOURS * 60 * 60 * 1000;
}
