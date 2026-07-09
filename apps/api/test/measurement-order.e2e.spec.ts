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
interface OrderRow {
  id: string;
  status: string;
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

async function trpcMutation(
  app: INestApplication,
  token: string,
  path: string,
  body: unknown,
): Promise<{ status: number }> {
  const res = await request(app.getHttpServer() as App)
    .post(`/api/trpc/${path}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  return { status: res.status };
}

async function trpcQuery<T>(
  app: INestApplication,
  token: string,
  path: string,
  input: unknown,
): Promise<{ status: number; body: TrpcSuccess<T> }> {
  const res = await request(app.getHttpServer() as App)
    .get(`/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body as TrpcSuccess<T> };
}

describe('S15c MeasurementOrder module (rol gating + ölçüm birimi kuyruğu)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let receptionToken: string;
  let adminUserId: string;

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
    receptionToken = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.receptionistEmail!,
      fixtures.tenantA.receptionistPassword!,
    );

    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const admin = await prisma.user.findFirstOrThrow({
      where: { tenantId: fixtures.tenantA.id, email: fixtures.tenantA.adminEmail },
      select: { id: true },
    });
    adminUserId = admin.id;
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.measurementOrder.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.measurementOrder.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.$disconnect();
    await app.close();
  });

  it('createOrder: yönetici (doktor değil) → 403', async () => {
    const res = await trpcMutation(app, adminToken, 'measurementOrder.create', {
      patientId: fixtures.tenantA.patientId,
      requestedTypes: ['biometry'],
      serviceItemIds: [],
    });
    expect(res.status).toBe(403);
  });

  it('createOrder: resepsiyon → 403', async () => {
    const res = await trpcMutation(app, receptionToken, 'measurementOrder.create', {
      patientId: fixtures.tenantA.patientId,
      requestedTypes: ['biometry'],
      serviceItemIds: [],
    });
    expect(res.status).toBe(403);
  });

  it('listForUnit: admin → 200, seed edilen aktif siparişi döner', async () => {
    await prisma.measurementOrder.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        orderedById: adminUserId,
        requestedTypes: ['biometry'],
        serviceItemIds: [],
        requiresPayment: false,
        status: 'requested',
      },
    });
    const res = await trpcQuery<OrderRow[]>(app, adminToken, 'measurementOrder.listForUnit', {});
    expect(res.status).toBe(200);
    expect(res.body.result.data).toHaveLength(1);
    expect(res.body.result.data[0].status).toBe('requested');
  });

  it('listForUnit: resepsiyon → 403 (kuyruk izni yok)', async () => {
    const res = await trpcQuery(app, receptionToken, 'measurementOrder.listForUnit', {});
    expect(res.status).toBe(403);
  });
});
