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

  if (body1.needsTotpSetup) {
    const setup = await request(app.getHttpServer() as App)
      .post('/platform/auth/setup-totp')
      .set('Authorization', `Bearer ${body1.challengeToken}`);
    const secret = (setup.body as { secret: string }).secret;
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
  targetUserId: string,
): Promise<StartResp> {
  const res = await request(app.getHttpServer() as App)
    .post('/platform/impersonate')
    .set('Authorization', `Bearer ${platformToken}`)
    .send({ targetUserId, reason: 'pr2 sensitive block test', durationMin: 15 });
  return res.body as StartResp;
}

describe('F4 PR 2 — auth/me + @BlockImpersonation + tenant suspend revoke hook', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let platformToken: string;
  let targetUserId: string;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

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
    targetUserId = fixtures.tenantA.adminId;
  });

  beforeEach(async () => {
    await prisma.tenantImpersonation.deleteMany({});
    await prisma.tenant.update({
      where: { id: fixtures.tenantA.id },
      data: { status: 'active', suspendedAt: null },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('GET /api/auth/me — normal tenant token → impersonation null', async () => {
    const token = await loginTenant(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    const res = await request(app.getHttpServer() as App)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: targetUserId,
      tenantId: fixtures.tenantA.id,
      email: fixtures.tenantA.adminEmail,
      impersonation: null,
    });
    expect(res.body.roles).toContain('yonetici');
  });

  it('GET /api/auth/me — impersonation token → impersonation context dolu', async () => {
    const { impersonationId, impersonationToken } = await startImpersonation(
      app,
      platformToken,
      targetUserId,
    );
    const res = await request(app.getHttpServer() as App)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${impersonationToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(targetUserId);
    expect(res.body.impersonation).toMatchObject({
      impersonationId,
      byName: PLATFORM_OWNER_EMAIL,
    });
    expect(res.body.impersonation.by).toBeTruthy();
  });

  it('@BlockImpersonation: impersonation token ile change-password → 403', async () => {
    const { impersonationToken } = await startImpersonation(app, platformToken, targetUserId);
    const res = await request(app.getHttpServer() as App)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${impersonationToken}`)
      .send({
        currentPassword: fixtures.tenantA.adminPassword,
        newPassword: 'NewPassword123!',
      });
    expect(res.status).toBe(403);
  });

  it('@BlockImpersonation: normal tenant token ile change-password → akış normal (400/204)', async () => {
    // Normal token ile aynı endpoint engellenmemeli — change-password kendi
    // validation + auth.service mantığını çalıştırır. Yanlış current password
    // gönderdiğimiz için 4xx beklenir ama 403 OLMAMALI.
    const token = await loginTenant(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    const res = await request(app.getHttpServer() as App)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'wrong-pass', newPassword: 'NewPassword123!' });
    expect(res.status).not.toBe(403);
  });

  it('tenant suspend hook: aktif impersonation token revoke edilir', async () => {
    const { impersonationId, impersonationToken } = await startImpersonation(
      app,
      platformToken,
      targetUserId,
    );

    // Verify token works before suspend
    const before = await request(app.getHttpServer() as App)
      .get('/api/patients?limit=1')
      .set('Authorization', `Bearer ${impersonationToken}`);
    expect(before.status).toBe(200);

    // Suspend tenant A via platform endpoint
    const sus = await request(app.getHttpServer() as App)
      .post(`/platform/tenants/${fixtures.tenantA.id}/suspend`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ reason: 'security_incident', note: 'pr2 e2e test' });
    expect(sus.status).toBe(200);

    // Token now invalid (impersonation row ended_at set)
    const after = await request(app.getHttpServer() as App)
      .get('/api/patients?limit=1')
      .set('Authorization', `Bearer ${impersonationToken}`);
    expect(after.status).toBe(401);

    const row = await prisma.tenantImpersonation.findUniqueOrThrow({
      where: { id: impersonationId },
    });
    expect(row.endedAt).not.toBeNull();
    expect(row.endedReason).toBe('tenant_suspended');
  });
});
