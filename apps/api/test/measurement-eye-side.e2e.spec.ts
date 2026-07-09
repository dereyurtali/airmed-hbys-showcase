import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// S15-PR6 — Measurement eyeSide validation: zod enforce + persist all 3 enum
// values + reject missing.

interface LoginBody {
  accessToken: string;
}

async function login(app: INestApplication, slug: string, email: string, password: string) {
  const res = await request(app.getHttpServer() as App)
    .post('/api/auth/login')
    .send({ tenantSlug: slug, email, password });
  return (res.body as LoginBody).accessToken;
}

async function trpcMutation(app: INestApplication, token: string, route: string, body: unknown) {
  const res = await request(app.getHttpServer() as App)
    .post(`/api/trpc/${route}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  return { status: res.status, body: res.body };
}

describe('S15-PR6 Measurement eyeSide validation', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let token: string;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

    // Permission registry: measurement.create yalnız doktor + hemşire.
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const role = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: fixtures.tenantA.id, key: 'doktor' } },
    });
    const email = 'doktor@a-eye-side.test';
    const password = 'doktor-pass-1234';
    const user = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email,
        passwordHash: await bcrypt.hash(password, 4),
        name: 'Dr. Eye Side Test',
        status: 'active',
      },
    });
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: user.id, roleId: role.id },
    });
    token = await login(app, fixtures.tenantA.slug, email, password);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('persists eyeSide=od for right eye measurement', async () => {
    const res = await trpcMutation(app, token, 'measurement.create', {
      patientId: fixtures.tenantA.patientId,
      type: 'intraocular_pressure',
      eyeSide: 'od',
      measuredAt: new Date().toISOString(),
      values: { pressure: 14 },
    });
    expect(res.status).toBe(200);
    const data = (res.body as { result: { data: { eyeSide: string } } }).result.data;
    expect(data.eyeSide).toBe('od');
  });

  it('persists eyeSide=os for left eye', async () => {
    const res = await trpcMutation(app, token, 'measurement.create', {
      patientId: fixtures.tenantA.patientId,
      type: 'intraocular_pressure',
      eyeSide: 'os',
      measuredAt: new Date().toISOString(),
      values: { pressure: 16 },
    });
    expect(res.status).toBe(200);
    const data = (res.body as { result: { data: { eyeSide: string } } }).result.data;
    expect(data.eyeSide).toBe('os');
  });

  it('persists eyeSide=ou for both eyes', async () => {
    const res = await trpcMutation(app, token, 'measurement.create', {
      patientId: fixtures.tenantA.patientId,
      type: 'biometry',
      eyeSide: 'ou',
      measuredAt: new Date().toISOString(),
      values: { axialLength: 23.5 },
    });
    expect(res.status).toBe(200);
    const data = (res.body as { result: { data: { eyeSide: string } } }).result.data;
    expect(data.eyeSide).toBe('ou');
  });

  it('rejects missing eyeSide with 400', async () => {
    const res = await trpcMutation(app, token, 'measurement.create', {
      patientId: fixtures.tenantA.patientId,
      type: 'intraocular_pressure',
      measuredAt: new Date().toISOString(),
      values: { pressure: 15 },
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid eyeSide value', async () => {
    const res = await trpcMutation(app, token, 'measurement.create', {
      patientId: fixtures.tenantA.patientId,
      type: 'intraocular_pressure',
      eyeSide: 'right', // invalid
      measuredAt: new Date().toISOString(),
      values: { pressure: 15 },
    });
    expect(res.status).toBe(400);
  });

  it('update can change eyeSide (typo correction)', async () => {
    const created = await trpcMutation(app, token, 'measurement.create', {
      patientId: fixtures.tenantA.patientId,
      type: 'visual_acuity',
      eyeSide: 'od',
      measuredAt: new Date().toISOString(),
      values: { acuity: '0.8' },
    });
    const id = (created.body as { result: { data: { id: string } } }).result.data.id;

    const upd = await trpcMutation(app, token, 'measurement.update', {
      id,
      data: { eyeSide: 'os' },
    });
    expect(upd.status).toBe(200);
    const data = (upd.body as { result: { data: { eyeSide: string } } }).result.data;
    expect(data.eyeSide).toBe('os');
  });
});
