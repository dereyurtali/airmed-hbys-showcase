import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import request from 'supertest';
import type { App } from 'supertest/types';
import { signSyncBody } from '../src/sync/sync-hmac';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

const SECRET = 'test-sync-secret-32-chars-long-hello!';
const PLATFORM_OWNER_EMAIL = 'ali@dnasoft.co';
const PLATFORM_OWNER_PASSWORD = 'platform-owner-dev';

async function loginPlatform(app: INestApplication, prisma: PrismaClient): Promise<string> {
  const hash = await bcrypt.hash(PLATFORM_OWNER_PASSWORD, 4);
  await prisma.platformAdmin.upsert({
    where: { email: PLATFORM_OWNER_EMAIL },
    update: { passwordHash: hash, totpSecret: null, totpVerifiedAt: null, isActive: true },
    create: {
      email: PLATFORM_OWNER_EMAIL,
      passwordHash: hash,
      name: 'Ali Owner',
      role: 'platform_owner',
      isActive: true,
    },
  });
  const s1 = await request(app.getHttpServer() as App)
    .post('/platform/auth/login')
    .send({ email: PLATFORM_OWNER_EMAIL, password: PLATFORM_OWNER_PASSWORD });
  const setup = await request(app.getHttpServer() as App)
    .post('/platform/auth/setup-totp')
    .set('Authorization', `Bearer ${(s1.body as { challengeToken: string }).challengeToken}`);
  const secret = (setup.body as { secret: string }).secret;
  const s2 = await request(app.getHttpServer() as App)
    .post('/platform/auth/login')
    .send({ email: PLATFORM_OWNER_EMAIL, password: PLATFORM_OWNER_PASSWORD });
  const verify = await request(app.getHttpServer() as App)
    .post('/platform/auth/verify-totp')
    .set('Authorization', `Bearer ${(s2.body as { challengeToken: string }).challengeToken}`)
    .send({ code: authenticator.generate(secret) });
  return (verify.body as { accessToken: string }).accessToken;
}

async function postSync(app: INestApplication, body: unknown) {
  const bodyStr = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signSyncBody(SECRET, bodyStr, timestamp);
  return request(app.getHttpServer() as App)
    .post('/api/internal/sync')
    .set('X-Sync-Signature', signature)
    .set('X-Sync-Timestamp', timestamp)
    .set('Content-Type', 'application/json')
    .send(bodyStr);
}

interface ConflictRow {
  id: string;
  conflictType: string;
  resolvedAt: string | null;
  resolution: string | null;
}

describe('A12 conflict resolution (LWW + unique_create + delete_update)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let platformToken: string;

  beforeAll(async () => {
    process.env.SYNC_HMAC_SECRET = SECRET;
    process.env.SYNC_NODE_SOURCE = 'LOCAL';
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
    platformToken = await loginPlatform(app, prisma);
  });

  beforeEach(async () => {
    await prisma.patient.deleteMany({
      where: { tenantId: fixtures.tenantA.id, id: { not: fixtures.tenantA.patientId } },
    });
    await prisma.syncOutbox.deleteMany({});
    await prisma.syncConflict.deleteMany({});
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('lww_stale: local UPDATE timestamp > remote occurredAt → skip + conflict', async () => {
    const p = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'LWW-001',
        firstName: 'Local',
        lastName: 'Newer',
        birthDate: new Date('1990-01-01'),
        gender: 'male',
      },
    });
    // Now > occurredAt'i geçmişe set ediyoruz
    const pastTs = new Date(p.updatedAt.getTime() - 60_000).toISOString();
    const batch = {
      events: [
        {
          id: '77777777-7777-7777-7777-777777777771',
          source: 'CLOUD',
          entityType: 'patient',
          entityId: p.id,
          operation: 'UPDATE',
          tenantId: fixtures.tenantA.id,
          payload: {
            id: p.id,
            tenant_id: fixtures.tenantA.id,
            mrn: 'LWW-001',
            first_name: 'Should-Be-Skipped',
            last_name: 'Older',
            birth_date: '1990-01-01',
            gender: 'male',
            created_at: p.createdAt.toISOString(),
            updated_at: pastTs,
          },
          occurredAt: pastTs,
        },
      ],
    };
    const res = await postSync(app, batch);
    expect(res.status).toBe(200);
    expect((res.body as { applied: number }).applied).toBe(1); // counted as applied (skip via conflict)

    const after = await prisma.patient.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.firstName).toBe('Local'); // local kazandı

    const conflicts = await prisma.syncConflict.findMany();
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].conflictType).toBe('lww_stale');
    expect(conflicts[0].resolvedAt).toBeNull();
  });

  it('#421 concurrent_update: local pending UPDATE varken remote UPDATE (newer) → conflict, LWW ezmez', async () => {
    const p = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'CONCURRENT-001',
        firstName: 'Local',
        lastName: 'Offline-Edit',
        birthDate: new Date('1990-01-01'),
        gender: 'male',
      },
    });
    // Local bu hastayı offline düzenledi → henüz push edilmemiş LOCAL UPDATE
    // outbox satırı (trigger'ın yazdığı INSERT'i temizleyip UPDATE ekliyoruz).
    await prisma.syncOutbox.deleteMany({ where: { entityId: p.id } });
    await prisma.syncOutbox.create({
      data: {
        source: 'LOCAL',
        entityType: 'patient',
        entityId: p.id,
        operation: 'UPDATE',
        tenantId: fixtures.tenantA.id,
        payload: { id: p.id, first_name: 'Local-Changed' },
        occurredAt: new Date(),
      },
    });

    // Remote CLOUD UPDATE — local'den DAHA YENİ timestamp. Saf LWW olsa remote
    // kazanır + local düzenleme sessizce kaybolurdu. Politika: çift-taraflı edit
    // → conflict, otomatik apply YOK.
    const futureTs = new Date(p.updatedAt.getTime() + 60_000).toISOString();
    const batch = {
      events: [
        {
          id: '77777777-7777-7777-7777-77777777777c',
          source: 'CLOUD',
          entityType: 'patient',
          entityId: p.id,
          operation: 'UPDATE',
          tenantId: fixtures.tenantA.id,
          payload: {
            id: p.id,
            tenant_id: fixtures.tenantA.id,
            mrn: 'CONCURRENT-001',
            first_name: 'Cloud-Should-Not-Win',
            last_name: 'Offline-Edit',
            birth_date: '1990-01-01',
            gender: 'male',
            created_at: p.createdAt.toISOString(),
            updated_at: futureTs,
          },
          occurredAt: futureTs,
        },
      ],
    };
    const res = await postSync(app, batch);
    expect(res.status).toBe(200);
    expect((res.body as { applied: number }).applied).toBe(1); // skip via conflict

    const after = await prisma.patient.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.firstName).toBe('Local'); // remote uygulanmadı, local korundu

    const conflicts = await prisma.syncConflict.findMany({
      where: { conflictType: 'concurrent_update' },
    });
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].resolvedAt).toBeNull(); // manuel resolution gerek
  });

  it("delete_update: gelen UPDATE local'de silinmiş row → auto_local resolved", async () => {
    const newId = '88888888-8888-8888-8888-888888888881';
    const batch = {
      events: [
        {
          id: '77777777-7777-7777-7777-777777777772',
          source: 'CLOUD',
          entityType: 'patient',
          entityId: newId,
          operation: 'UPDATE',
          tenantId: fixtures.tenantA.id,
          payload: { id: newId, mrn: 'DU-001', first_name: 'Dead', last_name: 'Update' },
          occurredAt: new Date().toISOString(),
        },
      ],
    };
    const res = await postSync(app, batch);
    expect(res.status).toBe(200);

    const conflicts = await prisma.syncConflict.findMany();
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].conflictType).toBe('delete_update');
    expect(conflicts[0].resolvedAt).not.toBeNull();
    expect(conflicts[0].resolution).toBe('auto_local');

    const patient = await prisma.patient.findUnique({ where: { id: newId } });
    expect(patient).toBeNull(); // local hala yok, plan: DELETE kazanır
  });

  it('unique_create: aynı mrn farklı id INSERT → conflict + skip', async () => {
    const localId = '88888888-8888-8888-8888-888888888882';
    await prisma.patient.create({
      data: {
        id: localId,
        tenantId: fixtures.tenantA.id,
        mrn: 'COLLIDE-001',
        firstName: 'Local',
        lastName: 'Owner',
        birthDate: new Date('1990-01-01'),
        gender: 'male',
      },
    });
    await prisma.syncConflict.deleteMany({});

    const remoteId = '88888888-8888-8888-8888-888888888883';
    const batch = {
      events: [
        {
          id: '77777777-7777-7777-7777-777777777773',
          source: 'CLOUD',
          entityType: 'patient',
          entityId: remoteId,
          operation: 'INSERT',
          tenantId: fixtures.tenantA.id,
          payload: {
            id: remoteId,
            tenant_id: fixtures.tenantA.id,
            mrn: 'COLLIDE-001', // aynı mrn
            first_name: 'Remote',
            last_name: 'Colliding',
            birth_date: '1990-01-01',
            gender: 'female',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          occurredAt: new Date().toISOString(),
        },
      ],
    };
    const res = await postSync(app, batch);
    expect(res.status).toBe(200);

    const conflicts = await prisma.syncConflict.findMany({
      where: { conflictType: 'unique_create' },
    });
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].resolvedAt).toBeNull();

    // Remote id ile patient yok (apply skip)
    expect(await prisma.patient.findUnique({ where: { id: remoteId } })).toBeNull();
    // Local id hala var
    expect(await prisma.patient.findUnique({ where: { id: localId } })).not.toBeNull();
  });

  it('GET /platform/sync/conflicts → unresolved listesi', async () => {
    // Seed bir conflict
    await prisma.syncConflict.create({
      data: {
        eventId: '00000000-0000-0000-0000-000000000001',
        entityType: 'patient',
        entityId: '00000000-0000-0000-0000-000000000002',
        tenantId: fixtures.tenantA.id,
        conflictType: 'lww_stale',
        remoteSource: 'CLOUD',
        remoteSnapshot: { id: '00000000-0000-0000-0000-000000000002' },
        occurredAt: new Date(),
      },
    });
    const res = await request(app.getHttpServer() as App)
      .get('/platform/sync/conflicts?resolved=false')
      .set('Authorization', `Bearer ${platformToken}`);
    expect(res.status).toBe(200);
    const rows = res.body as ConflictRow[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.resolvedAt === null)).toBe(true);
  });

  it('POST /platform/sync/conflicts/:id/resolve local_kept → resolved + DB değişmez', async () => {
    const p = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'RESOLVE-001',
        firstName: 'Local',
        lastName: 'Keep',
        birthDate: new Date('1990-01-01'),
        gender: 'male',
      },
    });
    const c = await prisma.syncConflict.create({
      data: {
        eventId: '00000000-0000-0000-0000-000000000003',
        entityType: 'patient',
        entityId: p.id,
        tenantId: fixtures.tenantA.id,
        conflictType: 'lww_stale',
        remoteSource: 'CLOUD',
        remoteSnapshot: { id: p.id, first_name: 'Remote-Would-Win' },
        occurredAt: new Date(),
      },
    });
    const res = await request(app.getHttpServer() as App)
      .post(`/platform/sync/conflicts/${c.id}/resolve`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ resolution: 'local_kept' });
    expect(res.status).toBe(200);

    const updated = await prisma.syncConflict.findUniqueOrThrow({ where: { id: c.id } });
    expect(updated.resolvedAt).not.toBeNull();
    expect(updated.resolution).toBe('local_kept');

    const patient = await prisma.patient.findUniqueOrThrow({ where: { id: p.id } });
    expect(patient.firstName).toBe('Local'); // remote uygulanmadı
  });
});
