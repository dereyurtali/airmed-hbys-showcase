// S14 — v0.1 sync hardening port. Cross-node sync receive endpoint column
// name allowlist + regex guard.
//
// Bağlam: sync.service.ts applyEvent / resolveConflict raw SQL üretirken
// payload.keys()'i kolon adı olarak interpolate ediyor:
//   const colList = columns.map(c => `"${c}"`).join(', ');
// Eğer karşı node (compromised veya kötü amaçlı) `id, x"; DROP TABLE--` gibi
// bir column adı gönderirse SQL injection mümkün olur.
//
// İki katmanlı guard:
//   1) Regex: column adı ^[a-z_][a-z0-9_]*$ uymalı (snake_case + underscore)
//   2) Allowlist (informational): tablo başına bilinen kolonlar listesi
//
// Şu an v0.2'de regex hard-block; allowlist soft-warn (log) — gelecekte
// tablo başına strict allowlist için referans kalır.

const COLUMN_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/;

/**
 * Genel düzeyde regex guard. Snake_case dışı her şeyi reddeder.
 * (Camel-case Prisma field adlarımız @map ile snake'e dönüştüğü için
 * sync payload'ı snake_case kolon adlarıyla gelir.)
 */
export function assertSyncColumnSafe(column: string): void {
  if (typeof column !== 'string') {
    throw new Error(`Sync column name must be string, got ${typeof column}`);
  }
  if (column.length === 0 || column.length > 63) {
    // Postgres ident max 63
    throw new Error(`Sync column name length out of range: "${column}"`);
  }
  if (!COLUMN_NAME_PATTERN.test(column)) {
    throw new Error(
      `Sync column name rejected by safety filter: "${column}" (must match ${COLUMN_NAME_PATTERN.source})`,
    );
  }
}

export function assertSyncColumnsSafe(columns: readonly string[]): void {
  for (const c of columns) assertSyncColumnSafe(c);
}

// Allowlist: pilot için sadece en kritik tabloların kolonları. Gelecekte
// her sync tablosu için tamamlanır. Şu an warn-only davranıyor (regex guard
// asıl korumayı sağlıyor).
//
// Boş kalan tablolar guard'sız (regex hâlâ uygulanır).
export const ALLOWED_SYNC_COLUMNS: Record<string, readonly string[]> = {
  patients: [
    'id',
    'tenant_id',
    'mrn',
    'first_name',
    'last_name',
    'phone',
    'email',
    'gender',
    'birth_date',
    'lead_source',
    'address',
    'national_id',
    'passport_number',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  appointments: [
    'id',
    'tenant_id',
    'patient_id',
    'doctor_id',
    'type',
    'status',
    'starts_at',
    'ends_at',
    'notes',
    'created_by_id',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  // #920 — users/roles STRICT allowlist: geçerli HMAC'li bir peer'ın
  // password_hash / status (aktivasyon) / must_change_password gibi güvenlik
  // kolonlarını sync ile yazmasını engelle. Yalnız güvenli kimlik alanları.
  users: ['id', 'tenant_id', 'email', 'name', 'locale', 'created_at', 'updated_at', 'deleted_at'],
  roles: ['id', 'tenant_id', 'key', 'label', 'created_at', 'updated_at'],
};

// #920 — GLOBAL denylist: hangi tabloda gelirse gelsin ASLA sync ile yazılmaz.
// Belirlenmiş users allowlist'i zaten bunları dışlar; bu, allowlist'i olmayan
// (henüz A12'de tanımlanmamış) tablolar için de auth-sırrı sızıntısına karşı
// emniyet ağı (defense in depth).
const FORBIDDEN_SYNC_COLUMNS: ReadonlySet<string> = new Set([
  'password_hash',
  'must_change_password',
  'failed_login_count',
  'locked_until',
  'last_login_at',
  'last_login_ip',
  'totp_secret',
  'totp_verified_at',
  'key_hash',
  'code_hash',
  'recovery_code',
]);

/**
 * #920 — Sync kolon guard'ı (hard block):
 *  1) FORBIDDEN_SYNC_COLUMNS'daki bir kolon her tabloda reddedilir (auth sırrı).
 *  2) ALLOWED_SYNC_COLUMNS'da tablo tanımlıysa, kolon allowlist dışıysa reddedilir.
 *  3) Tablo allowlist'te yoksa (henüz A12'de tanımlanmadı) yalnız regex + denylist
 *     uygulanır (dormant sync; A12 aktivasyonunda per-tablo allowlist eklenir — #934).
 */
export function assertColumnAllowedForTable(table: string, column: string): void {
  if (FORBIDDEN_SYNC_COLUMNS.has(column)) {
    throw new Error(`Column "${column}" is forbidden for sync (security-sensitive)`);
  }
  const allow = ALLOWED_SYNC_COLUMNS[table];
  if (!allow) return; // tablo allowlist'te yok → regex + denylist yeterli kabul
  if (!allow.includes(column)) {
    throw new Error(`Column "${column}" not allowed for sync table "${table}"`);
  }
}
