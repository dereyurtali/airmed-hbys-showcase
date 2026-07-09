// Ortak PII redaksiyon primitifleri — EPIC #812 / I1.1 (#813).
//
// İki kullanım:
//   1. `scrubText` — serbest-metin alanları (hata mesajı, breadcrumb, GitHub
//      issue gövdesi) içindeki PII'yi maskeler. Allowlist DEĞİL; bilinen PII
//      desenlerini token'a indirger. Yapısal allowlist (scrubber.ts) birincil
//      savunma; bu, allowlist'ten geçen serbest metin için ikinci ağdır.
//   2. `routePattern` — URL/transaction path'lerindeki kimlik değerlerini
//      (`:id`) ile değiştirir → `/patients/TD26700042/exams/55` →
//      `/patients/:id/exams/:id` (gerçek MRN/sayı GitHub'a gitmez).
//
// Token'lar Türkçe ve Geri-Bildirim Merkezi (#821) ile ortaktır:
// `[e-posta]`, `[numara]` token'ları feedback.scrub testleriyle sabittir.

// Sıra önemli: e-posta → MRN (harf+rakam) → TCKN (tam 11) → telefon → uzun rakam.
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
// MRN: 2 büyük harf + 6+ rakam (örn. TD26700042). Pür-rakam kurallarından ÖNCE.
const MRN_RE = /\b[A-Z]{2}\d{6,}\b/g;
// TCKN / 11-haneli ulusal kimlik (tam 11).
const TCKN_RE = /\b\d{11}\b/g;
// Ayraçlı telefon: uluslararası (+...) veya gruplu yerel (90-123-4567).
const PHONE_RE = /\+\d[\d\s().-]{6,}\d|\b\d{3}[\s.-]\d{3}[\s.-]\d{2,4}\b/g;
// Kalan uzun rakam dizisi (7+) — hesap no, ayraçsız telefon, vb.
const LONG_DIGITS_RE = /\b\d{7,}\b/g;

/**
 * Serbest metindeki PII desenlerini maskeler. Idempotent değildir ama tekrar
 * uygulanması güvenlidir (token'lar tekrar eşleşmez).
 */
export function scrubText(text: string): string {
  return text
    .replace(EMAIL_RE, '[e-posta]')
    .replace(MRN_RE, '[mrn]')
    .replace(TCKN_RE, '[kimlik]')
    .replace(PHONE_RE, '[telefon]')
    .replace(LONG_DIGITS_RE, '[numara]');
}

// Path segmentinde "kimlik değeri" sayılan desenler → `:id`.
const UUID_SEG_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEG_RE = /^\d+$/;
const MRN_SEG_RE = /^[A-Z]{2}\d{6,}$/;

function isIdSegment(seg: string): boolean {
  return UUID_SEG_RE.test(seg) || NUMERIC_SEG_RE.test(seg) || MRN_SEG_RE.test(seg);
}

/**
 * Bir URL veya path'i route pattern'e indirger: query string atılır, kimlik
 * görünen segmentler `:id` olur. Mutlak URL gelirse origin korunur ama
 * path normalize edilir. Parse edilemezse güvenli tarafta `scrubText` uygulanır.
 */
export function routePattern(input: string): string {
  if (!input) return input;
  // Query + fragment at.
  const [pathPart] = input.split(/[?#]/, 1);
  // Mutlak URL ise scheme://host'u ayır, path'i normalize et.
  const schemeMatch = pathPart.match(/^([a-z]+:\/\/[^/]+)(\/.*)?$/i);
  const origin = schemeMatch ? schemeMatch[1] : '';
  const path = schemeMatch ? (schemeMatch[2] ?? '') : pathPart;

  const normalized = path
    .split('/')
    .map((seg) => (isIdSegment(seg) ? ':id' : seg))
    .join('/');

  return origin + normalized;
}

// Stack frame dosya yolunun proje köküne indirgendiği işaretler.
const PROJECT_ROOTS = ['apps', 'packages', 'src', 'node_modules', 'dist'];

/**
 * Mutlak stack-frame yolunu proje-göreli yola indirger → makine/kullanıcı dizini
 * (örn. `/Users/<ad>/...` → dev adı) GitHub'a sızmaz. İşaret bulunmazsa dosya adı.
 * Göreli yol zaten geliyorsa olduğu gibi (route-pattern uygulanarak) bırakılır.
 */
export function sourcePath(filename: string): string {
  if (!filename) return filename;
  const cleaned = filename.replace(/^(file|webpack|app):\/\/+/i, '').split(/[?#]/, 1)[0];
  const segments = cleaned.split('/').filter(Boolean);
  let cutIndex = -1;
  for (let i = 0; i < segments.length; i++) {
    if (PROJECT_ROOTS.includes(segments[i])) {
      cutIndex = i;
      break;
    }
  }
  const sliced =
    cutIndex >= 0
      ? segments.slice(cutIndex)
      : // İşaret yok: mutlak yolsa yalnız dosya adı, göreli yolsa olduğu gibi.
        /^([a-zA-Z]:)?[\\/]/.test(filename)
        ? segments.slice(-1)
        : segments;
  return routePattern(sliced.join('/'));
}
