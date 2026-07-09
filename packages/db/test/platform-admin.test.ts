import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';

const prisma = new PrismaClient();
const ADMIN_EMAIL_PREFIX = 'platform-test-';

async function cleanup() {
  await prisma.platformAdminLoginAttempt.deleteMany({
    where: { email: { startsWith: ADMIN_EMAIL_PREFIX } },
  });
  await prisma.platformAdminIpAllowlist.deleteMany({
    where: { label: { startsWith: 'platform-test-' } },
  });
  // Sessions + recovery codes cascade-delete with the admin via FK.
  await prisma.platformAdmin.deleteMany({
    where: { email: { startsWith: ADMIN_EMAIL_PREFIX } },
  });
}

beforeAll(cleanup);
beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('F2 platform admin schema', () => {
  it('PlatformAdmin defaults: failedLoginCount=0, lockedUntil=null', async () => {
    const admin = await prisma.platformAdmin.create({
      data: {
        email: `${ADMIN_EMAIL_PREFIX}defaults@dna.test`,
        passwordHash: 'bcrypt-hash-stub',
        name: 'Defaults Admin',
        role: 'platform_owner',
      },
    });
    expect(admin.failedLoginCount).toBe(0);
    expect(admin.lockedUntil).toBeNull();
    expect(admin.passwordChangedAt).toBeNull();
    expect(admin.totpSecret).toBeNull();
  });

  it('PlatformAdminRecoveryCode unique codeHash + atomic mark-used', async () => {
    const admin = await prisma.platformAdmin.create({
      data: {
        email: `${ADMIN_EMAIL_PREFIX}recovery@dna.test`,
        passwordHash: 'bcrypt-hash-stub',
        name: 'Recovery Admin',
        role: 'platform_owner',
      },
    });
    const codeHash = createHash('sha256').update(randomBytes(16)).digest('hex');
    await prisma.platformAdminRecoveryCode.create({
      data: { adminId: admin.id, codeHash },
    });

    // Duplicate codeHash must violate the unique constraint.
    await expect(
      prisma.platformAdminRecoveryCode.create({
        data: { adminId: admin.id, codeHash },
      }),
    ).rejects.toThrow(/unique|duplicate|P2002/i);

    // Atomic mark-used: row picked only when used_at IS NULL.
    const claimed = await prisma.platformAdminRecoveryCode.updateMany({
      where: { codeHash, usedAt: null },
      data: { usedAt: new Date() },
    });
    expect(claimed.count).toBe(1);

    const reclaim = await prisma.platformAdminRecoveryCode.updateMany({
      where: { codeHash, usedAt: null },
      data: { usedAt: new Date() },
    });
    expect(reclaim.count).toBe(0);
  });

  it('PlatformAdminSession stores INET ip + nullable revokedAt', async () => {
    const admin = await prisma.platformAdmin.create({
      data: {
        email: `${ADMIN_EMAIL_PREFIX}session@dna.test`,
        passwordHash: 'bcrypt-hash-stub',
        name: 'Session Admin',
        role: 'platform_engineer',
      },
    });
    const session = await prisma.platformAdminSession.create({
      data: {
        adminId: admin.id,
        refreshTokenHash: 'a'.repeat(64),
        ipAddress: '203.0.113.42',
        userAgent: 'vitest',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    expect(session.revokedAt).toBeNull();
    expect(session.ipAddress).toBe('203.0.113.42');

    await prisma.platformAdminSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    const revoked = await prisma.platformAdminSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(revoked.revokedAt).not.toBeNull();
  });

  it('PlatformAdminIpAllowlist accepts CIDR strings', async () => {
    const entries = await prisma.platformAdminIpAllowlist.createMany({
      data: [
        { cidr: '10.0.0.0/24', label: 'platform-test-office', isActive: true },
        { cidr: '203.0.113.0/28', label: 'platform-test-vpn', isActive: true },
        { cidr: '0.0.0.0/0', label: 'platform-test-disabled', isActive: false },
      ],
    });
    expect(entries.count).toBe(3);

    const active = await prisma.platformAdminIpAllowlist.count({
      where: { isActive: true, label: { startsWith: 'platform-test-' } },
    });
    expect(active).toBe(2);
  });

  it('PlatformAuditLog persists with nullable adminId for failed login lookups', async () => {
    const log = await prisma.platformAuditLog.create({
      data: {
        action: 'platform.auth.login.failure',
        email: `${ADMIN_EMAIL_PREFIX}unknown@dna.test`,
        payload: { reason: 'unknown_email' },
        ip: '198.51.100.7',
      },
    });
    expect(log.adminId).toBeNull();
    expect(log.email).toBe(`${ADMIN_EMAIL_PREFIX}unknown@dna.test`);
    // Cleanup orphan audit row not covered by FK cascade.
    await prisma.platformAuditLog.delete({ where: { id: log.id } });
  });
});
