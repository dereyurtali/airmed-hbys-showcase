import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

interface LoginBody {
  accessToken: string;
  mustChangePassword: boolean;
}

async function login(
  app: INestApplication,
  slug: string,
  email: string,
  password: string,
): Promise<{ accessToken: string; cookie: string }> {
  const res = await request(app.getHttpServer() as App)
    .post('/api/auth/login')
    .send({ tenantSlug: slug, email, password });
  const setCookie = res.headers['set-cookie'];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : (setCookie ?? '');
  const cookie = cookieHeader.split(';')[0];
  return { accessToken: (res.body as LoginBody).accessToken, cookie };
}

describe('HTTP cross-tenant isolation', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let fixtures: IsolationFixtures;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('tRPC auth.me returns the caller tenantId, not a sibling tenant id', async () => {
    const a = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      'isolation-pass',
    );
    const b = await login(
      app,
      fixtures.tenantB.slug,
      fixtures.tenantB.adminEmail,
      'isolation-pass',
    );

    const aRes = await request(app.getHttpServer() as App)
      .get('/api/trpc/auth.me')
      .set('Authorization', `Bearer ${a.accessToken}`);
    expect(aRes.status).toBe(200);
    expect(aRes.body.result.data.tenantId).toBe(fixtures.tenantA.id);

    const bRes = await request(app.getHttpServer() as App)
      .get('/api/trpc/auth.me')
      .set('Authorization', `Bearer ${b.accessToken}`);
    expect(bRes.status).toBe(200);
    expect(bRes.body.result.data.tenantId).toBe(fixtures.tenantB.id);
    expect(bRes.body.result.data.tenantId).not.toBe(fixtures.tenantA.id);
  });

  it('JWT signed with the wrong secret is rejected', async () => {
    const forged = jwt.sign(
      {
        sub: fixtures.tenantA.adminId,
        tenantId: fixtures.tenantA.id,
        email: fixtures.tenantA.adminEmail,
        roles: ['yonetici'],
      },
      { secret: 'an-attacker-controlled-secret' },
    );

    const trpcRes = await request(app.getHttpServer() as App)
      .get('/api/trpc/auth.me')
      .set('Authorization', `Bearer ${forged}`);
    // tRPC context fails to verify; protectedProcedure responds UNAUTHORIZED.
    expect(trpcRes.body.error?.data?.code).toBe('UNAUTHORIZED');

    const restRes = await request(app.getHttpServer() as App)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${forged}`)
      .send({ currentPassword: 'isolation-pass', newPassword: 'newpass-x' });
    expect(restRes.status).toBe(401);
  });

  it("change-password run by tenant A admin cannot rotate tenant B admin's password", async () => {
    const a = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      'isolation-pass',
    );

    // Even forging a JWT that points sub=B's admin requires the correct signing secret —
    // we exercise the realistic path: A's token, valid currentPassword, see the result land on A's row.
    const res = await request(app.getHttpServer() as App)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ currentPassword: 'isolation-pass', newPassword: 'rotated-by-a' });
    expect(res.status).toBe(204);

    // Tenant B admin's password is unchanged.
    const bLogin = await request(app.getHttpServer() as App)
      .post('/api/auth/login')
      .send({
        tenantSlug: fixtures.tenantB.slug,
        email: fixtures.tenantB.adminEmail,
        password: 'isolation-pass',
      });
    expect(bLogin.status).toBe(200);

    // Restore A admin password for any subsequent test ordering safety.
    const aReLogin = await request(app.getHttpServer() as App)
      .post('/api/auth/login')
      .send({
        tenantSlug: fixtures.tenantA.slug,
        email: fixtures.tenantA.adminEmail,
        password: 'rotated-by-a',
      });
    expect(aReLogin.status).toBe(200);
    await request(app.getHttpServer() as App)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${(aReLogin.body as LoginBody).accessToken}`)
      .send({ currentPassword: 'rotated-by-a', newPassword: 'isolation-pass' });
  });

  it('forged JWT with foreign tenantId still fails the suspended/missing check via signature', async () => {
    // Even if an attacker had access to the real signing secret, this test documents
    // the protection chain — without the secret the token does not verify.
    const forged = jwt.sign(
      {
        sub: fixtures.tenantA.adminId,
        tenantId: fixtures.tenantB.id,
        email: fixtures.tenantA.adminEmail,
        roles: ['yonetici'],
      },
      { secret: 'definitely-not-the-real-secret' },
    );
    const res = await request(app.getHttpServer() as App)
      .get('/api/trpc/auth.me')
      .set('Authorization', `Bearer ${forged}`);
    expect(res.body.error?.data?.code).toBe('UNAUTHORIZED');
  });

  it('public health endpoint is reachable without any auth', async () => {
    const res = await request(app.getHttpServer() as App).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
