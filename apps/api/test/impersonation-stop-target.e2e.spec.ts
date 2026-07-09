import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

const PLATFORM_OWNER_EMAIL = 'ali@dnasoft.co';
const PLATFORM_OWNER_PASSWORD = 'platform-owner-dev';

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

describe('F7 stop-impersonation target endpoint (banner Stop button)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let platformToken: string;

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
  });

  beforeEach(async () => {
    await prisma.tenantImpersonation.deleteMany({});
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('impersonation token holder → POST /api/auth/stop-impersonation → 204 + row ended', async () => {
    const start = await request(app.getHttpServer() as App)
      .post('/platform/impersonate')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({
        targetUserId: fixtures.tenantA.adminId,
        reason: 'banner stop test scenario run',
      });
    expect(start.status).toBe(201);
    const { impersonationId, impersonationToken } = start.body as {
      impersonationId: string;
      impersonationToken: string;
    };

    const stop = await request(app.getHttpServer() as App)
      .post('/api/auth/stop-impersonation')
      .set('Authorization', `Bearer ${impersonationToken}`);
    expect(stop.status).toBe(204);

    const row = await prisma.tenantImpersonation.findUniqueOrThrow({
      where: { id: impersonationId },
    });
    expect(row.endedAt).not.toBeNull();
    expect(row.endedReason).toBe('manual_stop_by_target');

    // Token immediately rejected
    const after = await request(app.getHttpServer() as App)
      .get('/api/patients?limit=1')
      .set('Authorization', `Bearer ${impersonationToken}`);
    expect(after.status).toBe(401);
  });

  it('normal tenant token (imp claim yok) → 403', async () => {
    const login = await request(app.getHttpServer() as App)
      .post('/api/auth/login')
      .send({
        tenantSlug: fixtures.tenantA.slug,
        email: fixtures.tenantA.adminEmail,
        password: fixtures.tenantA.adminPassword,
      });
    const accessToken = (login.body as { accessToken: string }).accessToken;

    const stop = await request(app.getHttpServer() as App)
      .post('/api/auth/stop-impersonation')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(stop.status).toBe(403);
  });
});
