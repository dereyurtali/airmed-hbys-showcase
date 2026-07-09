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
interface SurgeryRow {
  id: string;
  type: string;
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

async function trpcQuery<T>(
  app: INestApplication,
  token: string,
  path: string,
): Promise<{ status: number; body: TrpcSuccess<T> }> {
  const res = await request(app.getHttpServer() as App)
    .get(`/api/trpc/${path}`)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body as TrpcSuccess<T> };
}

describe('S15 Surgery handoff (ameliyat satış kuyruğu — rol gating)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let receptionToken: string;
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
    receptionToken = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.receptionistEmail!,
      fixtures.tenantA.receptionistPassword!,
    );

    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const dr = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        name: 'TEST_S15_HANDOFF Dr',
        specialty: 'Göz',
        type: 'local',
      },
    });
    doctorId = dr.id;
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.surgery.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.surgery.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.doctor.deleteMany({
      where: { tenantId: fixtures.tenantA.id, name: { contains: 'TEST_S15_HANDOFF' } },
    });
    await prisma.$disconnect();
    await app.close();
  });

  async function seedPlannedSurgery() {
    await prisma.surgery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId,
        type: 'cataract_phaco',
        status: 'planned',
        scheduledAt: new Date('2027-04-01T09:00:00.000Z'),
      },
    });
  }

  it('handoffQueue: admin → 200, planlanan cerrahiyi döner', async () => {
    await seedPlannedSurgery();
    const res = await trpcQuery<SurgeryRow[]>(app, adminToken, 'surgery.handoffQueue');
    expect(res.status).toBe(200);
    expect(res.body.result.data).toHaveLength(1);
    expect(res.body.result.data[0].status).toBe('planned');
  });

  it('handoffQueue: resepsiyon → 403 (devir izni yok)', async () => {
    const res = await trpcQuery(app, receptionToken, 'surgery.handoffQueue');
    expect(res.status).toBe(403);
  });
});
