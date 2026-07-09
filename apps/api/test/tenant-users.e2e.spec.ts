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

interface UserRow {
  id: string;
  email: string;
  name: string;
  status: string;
  roles: string[];
}

async function loginPlatform(app: INestApplication, prisma: PrismaClient): Promise<string> {
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
  const stage1 = await request(app.getHttpServer() as App)
    .post('/platform/auth/login')
    .send({ email: PLATFORM_OWNER_EMAIL, password: PLATFORM_OWNER_PASSWORD });
  const body1 = stage1.body as { challengeToken: string; needsTotpSetup: boolean };
  const setup = await request(app.getHttpServer() as App)
    .post('/platform/auth/setup-totp')
    .set('Authorization', `Bearer ${body1.challengeToken}`);
  const secret = (setup.body as { secret: string }).secret;
  const stage2 = await request(app.getHttpServer() as App)
    .post('/platform/auth/login')
    .send({ email: PLATFORM_OWNER_EMAIL, password: PLATFORM_OWNER_PASSWORD });
  const body2 = stage2.body as { challengeToken: string };
  const verify = await request(app.getHttpServer() as App)
    .post('/platform/auth/verify-totp')
    .set('Authorization', `Bearer ${body2.challengeToken}`)
    .send({ code: authenticator.generate(secret) });
  return (verify.body as { accessToken: string }).accessToken;
}

describe('F7 GET /platform/tenants/:id/users — admin UI için kullanıcı listesi', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let platformToken: string;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
    platformToken = await loginPlatform(app, prisma);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('aktif kullanıcılar dönüyor, role key + lastLoginAt dahil', async () => {
    const res = await request(app.getHttpServer() as App)
      .get(`/platform/tenants/${fixtures.tenantA.id}/users`)
      .set('Authorization', `Bearer ${platformToken}`);
    expect(res.status).toBe(200);
    const rows = res.body as UserRow[];
    // Fixtures: tenantA admin + receptionist = 2 user
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const admin = rows.find((u) => u.email === fixtures.tenantA.adminEmail);
    expect(admin).toBeDefined();
    expect(admin!.roles).toContain('yonetici');
    expect(admin!.status).toBe('active');
  });

  it('deleted_at olan user listede yok', async () => {
    const extraEmail = 'soft-deleted@a.tj';
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: extraEmail,
        passwordHash: 'x',
        name: 'Soft Deleted',
        status: 'active',
        deletedAt: new Date(),
      },
    });

    const res = await request(app.getHttpServer() as App)
      .get(`/platform/tenants/${fixtures.tenantA.id}/users`)
      .set('Authorization', `Bearer ${platformToken}`);
    expect(res.status).toBe(200);
    expect((res.body as UserRow[]).find((u) => u.email === extraEmail)).toBeUndefined();
  });

  it('platform token olmadan → 401', async () => {
    const res = await request(app.getHttpServer() as App).get(
      `/platform/tenants/${fixtures.tenantA.id}/users`,
    );
    expect(res.status).toBe(401);
  });
});
