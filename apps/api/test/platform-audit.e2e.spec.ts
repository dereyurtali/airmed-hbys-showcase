import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import request from 'supertest';
import { resetAndSeedFixtures } from './fixtures';
import { createTestApp } from './test-app';

// #945 (F3) — Platform Audit READ endpoint (GET /platform/audit). Okuma tüm
// platform rollerine açık (assertReader owner/engineer/support); mutasyon yok →
// audit yazılmaz, rol-403 case'i yok. 401 (token yok) + 200 (owner/support) +
// filtre + cursor pagination + take>200 reddi doğrulanır.

const OWNER_EMAIL = 'platform-owner-audit@dna.test';
const OWNER_PASSWORD = 'audit-test-pass';
const SUPPORT_EMAIL = 'platform-support-audit@dna.test';
const SUPPORT_PASSWORD = 'audit-support-pass';
const ACTION_A = 'e2e_audit.alpha';
const ACTION_B = 'e2e_audit.beta';

describe('F3 Platform Audit READ (GET /platform/audit)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ownerId: string;
  let supportId: string;
  let ownerAccessToken: string;
  let supportAccessToken: string;

  authenticator.options = { window: 1, step: 30 };

  async function fullLogin(email: string, password: string): Promise<string> {
    const login = await request(app.getHttpServer())
      .post('/platform/auth/login')
      .send({ email, password })
      .expect(200);
    const challenge = login.body.challengeToken as string;
    const setup = await request(app.getHttpServer())
      .post('/platform/auth/setup-totp')
      .set('Authorization', `Bearer ${challenge}`)
      .expect(200);
    const secret = setup.body.secret as string;
    const challenge2 = (
      await request(app.getHttpServer())
        .post('/platform/auth/login')
        .send({ email, password })
        .expect(200)
    ).body.challengeToken as string;
    const code = authenticator.generate(secret);
    const verify = await request(app.getHttpServer())
      .post('/platform/auth/verify-totp')
      .set('Authorization', `Bearer ${challenge2}`)
      .send({ code })
      .expect(200);
    return verify.body.accessToken as string;
  }

  beforeAll(async () => {
    await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

    await prisma.platformAdmin.deleteMany({
      where: { email: { in: [OWNER_EMAIL, SUPPORT_EMAIL] } },
    });

    const ownerHash = await bcrypt.hash(OWNER_PASSWORD, 4);
    const owner = await prisma.platformAdmin.create({
      data: {
        email: OWNER_EMAIL,
        passwordHash: ownerHash,
        name: 'Audit Owner',
        role: 'platform_owner',
      },
    });
    ownerId = owner.id;

    const supportHash = await bcrypt.hash(SUPPORT_PASSWORD, 4);
    const support = await prisma.platformAdmin.create({
      data: {
        email: SUPPORT_EMAIL,
        passwordHash: supportHash,
        name: 'Audit Support',
        role: 'platform_support',
      },
    });
    supportId = support.id;

    ownerAccessToken = await fullLogin(OWNER_EMAIL, OWNER_PASSWORD);
    supportAccessToken = await fullLogin(SUPPORT_EMAIL, SUPPORT_PASSWORD);

    // İki farklı action; ACTION_A iki kez → filtre + pagination için.
    await prisma.platformAuditLog.createMany({
      data: [
        { action: ACTION_A, adminId: ownerId, email: OWNER_EMAIL, entityType: 'e2e', payload: {} },
        { action: ACTION_A, adminId: ownerId, email: OWNER_EMAIL, entityType: 'e2e', payload: {} },
        {
          action: ACTION_B,
          adminId: supportId,
          email: SUPPORT_EMAIL,
          entityType: 'e2e',
          payload: {},
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.platformAuditLog.deleteMany({ where: { action: { in: [ACTION_A, ACTION_B] } } });
    await prisma.platformAdminSession.deleteMany({
      where: { adminId: { in: [ownerId, supportId] } },
    });
    await prisma.platformAdminRecoveryCode.deleteMany({
      where: { adminId: { in: [ownerId, supportId] } },
    });
    await prisma.platformAuditLog.deleteMany({
      where: { email: { in: [OWNER_EMAIL, SUPPORT_EMAIL] } },
    });
    await prisma.platformAdmin.deleteMany({
      where: { email: { in: [OWNER_EMAIL, SUPPORT_EMAIL] } },
    });
    await prisma.$disconnect();
    await app.close();
  });

  it('JWT yoksa 401', async () => {
    await request(app.getHttpServer()).get('/platform/audit').expect(401);
  });

  it('owner: 200 + items dizisi', async () => {
    const res = await request(app.getHttpServer())
      .get('/platform/audit')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it('support: 200 (okuma tüm rollere açık)', async () => {
    await request(app.getHttpServer())
      .get('/platform/audit')
      .set('Authorization', `Bearer ${supportAccessToken}`)
      .expect(200);
  });

  it('action filtresi: yalnız eşleşen kayıtlar', async () => {
    const res = await request(app.getHttpServer())
      .get(`/platform/audit?action=${ACTION_A}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .expect(200);
    const rows = res.body.items as Array<{ action: string }>;
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.action === ACTION_A)).toBe(true);
  });

  it('take + cursor: sayfalama nextCursor döndürür', async () => {
    const res = await request(app.getHttpServer())
      .get(`/platform/audit?action=${ACTION_A}&take=1`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .expect(200);
    expect(res.body.items.length).toBe(1);
    expect(res.body.nextCursor).toBeTruthy();
  });

  it('take > 200 reddedilir (400)', async () => {
    await request(app.getHttpServer())
      .get('/platform/audit?take=500')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .expect(400);
  });
});
