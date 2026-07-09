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

interface IcdMatch {
  code: string;
  category: string;
  tr: string;
  ru: string;
  tg: string;
}

async function login(app: INestApplication, slug: string, email: string, password: string) {
  const res = await request(app.getHttpServer() as App)
    .post('/api/auth/login')
    .send({ tenantSlug: slug, email, password });
  return (res.body as LoginBody).accessToken;
}

async function trpcQuery<T>(app: INestApplication, token: string, route: string, input: unknown) {
  const url = `/api/trpc/${route}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await request(app.getHttpServer() as App)
    .get(url)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body as TrpcSuccess<T> };
}

describe('E4 ICD-10 search', () => {
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

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('search by code prefix: "H25" → katarakt grubu', async () => {
    const res = await trpcQuery<IcdMatch[]>(app, adminToken, 'icd.search', {
      query: 'H25',
      locale: 'tr',
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.length).toBeGreaterThan(0);
    for (const m of res.body.result.data) expect(m.code).toMatch(/^H25/i);
  });

  it('search by Turkish term: "katarakt" → lens kategori', async () => {
    const res = await trpcQuery<IcdMatch[]>(app, adminToken, 'icd.search', {
      query: 'katarakt',
      locale: 'tr',
    });
    expect(res.body.result.data.length).toBeGreaterThan(0);
    for (const m of res.body.result.data) expect(m.category).toBe('lens');
  });

  it('search by Russian term: "глаукома" → glaucoma kategori', async () => {
    const res = await trpcQuery<IcdMatch[]>(app, adminToken, 'icd.search', {
      query: 'глаукома',
      locale: 'ru',
    });
    expect(res.body.result.data.length).toBeGreaterThan(0);
    for (const m of res.body.result.data) expect(m.category).toBe('glaucoma');
  });

  it('search empty query → boş', async () => {
    const res = await request(app.getHttpServer() as App)
      .get(
        `/api/trpc/icd.search?input=${encodeURIComponent(JSON.stringify({ query: '', locale: 'tr' }))}`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400); // zod min(1)
  });

  it('search limit kontrolü (default 25)', async () => {
    const res = await trpcQuery<IcdMatch[]>(app, adminToken, 'icd.search', {
      query: 'H',
      locale: 'tr',
    });
    expect(res.body.result.data.length).toBeLessThanOrEqual(25);
  });

  it('getByCodes: kod listesinden detay döner', async () => {
    const res = await trpcQuery<IcdMatch[]>(app, adminToken, 'icd.getByCodes', {
      codes: ['H25.0', 'H40.1', 'NOT_REAL'],
    });
    expect(res.status).toBe(200);
    const codes = res.body.result.data.map((c) => c.code);
    expect(codes).toContain('H25.0');
    expect(codes).toContain('H40.1');
    expect(codes).not.toContain('NOT_REAL');
  });

  it('unauthenticated → 401', async () => {
    const res = await request(app.getHttpServer() as App).get(
      `/api/trpc/icd.search?input=${encodeURIComponent(JSON.stringify({ query: 'H25', locale: 'tr' }))}`,
    );
    expect(res.status).toBe(401);
  });
});
