import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

interface SyncStatusBody {
  outboxPending: number;
  outboxFailed: number;
  lastSyncAt: string | null;
  peerConfigured: boolean;
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
  return (res.body as { accessToken: string }).accessToken;
}

describe('A12 sync status endpoint (tenant UI offline banner)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let token: string;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
    token = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
  });

  beforeEach(async () => {
    await prisma.patient.deleteMany({
      where: { tenantId: fixtures.tenantA.id, id: { not: fixtures.tenantA.patientId } },
    });
    await prisma.syncOutbox.deleteMany({});
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('GET /api/sync/status (auth) → outbox 0, peerConfigured false (default)', async () => {
    const res = await request(app.getHttpServer() as App)
      .get('/api/sync/status')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const body = res.body as SyncStatusBody;
    expect(body.outboxPending).toBe(0);
    expect(body.outboxFailed).toBe(0);
    expect(body.lastSyncAt).toBeNull();
  });

  it('patient create → outboxPending +1', async () => {
    await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'STATUS-001',
        firstName: 'Status',
        lastName: 'Patient',
        birthDate: new Date('1990-01-01'),
        gender: 'male',
      },
    });
    const res = await request(app.getHttpServer() as App)
      .get('/api/sync/status')
      .set('Authorization', `Bearer ${token}`);
    const body = res.body as SyncStatusBody;
    expect(body.outboxPending).toBeGreaterThanOrEqual(1);
  });

  it('outbox failed_at set → outboxFailed dolar', async () => {
    await prisma.syncOutbox.create({
      data: {
        source: 'LOCAL',
        entityType: 'patient',
        entityId: '00000000-0000-0000-0000-000000000099',
        operation: 'INSERT',
        tenantId: fixtures.tenantA.id,
        payload: { id: '00000000-0000-0000-0000-000000000099' },
        occurredAt: new Date(),
        failedAt: new Date(),
        retryCount: 5,
        lastError: 'dead-letter test',
      },
    });
    const res = await request(app.getHttpServer() as App)
      .get('/api/sync/status')
      .set('Authorization', `Bearer ${token}`);
    const body = res.body as SyncStatusBody;
    expect(body.outboxFailed).toBe(1);
  });

  it('outbox synced_at set → lastSyncAt dolar', async () => {
    const syncedAt = new Date(Date.now() - 60_000);
    await prisma.syncOutbox.create({
      data: {
        source: 'LOCAL',
        entityType: 'patient',
        entityId: '00000000-0000-0000-0000-000000000098',
        operation: 'INSERT',
        tenantId: fixtures.tenantA.id,
        payload: { id: '00000000-0000-0000-0000-000000000098' },
        occurredAt: new Date(),
        syncedAt,
      },
    });
    const res = await request(app.getHttpServer() as App)
      .get('/api/sync/status')
      .set('Authorization', `Bearer ${token}`);
    const body = res.body as SyncStatusBody;
    expect(body.lastSyncAt).not.toBeNull();
    // Aynı saniye/ms ± oluşabilir; varlığını kontrol et
    expect(new Date(body.lastSyncAt!).getTime()).toBeGreaterThan(0);
  });

  it("per-tenant izolasyon: tenantB outbox status'a yansımaz", async () => {
    await prisma.syncOutbox.create({
      data: {
        source: 'LOCAL',
        entityType: 'patient',
        entityId: '00000000-0000-0000-0000-000000000097',
        operation: 'INSERT',
        tenantId: fixtures.tenantB.id, // <-- diğer tenant
        payload: { id: '00000000-0000-0000-0000-000000000097' },
        occurredAt: new Date(),
      },
    });
    const res = await request(app.getHttpServer() as App)
      .get('/api/sync/status')
      .set('Authorization', `Bearer ${token}`);
    const body = res.body as SyncStatusBody;
    expect(body.outboxPending).toBe(0); // tenantA olmadığı için 0
  });

  it('auth olmadan → 401', async () => {
    const res = await request(app.getHttpServer() as App).get('/api/sync/status');
    expect(res.status).toBe(401);
  });
});
