import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

interface LoginBody {
  accessToken: string;
}

async function login(
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

describe('Audit log capture', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  let fixtures: IsolationFixtures;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
  });

  afterAll(async () => {
    await app.close();
    await admin.$disconnect();
  });

  it('writes auth.login.success when a tenant user logs in', async () => {
    await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    const row = await admin.auditLog.findFirst({
      where: { tenantId: fixtures.tenantA.id, action: 'auth.login.success' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    expect(row?.userId).toBe(fixtures.tenantA.adminId);
    expect(row?.entityType).toBe('user');
  });

  it('writes auth.login.failure on bad password (out-of-band, tx rolled back)', async () => {
    await request(app.getHttpServer() as App)
      .post('/api/auth/login')
      .send({
        tenantSlug: fixtures.tenantA.slug,
        email: fixtures.tenantA.adminEmail,
        password: 'wrongpass-123',
      });
    const row = await admin.auditLog.findFirst({
      where: { tenantId: fixtures.tenantA.id, action: 'auth.login.failure' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    expect(row?.entityType).toBe('user');
    expect((row?.payload as { email?: string } | null)?.email).toBe(fixtures.tenantA.adminEmail);
  });

  it('writes a row for an authenticated POST mutation (patient create)', async () => {
    const token = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    const created = await request(app.getHttpServer() as App)
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Audit',
        lastName: 'Test',
        birthDate: '1995-01-01',
        gender: 'female',
        phone: '+992999111222',
      });
    expect(created.status).toBe(201);

    const row = await admin.auditLog.findFirst({
      where: {
        tenantId: fixtures.tenantA.id,
        action: 'post:/api/patients',
        userId: fixtures.tenantA.adminId,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    expect(row?.entityType).toBe('patient');
  });

  it('does NOT audit GET requests (read-only)', async () => {
    const token = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    await request(app.getHttpServer() as App)
      .get('/api/patients')
      .set('Authorization', `Bearer ${token}`);

    const reads = await admin.auditLog.count({
      where: { tenantId: fixtures.tenantA.id, action: { startsWith: 'get:' } },
    });
    expect(reads).toBe(0);
  });

  it('writes auth.logout when a refresh cookie is presented', async () => {
    const loginRes = await request(app.getHttpServer() as App)
      .post('/api/auth/login')
      .send({
        tenantSlug: fixtures.tenantA.slug,
        email: fixtures.tenantA.adminEmail,
        password: fixtures.tenantA.adminPassword,
      });
    const setCookie = loginRes.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : (setCookie ?? '');
    const cookie = cookieHeader.split(';')[0];

    await request(app.getHttpServer() as App)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .expect(204);

    const row = await admin.auditLog.findFirst({
      where: { tenantId: fixtures.tenantA.id, action: 'auth.logout' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
  });
});
