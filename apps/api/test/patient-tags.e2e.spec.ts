import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

interface LoginBody {
  accessToken: string;
}

interface TrpcSuccess<T> {
  result: { data: T };
}

interface PatientRow {
  id: string;
  firstName: string;
  lastName: string;
  tags: string[];
}

interface ListResponse {
  items: PatientRow[];
  total: number;
}

async function login(app: INestApplication, slug: string, email: string, password: string) {
  const res = await request(app.getHttpServer() as App)
    .post('/api/auth/login')
    .send({ tenantSlug: slug, email, password });
  return (res.body as LoginBody).accessToken;
}

async function trpcMutation<T>(app: INestApplication, token: string, route: string, body: unknown) {
  const res = await request(app.getHttpServer() as App)
    .post(`/api/trpc/${route}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  return { status: res.status, body: res.body as TrpcSuccess<T> };
}

async function trpcQuery<T>(app: INestApplication, token: string, route: string, input: unknown) {
  const url = `/api/trpc/${route}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await request(app.getHttpServer() as App)
    .get(url)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body as TrpcSuccess<T> };
}

describe('E4 Patient tags (tRPC + list filter)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
    adminToken = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    // Tek seed hastayı temizleyip taze yarat
    await prisma.patient.updateMany({
      where: { id: fixtures.tenantA.patientId },
      data: { tags: [] },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('create patient with tags persists array', async () => {
    const res = await trpcMutation<PatientRow>(app, adminToken, 'patient.create', {
      firstName: 'VIP',
      lastName: 'Hasta',
      birthDate: '1980-01-01',
      gender: 'female',
      phone: '+992111111106',
      tags: ['vip', 'insurance'],
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.tags).toEqual(expect.arrayContaining(['vip', 'insurance']));
  });

  it('update tags via patient.update', async () => {
    const res = await trpcMutation<PatientRow>(app, adminToken, 'patient.update', {
      id: fixtures.tenantA.patientId,
      data: { tags: ['risk_high', 'chronic'] },
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.tags).toEqual(expect.arrayContaining(['risk_high', 'chronic']));
  });

  it('setTags procedure replaces tags', async () => {
    const res = await trpcMutation<{ id: string; tags: string[] }>(
      app,
      adminToken,
      'patient.setTags',
      { id: fixtures.tenantA.patientId, tags: ['vip'] },
    );
    expect(res.status).toBe(200);
    expect(res.body.result.data.tags).toEqual(['vip']);

    const replace = await trpcMutation<{ id: string; tags: string[] }>(
      app,
      adminToken,
      'patient.setTags',
      { id: fixtures.tenantA.patientId, tags: ['follow_up'] },
    );
    expect(replace.body.result.data.tags).toEqual(['follow_up']);
  });

  it('setTags zod: bilinmeyen tag → 400', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/patient.setTags')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ id: fixtures.tenantA.patientId, tags: ['unknown_tag'] });
    expect(res.status).toBe(400);
  });

  it('list filter by single tag (hasEvery semantics)', async () => {
    await prisma.patient.update({
      where: { id: fixtures.tenantA.patientId },
      data: { tags: ['vip', 'insurance'] },
    });
    // 2. hasta tag'siz
    await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'A-VIPCHECK',
        firstName: 'Plain',
        lastName: 'Patient',
        birthDate: new Date('1990-01-01'),
        gender: 'female',
      },
    });

    const res = await trpcQuery<ListResponse>(app, adminToken, 'patient.list', {
      tags: ['vip'],
    });
    expect(res.status).toBe(200);
    const ids = res.body.result.data.items.map((p) => p.id);
    expect(ids).toContain(fixtures.tenantA.patientId);
    expect(res.body.result.data.items.every((p) => p.tags.includes('vip'))).toBe(true);
  });

  it('list filter by multiple tags requires ALL (hasEvery)', async () => {
    await prisma.patient.update({
      where: { id: fixtures.tenantA.patientId },
      data: { tags: ['vip', 'insurance'] },
    });
    await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'A-VIPONLY',
        firstName: 'VipOnly',
        lastName: 'Patient',
        birthDate: new Date('1990-01-01'),
        gender: 'female',
        tags: ['vip'],
      },
    });
    const res = await trpcQuery<ListResponse>(app, adminToken, 'patient.list', {
      tags: ['vip', 'insurance'],
    });
    // VipOnly hasta filtreden düşmeli
    const ids = res.body.result.data.items.map((p) => p.id);
    expect(ids).toContain(fixtures.tenantA.patientId);
    expect(res.body.result.data.items.every((p) => p.tags.includes('insurance'))).toBe(true);
  });

  it('list without tag filter returns all (tags ignored)', async () => {
    const res = await trpcQuery<ListResponse>(app, adminToken, 'patient.list', {});
    expect(res.body.result.data.total).toBeGreaterThanOrEqual(1);
  });

  it('cross-tenant: tenantB üzerinden tenantA hastasına setTags → 404', async () => {
    const tokenB = await login(
      app,
      fixtures.tenantB.slug,
      fixtures.tenantB.adminEmail,
      fixtures.tenantB.adminPassword,
    );
    const res = await trpcMutation<unknown>(app, tokenB, 'patient.setTags', {
      id: fixtures.tenantA.patientId,
      tags: ['vip'],
    });
    expect(res.status).toBe(404);
  });
});
