// R1 (#723) — Co-sign diff yakalama. Hemşirenin doktor adına yaptığı klinik
// güncellemelerde doktor onayında "ne değişti"yi görebilsin diye, audit
// middleware bu path'lerde mutasyon ÖNCESİ + SONRASI satırı çeker ve alan-bazlı
// diff'i AuditLog.payload.diff'e yazar (CosignPage gösterir). Şema değişikliği
// yok — mevcut payload Json kullanılır.

// tRPC mutation path → prisma scoped model anahtarı. Yalnız in-place güncelleme
// (update) path'leri: before/after anlamlı. Hepsi input.id ile çağrılır.
export const COSIGN_DIFF_SOURCES: Record<string, string> = {
  'examination.update': 'examination',
  'surgery.update': 'surgery',
  'measurement.update': 'measurement',
  'procedure.update': 'procedure',
};

// Diff dışı tutulan teknik alanlar (kimlik/tenant/zaman damgaları/ilişki FK'leri).
const DIFF_SKIP_FIELDS = new Set([
  'id',
  'tenantId',
  'patientId',
  'doctorId',
  'createdAt',
  'updatedAt',
  'deletedAt',
]);

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

function normalize(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  return v;
}

function equal(a: unknown, b: unknown): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  // JSON alanlar (findings, preOp…) + array/obj derin karşılaştırma.
  try {
    return JSON.stringify(na) === JSON.stringify(nb);
  } catch {
    return false;
  }
}

// before/after satırlarının scalar + JSON alanlarını generic karşılaştırır;
// değişen alanları döndürür (alan-listesi bakımı gerektirmez).
export function computeFieldDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): FieldChange[] {
  if (!before || !after) return [];
  const changes: FieldChange[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (DIFF_SKIP_FIELDS.has(key)) continue;
    if (!equal(before[key], after[key])) {
      changes.push({ field: key, before: normalize(before[key]), after: normalize(after[key]) });
    }
  }
  return changes;
}
