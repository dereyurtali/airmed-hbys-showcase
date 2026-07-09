import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import request from 'supertest';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// F5 Platform Health — snapshot endpoint testleri.

const OWNER_EMAIL = 'platform-owner-health@dna.test';
const OWNER_PASSWORD = 'health-test-pass';
const SUPPORT_EMAIL = 'platform-support-health@dna.test';
const SUPPORT_PASSWORD = 'health-support-pass';

interface Snapshot {
  collectedAt: string;
  deployment: {
    gitSha: string | null;
    imageTag: string | null;
    buildTime: string | null;
    deployedAt: string;
    nodeEnv: string;
  };
  database: {
    connections: { active: number; idle: number; total: number; idleInTransaction: number };
    sizeBytes: number;
    sizePretty: string;
    slowQueryCountLast5m: number | null;
  };
  tenants: { active: number; total: number };
  users: { totalActive: number; lockedUsers: number };
  sessions: { activeRefreshTokens: number };
  activity: {
    auditLogsLast24h: number;
    activeFraudAlerts: number;
    commissionsPendingReview: number;
  };
  storage: { iolLotsCount: number; patientPhotosCount: number };
}

describe('F5 Platform Health (snapshot + RBAC)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let _fixtures: IsolationFixtures;
  let ownerId: string;
  let supportId: string;
  let ownerToken: string;
  let supportToken: string;

  authenticator.options = { window: 1, step: 30 };

  async function fullLogin(email: string, password: string): Promise<string> {
    const challenge1 = (
      await request(app.getHttpServer())
        .post('/platform/auth/login')
        .send({ email, password })
        .expect(200)
    ).body.challengeToken as string;
    const setup = await request(app.getHttpServer())
      .post('/platform/auth/setup-totp')
      .set('Authorization', `Bearer ${challenge1}`)
      .expect(200);
    const secret = setup.body.secret as string;
    const challenge2 = (
      await request(app.getHttpServer())
        .post('/platform/auth/login')
        .send({ email, password })
        .expect(200)
    ).body.challengeToken as string;
    const verify = await request(app.getHttpServer())
      .post('/platform/auth/verify-totp')
      .set('Authorization', `Bearer ${challenge2}`)
      .send({ code: authenticator.generate(secret) })
      .expect(200);
    return verify.body.accessToken as string;
  }

  beforeAll(async () => {
    _fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

    await prisma.platformAdmin.deleteMany({
      where: { email: { in: [OWNER_EMAIL, SUPPORT_EMAIL] } },
    });
    const oHash = await bcrypt.hash(OWNER_PASSWORD, 4);
    const sHash = await bcrypt.hash(SUPPORT_PASSWORD, 4);
    const o = await prisma.platformAdmin.create({
      data: { email: OWNER_EMAIL, passwordHash: oHash, name: 'O', role: 'platform_owner' },
    });
    ownerId = o.id;
    const s = await prisma.platformAdmin.create({
      data: { email: SUPPORT_EMAIL, passwordHash: sHash, name: 'S', role: 'platform_support' },
    });
    supportId = s.id;

    ownerToken = await fullLogin(OWNER_EMAIL, OWNER_PASSWORD);
    supportToken = await fullLogin(SUPPORT_EMAIL, SUPPORT_PASSWORD);
  });

  afterAll(async () => {
    await prisma.platformAdminSession.deleteMany({
      where: { adminId: { in: [ownerId, supportId] } },
    });
    await prisma.platformAdminRecoveryCode.deleteMany({
      where: { adminId: { in: [ownerId, supportId] } },
    });
    await prisma.platformAdmin.deleteMany({
      where: { email: { in: [OWNER_EMAIL, SUPPORT_EMAIL] } },
    });
    await prisma.$disconnect();
    await app.close();
  });

  it('snapshot: JWT yoksa 401', async () => {
    await request(app.getHttpServer()).get('/platform/health/snapshot').expect(401);
  });

  it('snapshot: owner görür, tüm alanlar dolu', async () => {
    const res = await request(app.getHttpServer())
      .get('/platform/health/snapshot')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const body = res.body as Snapshot;
    expect(typeof body.collectedAt).toBe('string');
    // #955 — deployment/sürüm bloğu (env yoksa gitSha/imageTag null; deployedAt
    // her zaman container-start'tan türetilir; nodeEnv test'te 'test').
    expect(typeof body.deployment.deployedAt).toBe('string');
    expect(new Date(body.deployment.deployedAt).getTime()).not.toBeNaN();
    expect(typeof body.deployment.nodeEnv).toBe('string');
    expect(body.deployment).toHaveProperty('gitSha');
    expect(body.deployment).toHaveProperty('imageTag');
    expect(body.deployment).toHaveProperty('buildTime');
    expect(body.database.connections.total).toBeGreaterThan(0);
    expect(body.database.sizeBytes).toBeGreaterThan(0);
    expect(typeof body.database.sizePretty).toBe('string');
    expect(body.tenants.total).toBeGreaterThanOrEqual(2); // fixtures: tenantA + tenantB
    expect(body.tenants.active).toBeGreaterThanOrEqual(2);
    expect(body.users.totalActive).toBeGreaterThan(0);
    expect(body.sessions.activeRefreshTokens).toBeGreaterThanOrEqual(0);
    expect(body.activity.auditLogsLast24h).toBeGreaterThanOrEqual(0);
    expect(body.activity.activeFraudAlerts).toBeGreaterThanOrEqual(0);
    expect(body.activity.commissionsPendingReview).toBeGreaterThanOrEqual(0);
    expect(body.storage.iolLotsCount).toBeGreaterThanOrEqual(0);
    expect(body.storage.patientPhotosCount).toBeGreaterThanOrEqual(0);
  });

  it('snapshot: platform_support 200 (read-only), platform admin yetkisi var', async () => {
    const res = await request(app.getHttpServer())
      .get('/platform/health/snapshot')
      .set('Authorization', `Bearer ${supportToken}`)
      .expect(200);
    expect(res.body.database).toBeDefined();
  });

  it('snapshot: tenant JWT ile 401 (cross-boundary)', async () => {
    const tenant = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        tenantSlug: 'tenant-a',
        email: 'admin@a.tj',
        password: 'isolation-pass',
      })
      .expect(200);
    await request(app.getHttpServer())
      .get('/platform/health/snapshot')
      .set('Authorization', `Bearer ${tenant.body.accessToken}`)
      .expect(401);
  });
});
