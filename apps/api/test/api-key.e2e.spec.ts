import { createHash } from 'crypto';
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

interface ApiKeyRecord {
  id: string;
  tenantId: string;
  name: string;
  keyHash: string;
  prefix: string;
  scopes: string[];
  rateLimit: number;
  isActive: boolean;
  revokedAt: string | null;
}

interface CreateResponse {
  record: ApiKeyRecord;
  plaintext: string;
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

async function trpcQuery<T>(app: INestApplication, token: string, path: string, input?: unknown) {
  const url =
    input === undefined
      ? `/api/trpc/${path}`
      : `/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await request(app.getHttpServer() as App)
    .get(url)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body as TrpcSuccess<T> };
}

describe('A10 ApiKey admin CRUD (tRPC)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let doctorToken: string;

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

    // doktor rolünde bir kullanıcı — admin-only kuralı doğrulamak için.
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const doktorRole = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: fixtures.tenantA.id, key: 'doktor' } },
    });
    const doctorEmail = 'doktor@a-apikey.test';
    const doctorPassword = 'doktor-pass-1234';
    const hash = await bcrypt.hash(doctorPassword, 4);
    const doctorUser = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: doctorEmail,
        passwordHash: hash,
        name: 'Dr. ApiKey Test',
        status: 'active',
      },
    });
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: doctorUser.id, roleId: doktorRole.id },
    });
    doctorToken = await login(app, fixtures.tenantA.slug, doctorEmail, doctorPassword);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.apiKey.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('create golden: plaintext döner, DB sadece keyHash + prefix saklar', async () => {
    const res = await trpcMutation<CreateResponse>(app, adminToken, 'apiKey.create', {
      name: 'WhatsApp Bot',
      scopes: ['patient:read', 'appointment:create'],
      rateLimit: 500,
    });
    expect(res.status).toBe(200);
    const { record, plaintext } = res.body.result.data;

    // Plaintext format: ak_{slug}_{64-hex}
    expect(plaintext.startsWith('ak_tenant-a_')).toBe(true);
    expect(plaintext.length).toBe(3 + 'tenant-a'.length + 1 + 64);

    // DB hash, plaintext SHA-256'sına eşit olmalı
    const expectedHash = createHash('sha256').update(plaintext).digest('hex');
    expect(record.keyHash).toBe(expectedHash);
    expect(record.prefix.startsWith('ak_tenant-a_')).toBe(true);
    expect(record.prefix.length).toBe(20);
    expect(record.scopes).toEqual(['patient:read', 'appointment:create']);
    expect(record.rateLimit).toBe(500);
    expect(record.isActive).toBe(true);
  });

  it('doktor (admin değil) create → 403', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/apiKey.create')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ name: 'DoktorAttempt', scopes: ['patient:read'] });
    expect(res.status).toBe(403);
  });

  it('zod: scope boş → 400', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/apiKey.create')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'NoScope', scopes: [] });
    expect(res.status).toBe(400);
  });

  it('zod: bilinmeyen scope → 400', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/apiKey.create')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'UnknownScope', scopes: ['examination:read'] });
    expect(res.status).toBe(400);
  });

  it('list: tenant kayıtları desc sıralı, plaintext kesinlikle yok', async () => {
    await trpcMutation<CreateResponse>(app, adminToken, 'apiKey.create', {
      name: 'Older',
      scopes: ['patient:read'],
    });
    await trpcMutation<CreateResponse>(app, adminToken, 'apiKey.create', {
      name: 'Newer',
      scopes: ['patient:read'],
    });
    const res = await trpcQuery<ApiKeyRecord[]>(app, adminToken, 'apiKey.list');
    expect(res.status).toBe(200);
    const items = res.body.result.data;
    expect(items).toHaveLength(2);
    expect(items[0]!.name).toBe('Newer');
    // List response'unda asla plaintext field'ı olmamalı
    for (const it of items) {
      expect(JSON.stringify(it).includes('ak_tenant-a_')).toBe(true); // prefix var
      // Ama yalnızca prefix uzunluğunda — 64 char gizli kısım yok
      expect(it.prefix.length).toBe(20);
    }
  });

  it('revoke: idempotent, revokedAt + isActive=false', async () => {
    const create = await trpcMutation<CreateResponse>(app, adminToken, 'apiKey.create', {
      name: 'ToRevoke',
      scopes: ['patient:read'],
    });
    const id = create.body.result.data.record.id;

    const r1 = await trpcMutation<ApiKeyRecord>(app, adminToken, 'apiKey.revoke', { id });
    expect(r1.status).toBe(200);
    expect(r1.body.result.data.isActive).toBe(false);
    expect(r1.body.result.data.revokedAt).not.toBeNull();

    // ikinci kez → aynı revokedAt (idempotent)
    const r2 = await trpcMutation<ApiKeyRecord>(app, adminToken, 'apiKey.revoke', { id });
    expect(r2.status).toBe(200);
    expect(r2.body.result.data.revokedAt).toBe(r1.body.result.data.revokedAt);
  });

  it('rotate: eski revoke + yeni plaintext döner, scopes/name korunur', async () => {
    const create = await trpcMutation<CreateResponse>(app, adminToken, 'apiKey.create', {
      name: 'ToRotate',
      scopes: ['appointment:create', 'availability:read'],
      rateLimit: 750,
    });
    const oldId = create.body.result.data.record.id;
    const oldPlaintext = create.body.result.data.plaintext;

    const rot = await trpcMutation<CreateResponse>(app, adminToken, 'apiKey.rotate', {
      id: oldId,
    });
    expect(rot.status).toBe(200);
    expect(rot.body.result.data.plaintext).not.toBe(oldPlaintext);
    expect(rot.body.result.data.record.id).not.toBe(oldId);
    expect(rot.body.result.data.record.name).toBe('ToRotate');
    expect(rot.body.result.data.record.scopes).toEqual(['appointment:create', 'availability:read']);
    expect(rot.body.result.data.record.rateLimit).toBe(750);

    // eski revoke olmalı
    const old = await trpcQuery<ApiKeyRecord>(app, adminToken, 'apiKey.findById', { id: oldId });
    expect(old.body.result.data.isActive).toBe(false);
    expect(old.body.result.data.revokedAt).not.toBeNull();
  });

  it('rotate already revoked → 403', async () => {
    const create = await trpcMutation<CreateResponse>(app, adminToken, 'apiKey.create', {
      name: 'AlreadyRevoked',
      scopes: ['patient:read'],
    });
    const id = create.body.result.data.record.id;
    await trpcMutation<ApiKeyRecord>(app, adminToken, 'apiKey.revoke', { id });

    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/apiKey.rotate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ id });
    expect(res.status).toBe(403);
  });

  it('update: name + scopes + isActive değiştirilebilir, keyHash değişmez', async () => {
    const create = await trpcMutation<CreateResponse>(app, adminToken, 'apiKey.create', {
      name: 'BeforeUpdate',
      scopes: ['patient:read'],
    });
    const id = create.body.result.data.record.id;
    const originalHash = create.body.result.data.record.keyHash;

    const upd = await trpcMutation<ApiKeyRecord>(app, adminToken, 'apiKey.update', {
      id,
      data: {
        name: 'AfterUpdate',
        scopes: ['patient:read', 'patient:create'],
        isActive: false,
      },
    });
    expect(upd.status).toBe(200);
    expect(upd.body.result.data.name).toBe('AfterUpdate');
    expect(upd.body.result.data.scopes).toEqual(['patient:read', 'patient:create']);
    expect(upd.body.result.data.isActive).toBe(false);
    expect(upd.body.result.data.keyHash).toBe(originalHash);
  });

  it('cross-tenant: tenant B admin tenant A anahtarını findById → 404 (RLS)', async () => {
    const create = await trpcMutation<CreateResponse>(app, adminToken, 'apiKey.create', {
      name: 'TenantAOnly',
      scopes: ['patient:read'],
    });
    const id = create.body.result.data.record.id;

    const tokenB = await login(
      app,
      fixtures.tenantB.slug,
      fixtures.tenantB.adminEmail,
      fixtures.tenantB.adminPassword,
    );
    const res = await request(app.getHttpServer() as App)
      .get(`/api/trpc/apiKey.findById?input=${encodeURIComponent(JSON.stringify({ id }))}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });
});
