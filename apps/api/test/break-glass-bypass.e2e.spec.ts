import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// S15-PR5 — Break Glass acil bypass: activate, assertPaidSession bypass,
// close, izin gate'leri.

interface LoginBody {
  accessToken: string;
}

interface TrpcSuccess<T> {
  result: { data: T };
}

interface EncounterRow {
  id: string;
  stage: string;
  emergencyBypassActivatedAt: string | null;
  emergencyBypassClosedAt: string | null;
}

async function login(app: INestApplication, slug: string, email: string, password: string) {
  const res = await request(app.getHttpServer() as App)
    .post('/api/auth/login')
    .send({ tenantSlug: slug, email, password });
  return (res.body as LoginBody).accessToken;
}

async function trpcMutation<T>(app: INestApplication, token: string, route: string, body: unknown) {
  const res = await request(app.getHttpServer() as App)
    .post(`/api/trpc/${route}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  return { status: res.status, body: res.body as TrpcSuccess<T> };
}

describe('S15-PR5 Break Glass emergency bypass', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let recepToken: string;

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
    recepToken = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.receptionistEmail,
      fixtures.tenantA.receptionistPassword,
    );
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function openEncounter(): Promise<string> {
    const res = await trpcMutation<{ id: string }>(app, adminToken, 'encounter.open', {
      patientId: fixtures.tenantA.patientId,
    });
    expect(res.status).toBe(200);
    return res.body.result.data.id;
  }

  it('admin activates bypass with reason and encounter stage flips to emergency_bypass', async () => {
    const encounterId = await openEncounter();
    const res = await trpcMutation<EncounterRow>(
      app,
      adminToken,
      'encounter.activateEmergencyBypass',
      {
        id: encounterId,
        reason: 'Kimyasal yanık, acil müdahale gerekli, ödeme süresinde alınamaz.',
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.result.data.stage).toBe('emergency_bypass');
    expect(res.body.result.data.emergencyBypassActivatedAt).toBeTruthy();
    expect(res.body.result.data.emergencyBypassClosedAt).toBeNull();
  });

  it('reason <10 chars is rejected with 400', async () => {
    const encounterId = await openEncounter();
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/encounter.activateEmergencyBypass')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ id: encounterId, reason: 'kısa' });
    expect(res.status).toBe(400);
  });

  it('receptionist is rejected from emergencyBypass (yonetici-only)', async () => {
    const encounterId = await openEncounter();
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/encounter.activateEmergencyBypass')
      .set('Authorization', `Bearer ${recepToken}`)
      .send({ id: encounterId, reason: 'Yetki testi için yeterli uzunlukta sebep.' });
    expect(res.status).toBe(403);
  });

  it('double-activate same encounter fails with 400', async () => {
    const encounterId = await openEncounter();
    await trpcMutation(app, adminToken, 'encounter.activateEmergencyBypass', {
      id: encounterId,
      reason: 'Acil durum, ilk aktivasyon.',
    });
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/encounter.activateEmergencyBypass')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ id: encounterId, reason: 'Tekrar aktivasyon denemesi.' });
    expect(res.status).toBe(400);
  });

  it('close emergency bypass stamps closedAt and resets stage to done', async () => {
    const encounterId = await openEncounter();
    await trpcMutation(app, adminToken, 'encounter.activateEmergencyBypass', {
      id: encounterId,
      reason: 'Travma sonrası akut müdahale gerekli.',
    });
    const closed = await trpcMutation<EncounterRow>(
      app,
      adminToken,
      'encounter.closeEmergencyBypass',
      { id: encounterId },
    );
    expect(closed.status).toBe(200);
    expect(closed.body.result.data.emergencyBypassClosedAt).toBeTruthy();
    expect(closed.body.result.data.stage).toBe('done');
  });

  it('close without active bypass fails 400', async () => {
    const encounterId = await openEncounter();
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/encounter.closeEmergencyBypass')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ id: encounterId });
    expect(res.status).toBe(400);
  });
});
