import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import request from 'supertest';
import { resetAndSeedFixtures } from './fixtures';
import { createTestApp } from './test-app';

// #950 (Feature 2) — Impersonation geçmişi (GET /platform/impersonate/history).
// Owner biten oturumların tümünü; engineer/support yalnız kendi açtıklarını.
// DoD: 401 + owner-tümü + support-own-only + endedAt/endedReason döner.

const OWNER_EMAIL = 'platform-owner-imphist@dna.test';
const OWNER_PASSWORD = 'imphist-owner-pass';
const SUP_EMAIL = 'platform-support-imphist@dna.test';
const SUP_PASSWORD = 'imphist-support-pass';
const OWNER_REASON = 'e2e owner ended session reason';
const SUP_REASON = 'e2e support ended session reason';

describe('Feature 2 Impersonation History (GET /platform/impersonate/history)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ownerId: string;
  let supId: string;
  let ownerToken: string;
  let supToken: string;
  const impIds: string[] = [];

  authenticator.options = { window: 1, step: 30 };

  async function fullLogin(email: string, password: string): Promise<string> {
    const login = await request(app.getHttpServer())
      .post('/platform/auth/login')
      .send({ email, password })
      .expect(200);
    const setup = await request(app.getHttpServer())
      .post('/platform/auth/setup-totp')
      .set('Authorization', `Bearer ${login.body.challengeToken}`)
      .expect(200);
    const secret = setup.body.secret as string;
    const c2 = (
      await request(app.getHttpServer())
        .post('/platform/auth/login')
        .send({ email, password })
        .expect(200)
    ).body.challengeToken as string;
    const verify = await request(app.getHttpServer())
      .post('/platform/auth/verify-totp')
      .set('Authorization', `Bearer ${c2}`)
      .send({ code: authenticator.generate(secret) })
      .expect(200);
    return verify.body.accessToken as string;
  }

  beforeAll(async () => {
    await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

    await prisma.platformAdmin.deleteMany({ where: { email: { in: [OWNER_EMAIL, SUP_EMAIL] } } });
    const owner = await prisma.platformAdmin.create({
      data: {
        email: OWNER_EMAIL,
        passwordHash: await bcrypt.hash(OWNER_PASSWORD, 4),
        name: 'ImpHist Owner',
        role: 'platform_owner',
      },
    });
    ownerId = owner.id;
    const sup = await prisma.platformAdmin.create({
      data: {
        email: SUP_EMAIL,
        passwordHash: await bcrypt.hash(SUP_PASSWORD, 4),
        name: 'ImpHist Support',
        role: 'platform_support',
      },
    });
    supId = sup.id;
    ownerToken = await fullLogin(OWNER_EMAIL, OWNER_PASSWORD);
    supToken = await fullLogin(SUP_EMAIL, SUP_PASSWORD);

    // Fixture'dan bir tenant + kullanıcı (superuser client RLS bypass).
    const tenant = await prisma.tenant.findFirst({ where: { status: 'active' } });
    const user = await prisma.user.findFirst({ where: { tenantId: tenant!.id } });
    const start = new Date(Date.now() - 3_600_000);
    const end = new Date();
    // Biten iki oturum (endedAt set → partial unique çakışmaz).
    const o = await prisma.tenantImpersonation.create({
      data: {
        platformAdminId: ownerId,
        targetUserId: user!.id,
        targetTenantId: tenant!.id,
        reason: OWNER_REASON,
        startedAt: start,
        expiresAt: end,
        endedAt: end,
        endedReason: 'manual_stop',
      },
    });
    const s = await prisma.tenantImpersonation.create({
      data: {
        platformAdminId: supId,
        targetUserId: user!.id,
        targetTenantId: tenant!.id,
        reason: SUP_REASON,
        startedAt: start,
        expiresAt: end,
        endedAt: end,
        endedReason: 'expired',
      },
    });
    impIds.push(o.id, s.id);
  });

  afterAll(async () => {
    await prisma.tenantImpersonation.deleteMany({ where: { id: { in: impIds } } });
    await prisma.platformAdminSession.deleteMany({ where: { adminId: { in: [ownerId, supId] } } });
    await prisma.platformAdminRecoveryCode.deleteMany({
      where: { adminId: { in: [ownerId, supId] } },
    });
    await prisma.platformAdmin.deleteMany({ where: { email: { in: [OWNER_EMAIL, SUP_EMAIL] } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('JWT yoksa 401', async () => {
    await request(app.getHttpServer()).get('/platform/impersonate/history').expect(401);
  });

  it('owner: 200 + tüm biten oturumlar + endedAt/endedReason', async () => {
    const res = await request(app.getHttpServer())
      .get('/platform/impersonate/history')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const reasons = (res.body as Array<{ reason: string }>).map((r) => r.reason);
    expect(reasons).toEqual(expect.arrayContaining([OWNER_REASON, SUP_REASON]));
    const row = (res.body as Array<{ reason: string; endedAt: string; endedReason: string }>).find(
      (r) => r.reason === OWNER_REASON,
    );
    expect(row?.endedAt).toBeTruthy();
    expect(row?.endedReason).toBe('manual_stop');
  });

  it('support: 200 + yalnız kendi açtığı (owner oturumu görünmez)', async () => {
    const res = await request(app.getHttpServer())
      .get('/platform/impersonate/history')
      .set('Authorization', `Bearer ${supToken}`)
      .expect(200);
    const reasons = (res.body as Array<{ reason: string }>).map((r) => r.reason);
    expect(reasons).toContain(SUP_REASON);
    expect(reasons).not.toContain(OWNER_REASON);
  });
});
