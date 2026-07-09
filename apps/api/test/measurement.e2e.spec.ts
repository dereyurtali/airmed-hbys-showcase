import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
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

interface MeasurementRow {
  id: string;
  patientId: string;
  type: string;
  values: Record<string, unknown>;
  measuredAt: string;
  measuredById: string | null;
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

async function trpcMutation<T>(app: INestApplication, token: string, path: string, body: unknown) {
  const res = await request(app.getHttpServer() as App)
    .post(`/api/trpc/${path}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  return { status: res.status, body: res.body as TrpcSuccess<T> };
}

async function trpcQuery<T>(app: INestApplication, token: string, path: string, input: unknown) {
  const res = await request(app.getHttpServer() as App)
    .get(`/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body as TrpcSuccess<T> };
}

describe('A9 Measurement (tRPC + RBAC same-day window)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let doctorToken: string;
  let doctorUserId: string;

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

    // doktor rolünde bir kullanıcı yarat — same-day ownership testleri için.
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const doktorRole = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: fixtures.tenantA.id, key: 'doktor' } },
    });
    const doctorEmail = 'doktor@a-measure.test';
    const doctorPassword = 'doktor-pass-1234';
    const hash = await bcrypt.hash(doctorPassword, 4);
    const doctorUser = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: doctorEmail,
        passwordHash: hash,
        name: 'Dr. Measure Test',
        status: 'active',
      },
    });
    doctorUserId = doctorUser.id;
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: doctorUser.id, roleId: doktorRole.id },
    });
    doctorToken = await login(app, fixtures.tenantA.slug, doctorEmail, doctorPassword);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.measurement.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('create golden + measuredById = aktif kullanıcı + findById hasta+kaydeden', async () => {
    const create = await trpcMutation<MeasurementRow>(app, doctorToken, 'measurement.create', {
      patientId: fixtures.tenantA.patientId,
      type: 'intraocular_pressure',
      eyeSide: 'ou',
      measuredAt: new Date().toISOString(),
      values: { od: 14, os: 15 },
      notes: 'Routine check',
    });
    expect(create.status).toBe(200);
    expect(create.body.result.data.measuredById).toBe(doctorUserId);
    expect(create.body.result.data.type).toBe('intraocular_pressure');
    const id = create.body.result.data.id;

    const findRes = await trpcQuery<{
      patient: { firstName: string };
      measuredBy: { name: string };
      values: Record<string, unknown>;
    }>(app, doctorToken, 'measurement.findById', { id });
    expect(findRes.status).toBe(200);
    expect(findRes.body.result.data.patient.firstName).toBeDefined();
    expect(findRes.body.result.data.measuredBy.name).toBe('Dr. Measure Test');
    expect(findRes.body.result.data.values.od).toBe(14);
  });

  it('listByPatient desc sıralı + measuredBy include', async () => {
    await prisma.measurement.createMany({
      data: [
        {
          tenantId: fixtures.tenantA.id,
          patientId: fixtures.tenantA.patientId,
          type: 'intraocular_pressure',
          measuredById: doctorUserId,
          measuredAt: new Date('2026-04-01'),
          values: { od: 13, os: 14 },
        },
        {
          tenantId: fixtures.tenantA.id,
          patientId: fixtures.tenantA.patientId,
          type: 'intraocular_pressure',
          measuredById: doctorUserId,
          measuredAt: new Date('2026-05-01'),
          values: { od: 15, os: 16 },
        },
      ],
    });
    const res = await trpcQuery<Array<MeasurementRow & { values: { od: number } }>>(
      app,
      doctorToken,
      'measurement.listByPatient',
      { patientId: fixtures.tenantA.patientId },
    );
    expect(res.status).toBe(200);
    const items = res.body.result.data;
    expect(items).toHaveLength(2);
    expect(items[0]!.values.od).toBe(15);
  });

  it('list type filtresi sadece eşleşen tipi döner', async () => {
    await prisma.measurement.createMany({
      data: [
        {
          tenantId: fixtures.tenantA.id,
          patientId: fixtures.tenantA.patientId,
          type: 'intraocular_pressure',
          measuredById: doctorUserId,
          measuredAt: new Date(),
          values: { od: 14, os: 15 },
        },
        {
          tenantId: fixtures.tenantA.id,
          patientId: fixtures.tenantA.patientId,
          type: 'visual_acuity',
          measuredById: doctorUserId,
          measuredAt: new Date(),
          values: { od: '1.0', os: '0.9' },
        },
      ],
    });
    const res = await trpcQuery<{ items: MeasurementRow[]; total: number }>(
      app,
      doctorToken,
      'measurement.list',
      { patientId: fixtures.tenantA.patientId, type: 'visual_acuity' },
    );
    expect(res.status).toBe(200);
    expect(res.body.result.data.total).toBe(1);
    expect(res.body.result.data.items[0]!.type).toBe('visual_acuity');
  });

  it('same-day update by owning user → 200', async () => {
    const created = await prisma.measurement.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        type: 'intraocular_pressure',
        measuredById: doctorUserId,
        measuredAt: new Date(),
        values: { od: 14, os: 15 },
      },
    });
    const res = await trpcMutation(app, doctorToken, 'measurement.update', {
      id: created.id,
      data: { values: { od: 13, os: 14 } },
    });
    expect(res.status).toBe(200);
  });

  it('next-day update by owning user → 400 (same-day window expired)', async () => {
    const created = await prisma.measurement.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        type: 'intraocular_pressure',
        measuredById: doctorUserId,
        measuredAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        values: { od: 14, os: 15 },
      },
    });
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/measurement.update')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ id: created.id, data: { notes: 'attempted late edit' } });
    expect(res.status).toBe(400);
  });

  it('next-day update by yonetici → 403 (karar tutanağı §6.2: ölçüm sadece doktor+hemşire)', async () => {
    // S3/S9 — Yönetici measurement.update yapamaz; permissions.ts registry
    // 'action:measurement.update' sadece doktor + hemşire'ye izinli.
    const created = await prisma.measurement.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        type: 'intraocular_pressure',
        measuredById: doctorUserId,
        measuredAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        values: { od: 14, os: 15 },
      },
    });
    const res = await trpcMutation(app, adminToken, 'measurement.update', {
      id: created.id,
      data: { notes: 'admin late edit' },
    });
    expect(res.status).toBe(403);
  });

  it('başka doktorun aynı-gün ölçümünü düzenleme → 403', async () => {
    // İkinci bir doktor user yarat ve onun ölçümünü ekle
    const otherDoctorId = (
      await prisma.user.create({
        data: {
          tenantId: fixtures.tenantA.id,
          email: 'other-doc@a-measure.test',
          passwordHash: await bcrypt.hash('x', 4),
          name: 'Other Doc',
          status: 'active',
        },
      })
    ).id;
    const created = await prisma.measurement.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        type: 'visual_acuity',
        measuredById: otherDoctorId,
        measuredAt: new Date(),
        values: { od: '1.0', os: '1.0' },
      },
    });
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/measurement.update')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ id: created.id, data: { notes: 'not mine' } });
    expect(res.status).toBe(403);
  });

  it('softDelete owning doctor same-day → tarihte gözükmez', async () => {
    const created = await prisma.measurement.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        type: 'intraocular_pressure',
        measuredById: doctorUserId,
        measuredAt: new Date(),
        values: { od: 14, os: 15 },
      },
    });
    const del = await trpcMutation<{ ok: true }>(app, doctorToken, 'measurement.softDelete', {
      id: created.id,
    });
    expect(del.status).toBe(200);

    const list = await trpcQuery<MeasurementRow[]>(app, doctorToken, 'measurement.listByPatient', {
      patientId: fixtures.tenantA.patientId,
    });
    expect(list.body.result.data).toHaveLength(0);
  });

  it('cross-tenant: tenant B kullanıcısı tenant A ölçümünü okuyamaz (RLS)', async () => {
    const created = await prisma.measurement.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        type: 'intraocular_pressure',
        measuredById: doctorUserId,
        measuredAt: new Date(),
        values: { od: 14, os: 15 },
      },
    });
    const tokenB = await login(
      app,
      fixtures.tenantB.slug,
      fixtures.tenantB.adminEmail,
      fixtures.tenantB.adminPassword,
    );
    const res = await request(app.getHttpServer() as App)
      .get(
        `/api/trpc/measurement.findById?input=${encodeURIComponent(JSON.stringify({ id: created.id }))}`,
      )
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });
});
