import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// S3 — Permission guard ve permissionProcedure backend kontrolü.
// Karar tutanağı §6 + permissions.ts registry doğrulaması: REST ve tRPC
// katmanlarında permission-bazlı reddetme çalışıyor mu.

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

async function seedRole(prisma: PrismaClient, tenantId: string, key: string, label: string) {
  await prisma.role.upsert({
    where: { tenantId_key: { tenantId, key } },
    update: {},
    create: { tenantId, key, label },
  });
}

async function seedUser(
  prisma: PrismaClient,
  tenantId: string,
  email: string,
  password: string,
  roleKey: string,
): Promise<string> {
  const hash = await bcrypt.hash(password, 4);
  const role = await prisma.role.findUniqueOrThrow({
    where: { tenantId_key: { tenantId, key: roleKey } },
  });
  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId, email } },
    update: { status: 'active', passwordHash: hash },
    create: {
      tenantId,
      email,
      passwordHash: hash,
      name: roleKey,
      status: 'active',
    },
  });
  await prisma.userRole.upsert({
    where: {
      tenantId_userId_roleId: { tenantId, userId: user.id, roleId: role.id },
    },
    update: {},
    create: { tenantId, userId: user.id, roleId: role.id },
  });
  return user.id;
}

describe('S3 — backend permission guard + tRPC permissionProcedure', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let asistanToken: string;
  let yoneticiToken: string;
  let resepsiyonToken: string;
  const PASSWORD = 'permission-test-pass';

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

    // permissions registry'deki tüm rolleri seed (default fixtures hepsini içermiyor)
    await seedRole(prisma, fixtures.tenantA.id, 'yonetici_asistani', 'Yönetici Asistanı');
    await seedRole(prisma, fixtures.tenantA.id, 'hemsire', 'Hemşire');

    await seedUser(prisma, fixtures.tenantA.id, 'asistan-perm@a.tj', PASSWORD, 'yonetici_asistani');
    yoneticiToken = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    asistanToken = await login(app, fixtures.tenantA.slug, 'asistan-perm@a.tj', PASSWORD);
    resepsiyonToken = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.receptionistEmail!,
      fixtures.tenantA.receptionistPassword!,
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('REST @RequirePermission — Karar 5: asistan hasta silemez', () => {
    it('yönetici DELETE /api/patients/:id → 204', async () => {
      // Yeni hasta yarat, hasta silme yönetici için izinli
      const patient = await prisma.patient.create({
        data: {
          tenantId: fixtures.tenantA.id,
          mrn: 'PERM-001',
          firstName: 'Perm',
          lastName: 'Test1',
          birthDate: new Date('1990-01-01'),
          gender: 'male',
        },
      });
      const res = await request(app.getHttpServer() as App)
        .delete(`/api/patients/${patient.id}`)
        .set('Authorization', `Bearer ${yoneticiToken}`);
      expect(res.status).toBe(204);
    });

    it('asistan DELETE /api/patients/:id → 403 (permissions registry reddedildi)', async () => {
      const patient = await prisma.patient.create({
        data: {
          tenantId: fixtures.tenantA.id,
          mrn: 'PERM-002',
          firstName: 'Perm',
          lastName: 'Test2',
          birthDate: new Date('1990-01-01'),
          gender: 'male',
        },
      });
      const res = await request(app.getHttpServer() as App)
        .delete(`/api/patients/${patient.id}`)
        .set('Authorization', `Bearer ${asistanToken}`);
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toMatch(/yetkisi yok|action:patient\.softDelete/i);
    });

    it('resepsiyon DELETE /api/patients/:id → 403', async () => {
      const patient = await prisma.patient.create({
        data: {
          tenantId: fixtures.tenantA.id,
          mrn: 'PERM-003',
          firstName: 'Perm',
          lastName: 'Test3',
          birthDate: new Date('1990-01-01'),
          gender: 'male',
        },
      });
      const res = await request(app.getHttpServer() as App)
        .delete(`/api/patients/${patient.id}`)
        .set('Authorization', `Bearer ${resepsiyonToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('tRPC permissionProcedure — Karar 4: asistan API key oluşturamaz', () => {
    it('yönetici apiKey.create → 200 + plaintext', async () => {
      const res = await request(app.getHttpServer() as App)
        .post('/api/trpc/apiKey.create')
        .set('Authorization', `Bearer ${yoneticiToken}`)
        .set('Content-Type', 'application/json')
        .send({ name: 'PermTestYoneticiKey', scopes: ['patient:read'] });
      expect(res.status).toBe(200);
    });

    it('asistan apiKey.create → 403 FORBIDDEN', async () => {
      const res = await request(app.getHttpServer() as App)
        .post('/api/trpc/apiKey.create')
        .set('Authorization', `Bearer ${asistanToken}`)
        .set('Content-Type', 'application/json')
        .send({ name: 'PermTestAsistanKey', scopes: ['patient:read'] });
      expect(res.status).toBe(403);
    });
  });

  describe('tRPC permissionProcedure — Karar 5: asistan patient.softDelete', () => {
    it('asistan tRPC patient.softDelete → 403', async () => {
      const patient = await prisma.patient.create({
        data: {
          tenantId: fixtures.tenantA.id,
          mrn: 'PERM-004',
          firstName: 'Trpc',
          lastName: 'Test4',
          birthDate: new Date('1990-01-01'),
          gender: 'male',
        },
      });
      const res = await request(app.getHttpServer() as App)
        .post('/api/trpc/patient.softDelete')
        .set('Authorization', `Bearer ${asistanToken}`)
        .set('Content-Type', 'application/json')
        .send({ id: patient.id });
      expect(res.status).toBe(403);
    });

    it('yönetici tRPC patient.softDelete → 200', async () => {
      const patient = await prisma.patient.create({
        data: {
          tenantId: fixtures.tenantA.id,
          mrn: 'PERM-005',
          firstName: 'Trpc',
          lastName: 'Test5',
          birthDate: new Date('1990-01-01'),
          gender: 'male',
        },
      });
      const res = await request(app.getHttpServer() as App)
        .post('/api/trpc/patient.softDelete')
        .set('Authorization', `Bearer ${yoneticiToken}`)
        .set('Content-Type', 'application/json')
        .send({ id: patient.id });
      expect(res.status).toBe(200);
    });
  });
});
