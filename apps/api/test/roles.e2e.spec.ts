import type { INestApplication } from '@nestjs/common';
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

// S17 — tRPC userAdmin.list permission guard'ı. permissionProcedure('action:user.list')
// yonetici-only. Eski stub `/api/admin/users` REST controller'ı kaldırıldı; bu spec
// yeni tRPC endpoint'i (userAdmin.list) için 401/FORBIDDEN/200 senaryolarını doğrular.
//
// tRPC v11 query URL: /api/trpc/<router>.<proc>?input=<json>
//   - 401 (HTTP): JWT yok (JwtAuthGuard reject)
//   - 200 (HTTP) + body.error.data.code='FORBIDDEN': permissionProcedure reject
//   - 200 (HTTP) + body.result.data: başarılı sorgu (superjson transformer yok,
//     bu yüzden 'json' wrapper'ı yok — input ve response düz JSON)
const LIST_INPUT = encodeURIComponent(JSON.stringify({ page: 1, pageSize: 50 }));
const LIST_URL = `/api/trpc/userAdmin.list?input=${LIST_INPUT}`;

describe('Role-based authorization (userAdmin tRPC)', () => {
  let app: INestApplication;
  let fixtures: IsolationFixtures;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('JWT olmadan userAdmin.list → 401', async () => {
    const res = await request(app.getHttpServer() as App).get(LIST_URL);
    expect(res.status).toBe(401);
  });

  it('resepsiyon kullanıcısı için userAdmin.list → FORBIDDEN', async () => {
    const token = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.receptionistEmail!,
      fixtures.tenantA.receptionistPassword!,
    );
    const res = await request(app.getHttpServer() as App)
      .get(LIST_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.body?.error?.data?.code).toBe('FORBIDDEN');
  });

  it('yonetici kullanıcısı için userAdmin.list → 200 + items dizisi', async () => {
    const token = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    const res = await request(app.getHttpServer() as App)
      .get(LIST_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const data = res.body?.result?.data;
    expect(data).toBeDefined();
    expect(Array.isArray(data.items)).toBe(true);
    expect(typeof data.total).toBe('number');
  });
});
