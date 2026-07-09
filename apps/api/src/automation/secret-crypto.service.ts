import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

// #1034 — Otomasyon sırları (Chatwoot bot token, model API key, webhook secret)
// DB'de AES-256-GCM şifreli durur; format ve anahtar türetimi #914 TOTP
// kalıbıyla birebir (v1.gcm.<iv>.<tag>.<ct>, hepsi base64). Anahtar:
// SECRETS_ENCRYPTION_KEY > TOTP_ENCRYPTION_KEY (yeni env gerekmez — staging/
// prod compose TOTP anahtarını zaten taşıyor). Prod'da ikisi de yoksa
// fail-fast: sır düz metin yazılmaz.

const ENC_PREFIX = 'v1.gcm.';

@Injectable()
export class SecretCryptoService {
  private readonly encKey: Buffer;

  constructor(config: ConfigService) {
    const rawKey =
      config.get<string>('SECRETS_ENCRYPTION_KEY') ??
      config.get<string>('TOTP_ENCRYPTION_KEY') ??
      '';
    if (!rawKey && process.env.NODE_ENV === 'production') {
      throw new Error(
        'SECRETS_ENCRYPTION_KEY (veya TOTP_ENCRYPTION_KEY) is required in production — ' +
          'automation secrets must not be stored in plaintext.',
      );
    }
    this.encKey = /^[0-9a-fA-F]{64}$/.test(rawKey)
      ? Buffer.from(rawKey, 'hex')
      : createHash('sha256')
          .update(rawKey || 'dev-insecure-secret-encryption-key')
          .digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ENC_PREFIX + [iv, tag, ct].map((b) => b.toString('base64')).join('.');
  }

  decrypt(stored: string): string {
    if (!stored.startsWith(ENC_PREFIX)) return stored;
    const [ivB64, tagB64, ctB64] = stored.slice(ENC_PREFIX.length).split('.');
    const decipher = createDecipheriv('aes-256-gcm', this.encKey, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** UI durum rozeti için: sır asla dönmez, yalnız son 4 karakteri. */
  last4(stored: string): string {
    const plain = this.decrypt(stored);
    return plain.slice(-4);
  }
}
