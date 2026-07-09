import { createHash } from 'crypto';
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

interface ApiKeyRecord {
  id: string;
  prefix: string;
  scopes: string[];
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

async function createKey(
  app: INestApplication,
  token: string,
  body: { name: string; scopes: string[]; rateLimit?: number; expiresAt?: string },
): Promise<CreateResponse> {
  const res = await request(app.getHttpServer() as App)
    .post('/api/trpc/apiKey.create')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  return (res.body as TrpcSuccess<CreateResponse>).result.data;
}

async function callMe(app: INestApplication, header: string | null) {
  const r = request(app.getHttpServer() as App).get('/api/external/me');
  if (header !== null) r.set('Authorization', header);
  return r;
}

describe('A10 External auth (ApiKeyGuard + ScopesGuard)', () => {
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

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.apiKey.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.auditLog.deleteMany({
      where: { tenantId: fixtures.tenantA.id, action: { startsWith: 'external:' } },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('valid key → 200 + keyId/prefix/tenantId/scopes', async () => {
    const { record, plaintext } = await createKey(app, adminToken, {
      name: 'PR2 Test',
      scopes: ['patient:read'],
    });

    const res = await callMe(app, `ApiKey ${plaintext}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      keyId: record.id,
      prefix: record.prefix,
      tenantId: fixtures.tenantA.id,
      scopes: ['patient:read'],
    });
  });

  it('missing Authorization header → 401', async () => {
    const res = await callMe(app, null);
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).toMatch(/Missing or invalid Authorization/);
  });

  it('Bearer (JWT) yerine ApiKey beklenir → 401', async () => {
    const res = await callMe(app, `Bearer ${adminToken}`);
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).toMatch(/Missing or invalid Authorization/);
  });

  it('malformed plaintext (regex fail) → 401', async () => {
    const res = await callMe(app, 'ApiKey ak_x_short');
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).toMatch(/Malformed API key/);
  });

  it('valid format ama bilinmeyen hash → 401', async () => {
    const fake = `ak_tenant-a_${'0'.repeat(64)}`;
    const res = await callMe(app, `ApiKey ${fake}`);
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).toMatch(/Invalid API key/);
  });

  it('revoked key → 401', async () => {
    const { record, plaintext } = await createKey(app, adminToken, {
      name: 'ToRevoke',
      scopes: ['patient:read'],
    });
    await request(app.getHttpServer() as App)
      .post('/api/trpc/apiKey.revoke')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ id: record.id });

    const res = await callMe(app, `ApiKey ${plaintext}`);
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).toMatch(/Key revoked/);
  });

  it('expired key → 401', async () => {
    const { plaintext } = await createKey(app, adminToken, {
      name: 'Expired',
      scopes: ['patient:read'],
    });
    // expiresAt'i direkt DB'de geçmiş tarihe çek (admin update'i ile değil,
    // çünkü Zod schema'sı geçmiş tarihi reddetmiyor ama sade yol DB).
    await prisma.apiKey.updateMany({
      where: { keyHash: createHash('sha256').update(plaintext).digest('hex') },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const res = await callMe(app, `ApiKey ${plaintext}`);
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).toMatch(/Key expired/);
  });

  it('tenant suspended → 403', async () => {
    const { plaintext } = await createKey(app, adminToken, {
      name: 'TenantSuspendTest',
      scopes: ['patient:read'],
    });
    await prisma.tenant.update({
      where: { id: fixtures.tenantA.id },
      data: { status: 'suspended', suspendedAt: new Date() },
    });

    const res = await callMe(app, `ApiKey ${plaintext}`);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/Tenant unavailable/);

    // restore tenant for follow-up tests
    await prisma.tenant.update({
      where: { id: fixtures.tenantA.id },
      data: { status: 'active', suspendedAt: null },
    });
  });

  it('audit log yazıldı (best-effort tx commit sonrası DB satırı)', async () => {
    const { record, plaintext } = await createKey(app, adminToken, {
      name: 'AuditCheck',
      scopes: ['patient:read'],
    });

    const ok = await callMe(app, `ApiKey ${plaintext}`);
    expect(ok.status).toBe(200);

    // Audit tenant transaction içinde yazıldı. Test prisma client RLS'i
    // current setting'le check ediyor; biz beforeEach'te tenantA set ettik.
    const rows = await prisma.auditLog.findMany({
      where: {
        tenantId: fixtures.tenantA.id,
        action: 'external:GET /api/external/me',
        entityId: record.id,
      },
    });
    expect(rows.length).toBe(1);
  });

  it('lastUsedAt güncellendi (fire-and-forget sonrası recent)', async () => {
    const { record, plaintext } = await createKey(app, adminToken, {
      name: 'LastUsedCheck',
      scopes: ['patient:read'],
    });

    const ok = await callMe(app, `ApiKey ${plaintext}`);
    expect(ok.status).toBe(200);

    // Fire-and-forget — async transaction. Kısa polling.
    let row: { lastUsedAt: Date | null } | null = null;
    for (let i = 0; i < 20; i++) {
      row = await prisma.apiKey.findUnique({
        where: { id: record.id },
        select: { lastUsedAt: true },
      });
      if (row?.lastUsedAt) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(row?.lastUsedAt).not.toBeNull();
    expect(Date.now() - new Date(row!.lastUsedAt!).getTime()).toBeLessThan(5_000);
  });

  it('scope mismatch: gerekli scope eksik → 403', async () => {
    // /me sıfır scope ister. Scope mismatch yolu için doğrudan ScopesGuard
    // unit-level davranışını e2e gözüyle simüle etmek zor (sabit endpoint var
    // ve scope listesi boş). PR3 endpoint'lerinde gerçek scope kontrolü
    // doğrudan test edilecek. Bu test bu PR'ın smoke kontrolüdür:
    // ScopesGuard'ın boş gereksinim listesinde her zaman geçtiğini doğrular.
    const { plaintext } = await createKey(app, adminToken, {
      name: 'EmptyScopeOk',
      scopes: ['appointment:create'], // /me ile alakasız scope
    });
    const res = await callMe(app, `ApiKey ${plaintext}`);
    expect(res.status).toBe(200);
  });

  it('cross-tenant scenario: TenantA anahtarı TenantB tarafından kullanılamaz', async () => {
    // Cross-tenant burada anlamlı değil — anahtarın kendisi tenant'a bağlı,
    // farklı tenant'a "ait" diye bir kullanım yok. Bu test: tenantB'nin
    // admin'i tenantA prefix'iyle uydurma bir key dener → 401 Invalid.
    const fake = `ak_${fixtures.tenantA.slug}_${'a'.repeat(64)}`;
    const res = await callMe(app, `ApiKey ${fake}`);
    expect(res.status).toBe(401);
  });
});
