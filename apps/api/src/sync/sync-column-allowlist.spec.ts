import {
  ALLOWED_SYNC_COLUMNS,
  assertColumnAllowedForTable,
  assertSyncColumnSafe,
  assertSyncColumnsSafe,
} from './sync-column-allowlist';

// S14 — v0.1 sync hardening port. Unit test'ler (DB yok).

describe('sync-column-allowlist', () => {
  describe('assertSyncColumnSafe', () => {
    it('snake_case kabul eder', () => {
      expect(() => assertSyncColumnSafe('id')).not.toThrow();
      expect(() => assertSyncColumnSafe('tenant_id')).not.toThrow();
      expect(() => assertSyncColumnSafe('first_name')).not.toThrow();
      expect(() => assertSyncColumnSafe('created_at')).not.toThrow();
    });

    it('reddet: SQL injection denemesi', () => {
      expect(() => assertSyncColumnSafe('id; DROP TABLE')).toThrow();
      expect(() => assertSyncColumnSafe('"x" --')).toThrow();
      expect(() => assertSyncColumnSafe("name'")).toThrow();
      expect(() => assertSyncColumnSafe('UPPER_CASE')).toThrow();
      expect(() => assertSyncColumnSafe('camelCase')).toThrow();
      expect(() => assertSyncColumnSafe(' space')).toThrow();
      expect(() => assertSyncColumnSafe('-leading-dash')).toThrow();
    });

    it('reddet: boş veya çok uzun', () => {
      expect(() => assertSyncColumnSafe('')).toThrow();
      expect(() => assertSyncColumnSafe('a'.repeat(64))).toThrow();
    });

    it('non-string reddet', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => assertSyncColumnSafe(123 as any)).toThrow();
    });
  });

  describe('assertSyncColumnsSafe', () => {
    it('hepsi geçerli → throw etmez', () => {
      expect(() => assertSyncColumnsSafe(['id', 'tenant_id', 'first_name'])).not.toThrow();
    });

    it('biri kötü → throw eder', () => {
      expect(() => assertSyncColumnsSafe(['id', 'name; DROP'])).toThrow();
    });
  });

  describe('assertColumnAllowedForTable', () => {
    it('patients allowlist içinden geçer', () => {
      expect(() => assertColumnAllowedForTable('patients', 'mrn')).not.toThrow();
      expect(() => assertColumnAllowedForTable('patients', 'first_name')).not.toThrow();
    });

    it('patients allowlist dışı throw eder', () => {
      expect(() => assertColumnAllowedForTable('patients', 'unknown_col')).toThrow();
    });

    it('allowlist olmayan tablo → soft-pass (regex zaten guard)', () => {
      expect(() => assertColumnAllowedForTable('examinations', 'anything_goes')).not.toThrow();
    });
  });

  describe('ALLOWED_SYNC_COLUMNS shape', () => {
    it('patients ve appointments en az kritik alanları içerir', () => {
      expect(ALLOWED_SYNC_COLUMNS.patients).toContain('id');
      expect(ALLOWED_SYNC_COLUMNS.patients).toContain('tenant_id');
      expect(ALLOWED_SYNC_COLUMNS.patients).toContain('mrn');
      expect(ALLOWED_SYNC_COLUMNS.appointments).toContain('id');
      expect(ALLOWED_SYNC_COLUMNS.appointments).toContain('status');
    });
  });

  // #920 — güvenlik sertleştirmesi: forbidden denylist + strict users/roles.
  describe('#920 security hardening', () => {
    it('forbidden kolon HER tabloda reddedilir (auth sırrı)', () => {
      expect(() => assertColumnAllowedForTable('users', 'password_hash')).toThrow(/forbidden/i);
      // allowlist'i olmayan tabloda bile denylist tutar
      expect(() => assertColumnAllowedForTable('examinations', 'password_hash')).toThrow(
        /forbidden/i,
      );
      expect(() => assertColumnAllowedForTable('users', 'locked_until')).toThrow(/forbidden/i);
    });

    it('users strict: güvenli alan geçer, aktivasyon/güvenlik alanı reddedilir', () => {
      expect(() => assertColumnAllowedForTable('users', 'email')).not.toThrow();
      expect(() => assertColumnAllowedForTable('users', 'name')).not.toThrow();
      // status (aktivasyon) + flags allowlist dışı → peer aktivasyon değiştiremez
      expect(() => assertColumnAllowedForTable('users', 'status')).toThrow(/not allowed/i);
      expect(() => assertColumnAllowedForTable('users', 'flags')).toThrow(/not allowed/i);
    });

    it('roles strict: is_active reddedilir', () => {
      expect(() => assertColumnAllowedForTable('roles', 'key')).not.toThrow();
      expect(() => assertColumnAllowedForTable('roles', 'is_active')).toThrow(/not allowed/i);
    });
  });
});
