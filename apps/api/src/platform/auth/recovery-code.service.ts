import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

const RECOVERY_CODE_COUNT = 10;
const CODE_BYTES = 8; // 8 bytes → 16 base32 chars displayed as 4×4 groups

/**
 * Recovery codes are one-time TOTP fallbacks. Plaintext is shown to the user
 * exactly once (on setup-totp); only sha256(code) is persisted. Atomic claim
 * via `UPDATE ... WHERE used_at IS NULL` keeps double-use impossible under
 * concurrency.
 */
@Injectable()
export class RecoveryCodeService {
  constructor(private readonly prisma: PrismaService) {}

  async generateForAdmin(adminId: string): Promise<string[]> {
    // Wipe any prior unused codes — setup-totp regeneration must invalidate
    // the previous batch. We delete instead of revoking (no audit value beyond
    // the platform_audit_logs entry the caller writes).
    await this.prisma.platformAdminRecoveryCode.deleteMany({ where: { adminId } });

    const codes: string[] = [];
    const records: { adminId: string; codeHash: string }[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      const code = formatCode(randomBytes(CODE_BYTES));
      codes.push(code);
      records.push({ adminId, codeHash: hashCode(code) });
    }
    await this.prisma.platformAdminRecoveryCode.createMany({ data: records });
    return codes;
  }

  /**
   * Atomically claim a recovery code. Returns true on success (consumed),
   * false if no matching unused code exists. Race-safe.
   */
  async claim(adminId: string, plainCode: string): Promise<boolean> {
    const codeHash = hashCode(plainCode.trim().replace(/-/g, '').toUpperCase());
    const result = await this.prisma.platformAdminRecoveryCode.updateMany({
      where: { adminId, codeHash, usedAt: null },
      data: { usedAt: new Date() },
    });
    return result.count === 1;
  }
}

function formatCode(bytes: Buffer): string {
  // Crockford-style base32 (no I/L/O/U) keeps codes case-insensitive + readable.
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let out = '';
  for (const b of bytes) {
    out += ALPHABET[(b >>> 4) & 0x1f];
    out += ALPHABET[b & 0x1f];
  }
  // Display as XXXX-XXXX-XXXX-XXXX for readability; canonical hash uses the
  // unsegmented form so claim() strips dashes before comparing.
  return out.match(/.{1,4}/g)!.join('-');
}

function hashCode(plain: string): string {
  return createHash('sha256').update(plain.replace(/-/g, '').toUpperCase()).digest('hex');
}
