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

describe('tRPC mutation auditing', () => {
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

  it('writes an audit row for a successful tRPC mutation (patient.create)', async () => {
    const token = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );

    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/patient.create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'tRPC',
        lastName: 'Audited',
        birthDate: '1991-03-15',
        gender: 'female',
        phone: '+992777111222',
      });
    expect(res.status).toBe(200);
    const created = res.body.result.data;
    expect(created.id).toEqual(expect.any(String));

    const row = await admin.auditLog.findFirst({
      where: {
        tenantId: fixtures.tenantA.id,
        action: 'trpc:patient.create',
        userId: fixtures.tenantA.adminId,
        entityId: created.id,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    expect(row?.entityType).toBe('patient');
  });

  it('does NOT write an audit row for tRPC queries (patient.list)', async () => {
    const token = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );

    await request(app.getHttpServer() as App)
      .get(
        '/api/trpc/patient.list?input=' +
          encodeURIComponent(JSON.stringify({ page: 1, pageSize: 10 })),
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const reads = await admin.auditLog.count({
      where: { tenantId: fixtures.tenantA.id, action: 'trpc:patient.list' },
    });
    expect(reads).toBe(0);
  });

  it('writes auth.password.changed audit when REST change-password succeeds', async () => {
    // Use a clean password to avoid colliding with the bcrypt cost-4 fixture.
    const token = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );

    await request(app.getHttpServer() as App)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: fixtures.tenantA.adminPassword, newPassword: 'rotated-pass-1' })
      .expect(204);

    const row = await admin.auditLog.findFirst({
      where: {
        tenantId: fixtures.tenantA.id,
        action: 'auth.password.changed',
        userId: fixtures.tenantA.adminId,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();

    // Restore so any later test ordering does not break.
    const reLoginToken = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      'rotated-pass-1',
    );
    await request(app.getHttpServer() as App)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${reLoginToken}`)
      .send({ currentPassword: 'rotated-pass-1', newPassword: fixtures.tenantA.adminPassword })
      .expect(204);
  });
});
