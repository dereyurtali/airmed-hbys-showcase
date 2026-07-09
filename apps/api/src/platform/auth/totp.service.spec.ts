import type { ConfigService } from '@nestjs/config';
import { TotpService } from './totp.service';

// #914 — TOTP secret AES-256-GCM şifreleme round-trip + legacy düz-metin geçişi.
function makeService(key?: string): TotpService {
  const config = {
    get: (k: string) =>
      k === 'TOTP_ENCRYPTION_KEY' ? key : k === 'PLATFORM_TOTP_ISSUER' ? 'Test' : undefined,
  } as unknown as ConfigService;
  return new TotpService(config);
}

describe('TotpService AES-256-GCM secret encryption (#914)', () => {
  const svc = makeService('a'.repeat(64)); // 64-hex key

  it('encrypt → decrypt round-trip', () => {
    const secret = svc.generateSecret();
    const enc = svc.encryptSecret(secret);
    expect(enc).not.toBe(secret);
    expect(enc.startsWith('v1.gcm.')).toBe(true);
    expect(svc.decryptSecret(enc)).toBe(secret);
  });

  it('isEncrypted ayrımı', () => {
    expect(svc.isEncrypted(svc.encryptSecret('JBSWY3DPEHPK3PXP'))).toBe(true);
    expect(svc.isEncrypted('JBSWY3DPEHPK3PXP')).toBe(false);
  });

  it('legacy düz-metin decryptSecret ile aynen döner (geçiş)', () => {
    expect(svc.decryptSecret('JBSWY3DPEHPK3PXP')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('her şifreleme farklı IV → farklı ciphertext, aynı plaintext', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const a = svc.encryptSecret(secret);
    const b = svc.encryptSecret(secret);
    expect(a).not.toBe(b);
    expect(svc.decryptSecret(a)).toBe(secret);
    expect(svc.decryptSecret(b)).toBe(secret);
  });

  it('prod + TOTP_ENCRYPTION_KEY yoksa constructor throw', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => makeService(undefined)).toThrow(/TOTP_ENCRYPTION_KEY/);
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
