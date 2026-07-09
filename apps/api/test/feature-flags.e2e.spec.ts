import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import request from 'supertest';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

const OWNER_EMAIL = 'platform-owner-ff@dna.test';
const OWNER_PASSWORD = 'ff-test-pass';
const SUPPORT_EMAIL = 'platform-support-ff@dna.test';
const SUPPORT_PASSWORD = 'ff-support-pass';

describe('F6 Feature Flags (platform + tenant + override + RBAC)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let ownerId: string;
  let supportId: string;
  let ownerToken: string;
  let supportToken: string;
  let tenantAToken: string;

  authenticator.options = { window: 1, step: 30 };

  async function platformLogin(email: string, password: string): Promise<string> {
    const c1 = (
      await request(app.getHttpServer())
        .post('/platform/auth/login')
        .send({ email, password })
        .expect(200)
    ).body.challengeToken as string;
    const setup = await request(app.getHttpServer())
      .post('/platform/auth/setup-totp')
      .set('Authorization', `Bearer ${c1}`)
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
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
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

    ownerToken = await platformLogin(OWNER_EMAIL, OWNER_PASSWORD);
    supportToken = await platformLogin(SUPPORT_EMAIL, SUPPORT_PASSWORD);

    // Tenant token (tenant-side endpoint testleri için)
    const tenantLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        tenantSlug: fixtures.tenantA.slug,
        email: fixtures.tenantA.adminEmail,
        password: fixtures.tenantA.adminPassword,
      })
      .expect(200);
    tenantAToken = tenantLogin.body.accessToken as string;
  });

  beforeEach(async () => {
    // E2e-özel flag'leri temizle (seed flag'lerini bozma)
    await prisma.featureFlagOverride.deleteMany({
      where: { flagKey: { startsWith: 'e2e_' } },
    });
    await prisma.featureFlagDefinition.deleteMany({
      where: { key: { startsWith: 'e2e_' } },
    });
    // Tenant A için seed flag'lerin override'larını temizle ki test tekrar başlatılınca bozulmasın
    await prisma.featureFlagOverride.deleteMany({
      where: {
        tenantId: fixtures.tenantA.id,
        flagKey: { in: ['fraud_detection', 'whatsapp_messaging'] },
      },
    });
  });

  afterAll(async () => {
    await prisma.featureFlagOverride.deleteMany({ where: { flagKey: { startsWith: 'e2e_' } } });
    await prisma.featureFlagDefinition.deleteMany({ where: { key: { startsWith: 'e2e_' } } });
    await prisma.featureFlagOverride.deleteMany({
      where: {
        tenantId: fixtures.tenantA.id,
        flagKey: { in: ['fraud_detection', 'whatsapp_messaging'] },
      },
    });
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

  it('GET /platform/feature-flags: JWT yoksa 401', async () => {
    await request(app.getHttpServer()).get('/platform/feature-flags').expect(401);
  });

  it('GET /platform/feature-flags: owner görür, default 10 seed flag', async () => {
    const res = await request(app.getHttpServer())
      .get('/platform/feature-flags')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(10);
    const keys = res.body.map((f: { key: string }) => f.key);
    expect(keys).toContain('fraud_detection');
    expect(keys).toContain('surgery_module');
  });

  it('POST /platform/feature-flags: owner yeni flag tanımlar', async () => {
    const res = await request(app.getHttpServer())
      .post('/platform/feature-flags')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        key: 'e2e_new_module',
        name: 'E2E Yeni Modül',
        description: 'Test için',
        defaultValue: false,
      })
      .expect(201);
    expect(res.body.key).toBe('e2e_new_module');
    expect(res.body.defaultValue).toBe(false);
  });

  it('POST /platform/feature-flags: support → 403', async () => {
    await request(app.getHttpServer())
      .post('/platform/feature-flags')
      .set('Authorization', `Bearer ${supportToken}`)
      .send({ key: 'e2e_supp_forbid', name: 'Yasaklı' })
      .expect(403);
  });

  it('POST /platform/feature-flags: aynı key → 409', async () => {
    await request(app.getHttpServer())
      .post('/platform/feature-flags')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ key: 'e2e_dup', name: 'First' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/platform/feature-flags')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ key: 'e2e_dup', name: 'Second' })
      .expect(409);
  });

  it('POST /platform/feature-flags: invalid key (uppercase) → 400', async () => {
    await request(app.getHttpServer())
      .post('/platform/feature-flags')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ key: 'E2E_INVALID', name: 'X' })
      .expect(400);
  });

  it('PATCH /platform/feature-flags/:key: defaultValue değişir', async () => {
    await request(app.getHttpServer())
      .post('/platform/feature-flags')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ key: 'e2e_patch', name: 'Patch test', defaultValue: false })
      .expect(201);
    const res = await request(app.getHttpServer())
      .patch('/platform/feature-flags/e2e_patch')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ defaultValue: true })
      .expect(200);
    expect(res.body.defaultValue).toBe(true);
  });

  it('PUT /platform/feature-flags/:key/tenant/:tenantId: override set + tenant API yansıtır', async () => {
    // fraud_detection default false; tenantA için override true yap
    await request(app.getHttpServer())
      .put(`/platform/feature-flags/fraud_detection/tenant/${fixtures.tenantA.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ value: true })
      .expect(200);

    // tenant-side endpoint
    const res = await request(app.getHttpServer())
      .get('/api/feature-flags')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);
    expect(res.body.fraud_detection).toBe(true);
    // tenantA için override'lanmadı, seed default false olarak kalmalı
    expect(res.body.whatsapp_messaging).toBe(false);
    // surgery_module default true
    expect(res.body.surgery_module).toBe(true);
  });

  it("PUT override + DELETE: silindiğinde default'a döner", async () => {
    await request(app.getHttpServer())
      .put(`/platform/feature-flags/fraud_detection/tenant/${fixtures.tenantA.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ value: true })
      .expect(200);
    let r = await request(app.getHttpServer())
      .get('/api/feature-flags')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);
    expect(r.body.fraud_detection).toBe(true);

    await request(app.getHttpServer())
      .delete(`/platform/feature-flags/fraud_detection/tenant/${fixtures.tenantA.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    r = await request(app.getHttpServer())
      .get('/api/feature-flags')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);
    expect(r.body.fraud_detection).toBe(false); // back to default
  });

  it('PUT override: bilinmeyen tenant → 404', async () => {
    await request(app.getHttpServer())
      .put(`/platform/feature-flags/fraud_detection/tenant/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ value: true })
      .expect(404);
  });

  it('PUT override: support → 403', async () => {
    await request(app.getHttpServer())
      .put(`/platform/feature-flags/fraud_detection/tenant/${fixtures.tenantA.id}`)
      .set('Authorization', `Bearer ${supportToken}`)
      .send({ value: true })
      .expect(403);
  });

  it('GET :key/overrides: owner görür', async () => {
    await request(app.getHttpServer())
      .put(`/platform/feature-flags/fraud_detection/tenant/${fixtures.tenantA.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ value: true })
      .expect(200);
    const r = await request(app.getHttpServer())
      .get('/platform/feature-flags/fraud_detection/overrides')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(r.body.length).toBe(1);
    expect(r.body[0]!.tenantId).toBe(fixtures.tenantA.id);
  });

  it("GET /api/feature-flags: tenant user kendi flag'lerini görür", async () => {
    const res = await request(app.getHttpServer())
      .get('/api/feature-flags')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);
    expect(typeof res.body).toBe('object');
    expect(res.body.surgery_module).toBe(true);
    expect(res.body.fraud_detection).toBe(false);
  });

  it('GET /api/feature-flags: JWT yoksa 401', async () => {
    await request(app.getHttpServer()).get('/api/feature-flags').expect(401);
  });
});
