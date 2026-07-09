// #420 — Biyometri yapısal alanlar + aralık validasyonu + IOL güç hesabı (MVP).
//
// Klinik güvenlik: serbest JSONB + aralık validasyonu yokken transkripsiyon
// hatası (örn. axial length 2.3 vs 23.0) sessiz geçiyordu. Yapısal alanlar +
// fizyolojik aralık kontrolü + SRK II IOL güç hesabı bunu önler.
//
// NOT (MVP sınırı): SRK II teorik-deneysel 2. nesil formüldür; modern klinik
// Barrett Universal II / SRK/T tercih eder. Bu hesap KARAR DESTEK amaçlıdır,
// cerrahın doğrulaması yerine geçmez. A-sabiti IOL modeline özgüdür.

export interface BiometryRange {
  min: number;
  max: number;
  unit: string;
}

// Fizyolojik aralıklar (insan gözü). Dışı → büyük olasılıkla transkripsiyon hatası.
export const BIOMETRY_RANGES: Record<'axialLength' | 'k1' | 'k2' | 'acd', BiometryRange> = {
  axialLength: { min: 20, max: 30, unit: 'mm' }, // tipik 22-25; <20 mikroftalmi, >30 yüksek miyop
  k1: { min: 35, max: 50, unit: 'D' }, // kornea kırma gücü
  k2: { min: 35, max: 50, unit: 'D' },
  acd: { min: 1.5, max: 5, unit: 'mm' }, // ön kamara derinliği
};

/** Değer aralık içindeyse null, dışındaysa hata anahtarı + aralık döner. */
export function validateBiometryField(
  field: keyof typeof BIOMETRY_RANGES,
  value: number,
): { min: number; max: number; unit: string } | null {
  const r = BIOMETRY_RANGES[field];
  if (Number.isNaN(value) || value < r.min || value > r.max) return r;
  return null;
}

export interface SRK2Input {
  axialLength: number; // mm
  meanK: number; // D (ortalama keratometri = (K1 + K2) / 2)
  aConstant: number; // IOL modeline özgü (tipik 118.0–119.0)
  targetRefraction?: number; // hedef postop sferik eşdeğer (D), default 0 (emetropi)
}

// SRK II A-sabiti axial length'e göre düzeltilir (kısa/uzun göz sapması).
function adjustedAConstant(a: number, al: number): number {
  if (al < 20) return a + 3;
  if (al < 21) return a + 2;
  if (al < 22) return a + 1;
  if (al < 24.5) return a;
  return a - 0.5;
}

/**
 * SRK II emetropi IOL gücü:  P = A_adj − 0.9·K − 2.5·AL
 * Hedef refraksiyon varsa düzeltme katsayısı (CR) ile ametropi gücü hesaplanır:
 *   CR = 1.0 (P > 14) ya da 1.25 (P ≤ 14);  P_target = P_emm − refraction·CR
 * Girdi aralık dışıysa null (hesap güvenilmez).
 */
export function calculateIolPowerSRK2(input: SRK2Input): number | null {
  const { axialLength, meanK, aConstant, targetRefraction = 0 } = input;
  if (
    validateBiometryField('axialLength', axialLength) ||
    meanK < BIOMETRY_RANGES.k1.min ||
    meanK > BIOMETRY_RANGES.k1.max ||
    Number.isNaN(aConstant)
  ) {
    return null;
  }
  const aAdj = adjustedAConstant(aConstant, axialLength);
  const emmetropiaPower = aAdj - 0.9 * meanK - 2.5 * axialLength;
  if (targetRefraction === 0) return round2(emmetropiaPower);
  const correctionRatio = emmetropiaPower > 14 ? 1.0 : 1.25;
  return round2(emmetropiaPower - targetRefraction * correctionRatio);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
