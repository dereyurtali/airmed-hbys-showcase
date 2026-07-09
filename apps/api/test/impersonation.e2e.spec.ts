import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

interface LoginBody {
  accessToken: string;
}
interface StartResp {
  impersonationId: string;
  impersonationToken: string;
  expiresAt: string;
  targetUser: {
    id: string;
    tenantId: string;
    email: string;
    name: string;
    tenantSlug: string;
    tenantName: string;
    roles: string[];
  };
}
interface ActiveRow {
  id: string;
  targetUserId: string;
  remainingSeconds: number;
}

const PLATFORM_OWNER_EMAIL = 'ali@dnasoft.co';
const PLATFORM_OWNER_PASSWORD = 'platform-owner-dev';

async function loginTenant(
  app: INestApplication,
  slug: string,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app.getHttpServer() as App)
    .post('/api/auth/login')
    .send({ tenantSlug: slug, email, password });
  return (res.body as LoginBody).accessToken;
}

// Platform login flow (platform-auth.e2e.spec.ts pattern):
// 1. POST /platform/auth/login → challengeToken + needsTotpSetup
// 2. (first time) POST /platform/auth/setup-totp Bearer challenge → secret
// 3. POST /platform/auth/verify-totp Bearer challenge + { code } → accessToken
async function loginPlatform(
  app: INestApplication,
  prisma: PrismaClient,
  email: string,
  password: string,
): Promise<string> {
  const stage1 = await request(app.getHttpServer() as App)
    .post('/platform/auth/login')
    .send({ email, password });
  const body1 = stage1.body as { challengeToken: string; needsTotpSetup: boolean };
  let secret: string;

  if (body1.needsTotpSetup) {
    const setup = await request(app.getHttpServer() as App)
      .post('/platform/auth/setup-totp')
      .set('Authorization', `Bearer ${body1.challengeToken}`);
    secret = (setup.body as { secret: string }).secret;
    // setup-totp persists the secret to DB but does NOT return an access token.
    // Login again to get a fresh challenge in 'totp_required' state.
    const stage2 = await request(app.getHttpServer() as App)
      .post('/platform/auth/login')
      .send({ email, password });
    const body2 = stage2.body as { challengeToken: string };
    const code = authenticator.generate(secret);
    const verify = await request(app.getHttpServer() as App)
      .post('/platform/auth/verify-totp')
      .set('Authorization', `Bearer ${body2.challengeToken}`)
      .send({ code });
    return (verify.body as { accessToken: string }).accessToken;
  }

  const admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { email } });
  const code = authenticator.generate(admin.totpSecret!);
  const verify = await request(app.getHttpServer() as App)
    .post('/platform/auth/verify-totp')
    .set('Authorization', `Bearer ${body1.challengeToken}`)
    .send({ code });
  return (verify.body as { accessToken: string }).accessToken;
}

async function startImpersonation(
  app: INestApplication,
  platformToken: string,
  body: { targetUserId: string; reason: string; durationMin?: number },
): Promise<{ status: number; body: StartResp }> {
  const res = await request(app.getHttpServer() as App)
    .post('/platform/impersonate')
    .set('Authorization', `Bearer ${platformToken}`)
    .send(body);
  return { status: res.status, body: res.body as StartResp };
}

describe('F4 Impersonation backend (start/stop/list + jwt validation + suspended tenant)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let platformToken: string;
  let targetUserId: string;
  let targetUserEmail: string;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

    // Platform owner seedling — fixtures yalnız tenant seed'ledi, platform
    // admin ekleyelim (TOTP setup için isActive + bcrypt cost 4).
    const hash = await bcrypt.hash(PLATFORM_OWNER_PASSWORD, 4);
    await prisma.platformAdmin.upsert({
      where: { email: PLATFORM_OWNER_EMAIL },
      update: { passwordHash: hash, totpSecret: null, totpVerifiedAt: null, isActive: true },
      create: {
        email: PLATFORM_OWNER_EMAIL,
        passwordHash: hash,
        name: 'Ali Owner',
        role: 'platform_owner',
        isActive: true,
      },
    });
    await prisma.tenantImpersonation.deleteMany({});

    platformToken = await loginPlatform(app, prisma, PLATFORM_OWNER_EMAIL, PLATFORM_OWNER_PASSWORD);

    // Target user (tenant A admin)
    targetUserId = fixtures.tenantA.adminId;
    targetUserEmail = fixtures.tenantA.adminEmail;
  });

  beforeEach(async () => {
    // Önceki test'in açık impersonation'larını sil
    await prisma.tenantImpersonation.deleteMany({});
    // Tenant A status'ünü active'e geri al
    await prisma.tenant.update({
      where: { id: fixtures.tenantA.id },
      data: { status: 'active', suspendedAt: null },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('start: aktif tenant + aktif user → 201 + token + DB row + audit', async () => {
    const res = await startImpersonation(app, platformToken, {
      targetUserId,
      reason: 'support: ticket #4242 triage',
      durationMin: 30,
    });
    expect(res.status).toBe(201);
    expect(res.body.impersonationToken).toBeTruthy();
    expect(res.body.targetUser.email).toBe(targetUserEmail);
    expect(res.body.targetUser.roles).toContain('yonetici');

    const row = await prisma.tenantImpersonation.findUniqueOrThrow({
      where: { id: res.body.impersonationId },
    });
    expect(row.endedAt).toBeNull();
    expect(row.reason).toContain('ticket #4242');
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 25 * 60 * 1000);

    const audit = await prisma.platformAuditLog.findFirst({
      where: { action: 'tenant.impersonate.start', entityId: targetUserId },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
  });

  it('start: duplicate aktif impersonation → 409', async () => {
    await startImpersonation(app, platformToken, {
      targetUserId,
      reason: 'first session reason text',
    });
    const res2 = await startImpersonation(app, platformToken, {
      targetUserId,
      reason: 'second attempt while first active',
    });
    expect(res2.status).toBe(409);
  });

  it('start: suspended tenant → 400', async () => {
    await prisma.tenant.update({
      where: { id: fixtures.tenantA.id },
      data: { status: 'suspended', suspendedAt: new Date() },
    });
    const res = await startImpersonation(app, platformToken, {
      targetUserId,
      reason: 'should be rejected suspended',
    });
    expect(res.status).toBe(400);
  });

  it('start: reason çok kısa (DTO validation) → 400', async () => {
    const res = await startImpersonation(app, platformToken, {
      targetUserId,
      reason: 'short',
    });
    expect(res.status).toBe(400);
  });

  it('jwt: impersonation token ile tenant endpoint → 200 + scope target user', async () => {
    const start = await startImpersonation(app, platformToken, {
      targetUserId,
      reason: 'verify token can hit tenant scope',
    });
    expect(start.status).toBe(201);

    // /api/patients ile token'ı dene — target tenant scope'undan veri dönmeli
    const list = await request(app.getHttpServer() as App)
      .get('/api/patients?limit=1')
      .set('Authorization', `Bearer ${start.body.impersonationToken}`);
    expect(list.status).toBe(200);
  });

  it('jwt: stop sonrası impersonation token reddedilir (401)', async () => {
    const start = await startImpersonation(app, platformToken, {
      targetUserId,
      reason: 'token should be invalid after stop',
    });
    expect(start.status).toBe(201);

    // Stop
    const stop = await request(app.getHttpServer() as App)
      .post('/platform/impersonate/stop')
      .set('Authorization', `Bearer ${platformToken}`);
    expect(stop.status).toBe(200);
    expect((stop.body as { stopped: number }).stopped).toBe(1);

    // Token artık geçersiz
    const after = await request(app.getHttpServer() as App)
      .get('/api/patients?limit=1')
      .set('Authorization', `Bearer ${start.body.impersonationToken}`);
    expect(after.status).toBe(401);
  });

  it('listActive: platform_owner kendi açtığını görür, remainingSeconds > 0', async () => {
    await startImpersonation(app, platformToken, {
      targetUserId,
      reason: 'visible in listActive endpoint',
    });
    const list = await request(app.getHttpServer() as App)
      .get('/platform/impersonate/active')
      .set('Authorization', `Bearer ${platformToken}`);
    expect(list.status).toBe(200);
    const rows = list.body as ActiveRow[];
    expect(rows.length).toBe(1);
    expect(rows[0].targetUserId).toBe(targetUserId);
    expect(rows[0].remainingSeconds).toBeGreaterThan(0);
  });

  it('jwt: claim mismatch (sub değişmiş) → 401', async () => {
    const start = await startImpersonation(app, platformToken, {
      targetUserId,
      reason: 'claim mismatch defense test',
    });
    expect(start.status).toBe(201);

    // Aynı impersonation_id ama farklı sub ile token üret (saldırgan simülasyonu).
    const jwt = await import('jsonwebtoken');
    const tampered = jwt.sign(
      {
        sub: '00000000-0000-0000-0000-000000000000',
        tenantId: fixtures.tenantA.id,
        email: 'attacker@a.tj',
        roles: ['yonetici'],
        imp: {
          id: start.body.impersonationId,
          by: 'fake-admin',
          byName: 'fake@dna.com',
        },
      },
      process.env.JWT_ACCESS_SECRET!,
      { expiresIn: '15m' },
    );
    const tamperedRes = await request(app.getHttpServer() as App)
      .get('/api/patients?limit=1')
      .set('Authorization', `Bearer ${tampered}`);
    expect(tamperedRes.status).toBe(401);
  });

  // P0 2.3 — Impersonation token PLATFORM_IMPERSONATION_JWT_SECRET ile imzalanmalı,
  // klinik JWT_ACCESS_SECRET'iyle değil. Saldırgan eski secret'ı bilirse bile
  // `imp` claim'i taşıyan token üretemez.
  it('P0 2.3 — JWT_ACCESS_SECRET ile imzalanmış imp token → 401 (secret ayrımı)', async () => {
    const start = await startImpersonation(app, platformToken, {
      targetUserId,
      reason: 'secret separation defense',
    });
    expect(start.status).toBe(201);

    const jwt = await import('jsonwebtoken');
    const forged = jwt.sign(
      {
        sub: targetUserId,
        tenantId: fixtures.tenantA.id,
        email: targetUserEmail,
        roles: ['yonetici'],
        imp: { id: start.body.impersonationId, by: 'forged', byName: 'attacker' },
      },
      process.env.JWT_ACCESS_SECRET!, // klinik secret — impersonation için artık yanlış
      { expiresIn: '15m' },
    );
    const res = await request(app.getHttpServer() as App)
      .get('/api/patients?limit=1')
      .set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  // P0 2.4 — @BlockImpersonation() REST endpoint kapsamı genişletildi: patient
  // softDelete artık impersonation oturumunda yapılamaz.
  it('P0 2.4 — REST patient DELETE impersonation token altında → 403', async () => {
    const start = await startImpersonation(app, platformToken, {
      targetUserId,
      reason: 'block impersonation rest patient delete',
    });
    expect(start.status).toBe(201);

    const res = await request(app.getHttpServer() as App)
      .delete(`/api/patients/${fixtures.tenantA.patientId}`)
      .set('Authorization', `Bearer ${start.body.impersonationToken}`);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/impersonation/i);
  });

  // P0 2.4 — tRPC sensitiveProcedure: hassas mutation'lar impersonation altında
  // FORBIDDEN. apiKey.create tipik örneği — uzun ömürlü token üretiyor.
  it('P0 2.4 — tRPC apiKey.create impersonation token altında → FORBIDDEN', async () => {
    const start = await startImpersonation(app, platformToken, {
      targetUserId,
      reason: 'block impersonation trpc api key',
    });
    expect(start.status).toBe(201);

    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/apiKey.create')
      .set('Authorization', `Bearer ${start.body.impersonationToken}`)
      .set('Content-Type', 'application/json')
      .send({ label: 'forged-key', scopes: ['read'] });
    // tRPC FORBIDDEN → HTTP 403 (error-mapper STATUS_TO_TRPC reverse)
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/impersonation/i);
  });

  it('P0 2.4 — tRPC patient.softDelete impersonation token altında → FORBIDDEN', async () => {
    const start = await startImpersonation(app, platformToken, {
      targetUserId,
      reason: 'block impersonation trpc patient delete',
    });
    expect(start.status).toBe(201);

    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/patient.softDelete')
      .set('Authorization', `Bearer ${start.body.impersonationToken}`)
      .set('Content-Type', 'application/json')
      .send({ id: fixtures.tenantA.patientId });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/impersonation/i);
  });

  it('regular tenant login (imp claim yok) → JwtStrategy bypass, normal akış çalışır', async () => {
    // Tenant admin normal login alır, impersonation kontrolü atlanır
    const tenantToken = await loginTenant(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    const normal = await request(app.getHttpServer() as App)
      .get('/api/patients?limit=1')
      .set('Authorization', `Bearer ${tenantToken}`);
    expect(normal.status).toBe(200);
  });
});
