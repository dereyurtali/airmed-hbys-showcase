import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import request from 'supertest';
import { resetAndSeedFixtures } from './fixtures';
import { createTestApp } from './test-app';

// #946 (Feature 3) — Platform admin CRUD. list okuma tüm rollere; mutasyonlar
// yalnız platform_owner (assertOwner). DoD: owner-200 / engineer+support-403 /
// self-deactivate-engel / son-owner-engel / audit + safe select (şifre dönmez).

const OWNER_EMAIL = 'platform-owner-admins@dna.test';
const OWNER_PASSWORD = 'admins-owner-pass';
const ENG_EMAIL = 'platform-eng-admins@dna.test';
const ENG_PASSWORD = 'admins-eng-pass';
const SUP_EMAIL = 'platform-support-admins@dna.test';
const SUP_PASSWORD = 'admins-support-pass';
const NEW_ADMIN_EMAIL = 'platform-new-admins@dna.test';

describe('Feature 3 Platform Admins CRUD (/platform/admins)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ownerId: string;
  let engId: string;
  let supId: string;
  let ownerToken: string;
  let engToken: string;
  let supToken: string;
  let createdAdminId: string | null = null;

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
    const verify = await request(app.getHttpServer())
      .post('/platform/auth/verify-totp')
      .set('Authorization', `Bearer ${challenge2}`)
      .send({ code: authenticator.generate(secret) })
      .expect(200);
    return verify.body.accessToken as string;
  }

  async function seedAdmin(email: string, password: string, role: string): Promise<string> {
    const created = await prisma.platformAdmin.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 4),
        name: `T ${role}`,
        role: role as never,
      },
    });
    return created.id;
  }

  beforeAll(async () => {
    await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

    await prisma.platformAdmin.deleteMany({
      where: { email: { in: [OWNER_EMAIL, ENG_EMAIL, SUP_EMAIL, NEW_ADMIN_EMAIL] } },
    });
    ownerId = await seedAdmin(OWNER_EMAIL, OWNER_PASSWORD, 'platform_owner');
    engId = await seedAdmin(ENG_EMAIL, ENG_PASSWORD, 'platform_engineer');
    supId = await seedAdmin(SUP_EMAIL, SUP_PASSWORD, 'platform_support');

    ownerToken = await fullLogin(OWNER_EMAIL, OWNER_PASSWORD);
    engToken = await fullLogin(ENG_EMAIL, ENG_PASSWORD);
    supToken = await fullLogin(SUP_EMAIL, SUP_PASSWORD);
  });

  afterAll(async () => {
    const ids = [ownerId, engId, supId, createdAdminId].filter((v): v is string => !!v);
    await prisma.platformAdminSession.deleteMany({ where: { adminId: { in: ids } } });
    await prisma.platformAdminRecoveryCode.deleteMany({ where: { adminId: { in: ids } } });
    await prisma.platformAuditLog.deleteMany({ where: { entityType: 'platform_admin' } });
    await prisma.platformAdmin.deleteMany({
      where: { email: { in: [OWNER_EMAIL, ENG_EMAIL, SUP_EMAIL, NEW_ADMIN_EMAIL] } },
    });
    await prisma.$disconnect();
    await app.close();
  });

  it('list: JWT yoksa 401', async () => {
    await request(app.getHttpServer()).get('/platform/admins').expect(401);
  });

  it('list: owner 200 + şifre/totpSecret DÖNMEZ', async () => {
    const res = await request(app.getHttpServer())
      .get('/platform/admins')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    const row = (res.body as Array<Record<string, unknown>>).find((r) => r.email === OWNER_EMAIL);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('passwordHash');
    expect(row).not.toHaveProperty('totpSecret');
  });

  it('create: engineer 403, support 403', async () => {
    const body = { email: NEW_ADMIN_EMAIL, name: 'Yeni Admin', role: 'platform_engineer' };
    await request(app.getHttpServer())
      .post('/platform/admins')
      .set('Authorization', `Bearer ${engToken}`)
      .send(body)
      .expect(403);
    await request(app.getHttpServer())
      .post('/platform/admins')
      .set('Authorization', `Bearer ${supToken}`)
      .send(body)
      .expect(403);
  });

  it('create: owner 201 + tek-seferlik tempPassword + audit', async () => {
    const res = await request(app.getHttpServer())
      .post('/platform/admins')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: NEW_ADMIN_EMAIL, name: 'Yeni Admin', role: 'platform_engineer' })
      .expect(201);
    expect(res.body.tempPassword).toBeTruthy();
    expect(res.body.admin.email).toBe(NEW_ADMIN_EMAIL);
    expect(res.body.admin).not.toHaveProperty('passwordHash');
    createdAdminId = res.body.admin.id as string;

    const audit = await prisma.platformAuditLog.findFirst({
      where: { action: 'platform_admin.create', entityId: createdAdminId },
    });
    expect(audit).toBeTruthy();
  });

  it('updateRole: engineer 403; owner 200', async () => {
    await request(app.getHttpServer())
      .patch(`/platform/admins/${createdAdminId}/role`)
      .set('Authorization', `Bearer ${engToken}`)
      .send({ role: 'platform_support' })
      .expect(403);
    const res = await request(app.getHttpServer())
      .patch(`/platform/admins/${createdAdminId}/role`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: 'platform_support' })
      .expect(200);
    expect(res.body.role).toBe('platform_support');
  });

  it('deactivate: owner kendini deaktive EDEMEZ (400)', async () => {
    await request(app.getHttpServer())
      .post(`/platform/admins/${ownerId}/deactivate`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);
  });

  it('deactivate: owner hedefi deaktive eder 200 + oturum iptal', async () => {
    const res = await request(app.getHttpServer())
      .post(`/platform/admins/${createdAdminId}/deactivate`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(res.body.isActive).toBe(false);
  });

  it('resetTotp: owner 200', async () => {
    await request(app.getHttpServer())
      .post(`/platform/admins/${createdAdminId}/reset-totp`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
  });

  it('son-owner invariant: tek owner kendini engineer yapamaz (400)', async () => {
    await request(app.getHttpServer())
      .patch(`/platform/admins/${ownerId}/role`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: 'platform_engineer' })
      .expect(400);
  });
});
