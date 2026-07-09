import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';

// #914 — TOTP secret'ları DB'de düz metin yerine AES-256-GCM ile şifreli tutulur.
// DB backup sızıntısı / insider erişimi tek başına 2FA üretmeye yetmesin.
const ENC_PREFIX = 'v1.gcm.';

/**
 * Wraps otplib's TOTP authenticator with explicit, audited settings:
 *  - HMAC-SHA1 (RFC 6238 default — Google Authenticator / 1Password / etc. compatible)
 *  - 30-second step
 *  - window=1 (±30s clock skew tolerance — explicit, otplib defaults can drift)
 *
 * Secrets are base32-encoded so they can be embedded in otpauth:// URLs.
 *
 * Pinned to otplib v12 because v13 switched to ESM-only deps that ts-jest's
 * CJS transform can't load — the v12 functional surface is stable enough.
 */
@Injectable()
export class TotpService {
  private readonly logger = new Logger(TotpService.name);
  private readonly issuer: string;
  // #914 — AES-256-GCM anahtarı (32 byte). TOTP_ENCRYPTION_KEY 64-hex ise doğrudan,
  // değilse sha256 türevi. Prod'da eksikse fail-fast (2FA sırrı şifresiz kalmasın).
  private readonly encKey: Buffer;

  constructor(config: ConfigService) {
    this.issuer = config.get<string>('PLATFORM_TOTP_ISSUER') ?? 'AirMed-HBYS Platform';
    authenticator.options = { window: 1, step: 30 };

    const rawKey = config.get<string>('TOTP_ENCRYPTION_KEY') ?? '';
    if (!rawKey && process.env.NODE_ENV === 'production') {
      throw new Error(
        'TOTP_ENCRYPTION_KEY is required in production — platform admin 2FA secrets ' +
          'must not be stored in plaintext.',
      );
    }
    this.encKey = /^[0-9a-fA-F]{64}$/.test(rawKey)
      ? Buffer.from(rawKey, 'hex')
      : createHash('sha256')
          .update(rawKey || 'dev-insecure-totp-encryption-key')
          .digest();
  }

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  // #914 — AES-256-GCM: v1.gcm.<iv>.<tag>.<ciphertext> (hepsi base64).
  encryptSecret(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ENC_PREFIX + [iv, tag, ct].map((b) => b.toString('base64')).join('.');
  }

  isEncrypted(stored: string): boolean {
    return stored.startsWith(ENC_PREFIX);
  }

  // Şifreliyse çöz; legacy düz-metin (henüz göç etmemiş) ise aynen döndür.
  decryptSecret(stored: string): string {
    if (!this.isEncrypted(stored)) return stored;
    const [ivB64, tagB64, ctB64] = stored.slice(ENC_PREFIX.length).split('.');
    const decipher = createDecipheriv('aes-256-gcm', this.encKey, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  buildOtpauthUrl(email: string, secret: string): string {
    return authenticator.keyuri(email, this.issuer, secret);
  }

  verify(token: string, secret: string): boolean {
    if (!/^\d{6}$/.test(token)) return false;
    try {
      return authenticator.check(token, secret);
    } catch (err) {
      this.logger.warn(`TOTP verify error: ${(err as Error).message}`);
      return false;
    }
  }
}
