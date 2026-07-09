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
interface NotifRow {
  id: string;
  title: string;
  readAt: string | null;
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
  input: unknown,
): Promise<{ status: number; body: TrpcSuccess<T> }> {
  const res = await request(app.getHttpServer() as App)
    .get(`/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body as TrpcSuccess<T> };
}

async function trpcMutation<T>(
  app: INestApplication,
  token: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: TrpcSuccess<T> }> {
  const res = await request(app.getHttpServer() as App)
    .post(`/api/trpc/${path}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  return { status: res.status, body: res.body as TrpcSuccess<T> };
}

describe('S15b Notification module (inbox + kullanıcı izolasyonu)', () => {
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
    await prisma.notification.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.notification.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.$disconnect();
    await app.close();
  });

  async function seedForAdmin(title = 'Ölçüm hazır') {
    await prisma.notification.create({
      data: {
        tenantId: fixtures.tenantA.id,
        recipientUserId: adminUserId,
        type: 'measurement_ready',
        title,
      },
    });
  }

  it('admin kendi bildirimini listeler + unreadCount = 1', async () => {
    await seedForAdmin();
    const count = await trpcQuery<number>(app, adminToken, 'notification.unreadCount', undefined);
    expect(count.status).toBe(200);
    expect(count.body.result.data).toBe(1);

    const list = await trpcQuery<NotifRow[]>(app, adminToken, 'notification.list', {
      limit: 30,
      unreadOnly: false,
    });
    expect(list.body.result.data).toHaveLength(1);
  });

  it('başka kullanıcı (resepsiyon) admin bildirimini görmez', async () => {
    await seedForAdmin();
    const list = await trpcQuery<NotifRow[]>(app, receptionToken, 'notification.list', {
      limit: 30,
      unreadOnly: false,
    });
    expect(list.body.result.data).toEqual([]);
    const count = await trpcQuery<number>(
      app,
      receptionToken,
      'notification.unreadCount',
      undefined,
    );
    expect(count.body.result.data).toBe(0);
  });

  it('markAllRead sonrası unreadCount = 0', async () => {
    await seedForAdmin();
    await seedForAdmin('İkinci');
    const res = await trpcMutation<{ count: number }>(
      app,
      adminToken,
      'notification.markAllRead',
      {},
    );
    expect(res.status).toBe(200);
    const count = await trpcQuery<number>(app, adminToken, 'notification.unreadCount', undefined);
    expect(count.body.result.data).toBe(0);
  });
});
