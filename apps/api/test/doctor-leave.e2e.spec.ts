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

interface LeaveRow {
  id: string;
  doctorId: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
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

describe('A5 doctor leaves (tRPC)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let doctorId: string;

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

    // Bir test doktoru oluştur (leave için bağımlılık).
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const doctor = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        name: 'TEST_A5_LEAVE Hekim',
        specialty: 'Göz Hastalıkları',
        type: 'local',
      },
    });
    doctorId = doctor.id;
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.doctorLeave.deleteMany({ where: { doctorId } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('addLeave creates a leave row with reason', async () => {
    const res = await trpcMutation<LeaveRow>(app, adminToken, 'doctor.addLeave', {
      doctorId,
      startsAt: '2026-06-15T00:00:00.000Z',
      endsAt: '2026-06-20T00:00:00.000Z',
      reason: 'Yıllık izin',
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.doctorId).toBe(doctorId);
    expect(res.body.result.data.reason).toBe('Yıllık izin');
  });

  it('addLeave 400 when endsAt <= startsAt', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/doctor.addLeave')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        doctorId,
        startsAt: '2026-06-15T00:00:00.000Z',
        endsAt: '2026-06-15T00:00:00.000Z',
      });
    expect(res.status).toBe(400);
  });

  it('listLeaves returns active + future, drops fully-past leaves', async () => {
    const past = await prisma.doctorLeave.create({
      data: {
        tenantId: fixtures.tenantA.id,
        doctorId,
        startsAt: new Date('2020-01-01'),
        endsAt: new Date('2020-01-05'),
      },
    });
    const future = await prisma.doctorLeave.create({
      data: {
        tenantId: fixtures.tenantA.id,
        doctorId,
        startsAt: new Date('2099-01-01'),
        endsAt: new Date('2099-01-05'),
      },
    });
    const res = await trpcQuery<LeaveRow[]>(app, adminToken, 'doctor.listLeaves', {
      doctorId,
    });
    expect(res.status).toBe(200);
    const ids = res.body.result.data.map((l) => l.id);
    expect(ids).toContain(future.id);
    expect(ids).not.toContain(past.id);
  });

  it('findLeavesInRange returns overlapping leaves only', async () => {
    await prisma.doctorLeave.createMany({
      data: [
        {
          tenantId: fixtures.tenantA.id,
          doctorId,
          startsAt: new Date('2026-07-10'),
          endsAt: new Date('2026-07-15'),
        },
        {
          tenantId: fixtures.tenantA.id,
          doctorId,
          startsAt: new Date('2026-08-01'),
          endsAt: new Date('2026-08-05'),
        },
      ],
    });
    const res = await trpcQuery<LeaveRow[]>(app, adminToken, 'doctor.findLeavesInRange', {
      doctorId,
      dateFrom: '2026-07-01T00:00:00.000Z',
      dateTo: '2026-07-31T00:00:00.000Z',
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data).toHaveLength(1);
    expect(new Date(res.body.result.data[0]!.startsAt).getMonth()).toBe(6); // July (0-indexed)
  });

  it('deleteLeave removes the row', async () => {
    const created = await prisma.doctorLeave.create({
      data: {
        tenantId: fixtures.tenantA.id,
        doctorId,
        startsAt: new Date('2026-09-01'),
        endsAt: new Date('2026-09-05'),
      },
    });
    const res = await trpcMutation<{ ok: true }>(app, adminToken, 'doctor.deleteLeave', {
      id: created.id,
    });
    expect(res.status).toBe(200);
    const after = await prisma.doctorLeave.findUnique({ where: { id: created.id } });
    expect(after).toBeNull();
  });
});
