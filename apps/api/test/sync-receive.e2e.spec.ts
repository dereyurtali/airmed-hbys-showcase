import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import request from 'supertest';
import type { App } from 'supertest/types';
import { signSyncBody } from '../src/sync/sync-hmac';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// A12 PR 2 — Receive endpoint + HMAC auth + apply.
// Worker tarafı için ayrı integration testi (sync-worker.e2e.spec.ts) yok;
// runOutboundSync() Service'in public API'sı, unit testte de doğrulanabilir.
// Bu suite end-to-end: gerçek POST → controller → service → DB upsert.

const SECRET = 'test-sync-secret-32-chars-long-hello!';

async function postSync(
  app: INestApplication,
  body: unknown,
  opts: { signature?: string; timestamp?: string } = {},
) {
  const bodyStr = JSON.stringify(body);
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000).toString();
  const signature = opts.signature ?? signSyncBody(SECRET, bodyStr, timestamp);
  return request(app.getHttpServer() as App)
    .post('/api/internal/sync')
    .set('X-Sync-Signature', signature)
    .set('X-Sync-Timestamp', timestamp)
    .set('Content-Type', 'application/json')
    .send(bodyStr);
}

describe('A12 sync receive endpoint (HMAC + apply + no-loop)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;

  beforeAll(async () => {
    process.env.SYNC_HMAC_SECRET = SECRET;
    process.env.SYNC_NODE_SOURCE = 'LOCAL';
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
  });

  beforeEach(async () => {
    await prisma.syncOutbox.deleteMany({});
    await prisma.patient.deleteMany({
      where: { tenantId: fixtures.tenantA.id, id: { not: fixtures.tenantA.patientId } },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("valid HMAC + valid payload → 200, applied=1, DB'de patient oluşur", async () => {
    const newId = '99999999-9999-9999-9999-999999999991';
    const batch = {
      events: [
        {
          id: 'evt-1',
          source: 'CLOUD',
          entityType: 'patient',
          entityId: newId,
          operation: 'INSERT' as const,
          tenantId: fixtures.tenantA.id,
          payload: {
            id: newId,
            tenant_id: fixtures.tenantA.id,
            mrn: 'SYNC-IN-001',
            first_name: 'Remote',
            last_name: 'Patient',
            birth_date: '1990-01-01',
            gender: 'male',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          occurredAt: new Date().toISOString(),
        },
      ],
    };
    const res = await postSync(app, batch);
    expect(res.status).toBe(200);
    expect((res.body as { applied: number }).applied).toBe(1);

    const patient = await prisma.patient.findUnique({ where: { id: newId } });
    expect(patient).not.toBeNull();
    expect(patient!.mrn).toBe('SYNC-IN-001');
  });

  it("apply UPDATE → mevcut row'u günceller (upsert)", async () => {
    const existing = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'SYNC-UPDATE-001',
        firstName: 'Old',
        lastName: 'Name',
        birthDate: new Date('1990-01-01'),
        gender: 'male',
      },
    });
    await prisma.syncOutbox.deleteMany({});

    const batch = {
      events: [
        {
          id: 'evt-2',
          source: 'CLOUD',
          entityType: 'patient',
          entityId: existing.id,
          operation: 'UPDATE' as const,
          tenantId: fixtures.tenantA.id,
          payload: {
            id: existing.id,
            tenant_id: fixtures.tenantA.id,
            mrn: existing.mrn,
            first_name: 'New',
            last_name: 'Name',
            birth_date: '1990-01-01',
            gender: 'male',
            created_at: existing.createdAt.toISOString(),
            updated_at: new Date().toISOString(),
          },
          occurredAt: new Date().toISOString(),
        },
      ],
    };
    const res = await postSync(app, batch);
    expect(res.status).toBe(200);

    const updated = await prisma.patient.findUniqueOrThrow({ where: { id: existing.id } });
    expect(updated.firstName).toBe('New');
  });

  it('apply DELETE → row silinir, olmayan id idempotent (hata yok)', async () => {
    const p = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'SYNC-DEL-001',
        firstName: 'To',
        lastName: 'Delete',
        birthDate: new Date('1990-01-01'),
        gender: 'male',
      },
    });
    await prisma.syncOutbox.deleteMany({});

    const batch = {
      events: [
        {
          id: 'evt-3',
          source: 'CLOUD',
          entityType: 'patient',
          entityId: p.id,
          operation: 'DELETE' as const,
          tenantId: fixtures.tenantA.id,
          payload: { id: p.id },
          occurredAt: new Date().toISOString(),
        },
      ],
    };
    const res = await postSync(app, batch);
    expect(res.status).toBe(200);
    expect((res.body as { applied: number }).applied).toBe(1);

    const deleted = await prisma.patient.findUnique({ where: { id: p.id } });
    expect(deleted).toBeNull();

    // İkinci DELETE batch (idempotent) — applied still 1, failed boş
    const res2 = await postSync(app, batch);
    expect(res2.status).toBe(200);
    expect((res2.body as { failed: unknown[] }).failed).toEqual([]);
  });

  it("uygulanan event sync_outbox'a tekrar yazılmaz (session_replication_role)", async () => {
    const newId = '99999999-9999-9999-9999-999999999992';
    const batch = {
      events: [
        {
          id: 'evt-4',
          source: 'CLOUD',
          entityType: 'patient',
          entityId: newId,
          operation: 'INSERT' as const,
          tenantId: fixtures.tenantA.id,
          payload: {
            id: newId,
            tenant_id: fixtures.tenantA.id,
            mrn: 'SYNC-NOLOOP-001',
            first_name: 'No',
            last_name: 'Loop',
            birth_date: '1990-01-01',
            gender: 'male',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          occurredAt: new Date().toISOString(),
        },
      ],
    };
    await postSync(app, batch);
    const outboxRows = await prisma.syncOutbox.count();
    expect(outboxRows).toBe(0); // trigger replication-mode'da fire etmedi
  });

  it('invalid HMAC → 403', async () => {
    const batch = { events: [] };
    const res = await postSync(app, batch, { signature: 'wrong-signature' });
    expect(res.status).toBe(403);
  });

  it('eski timestamp (>5dk drift) → 403', async () => {
    const batch = { events: [] };
    const oldTs = (Math.floor(Date.now() / 1000) - 600).toString(); // 10 dk önce
    const sig = signSyncBody(SECRET, JSON.stringify(batch), oldTs);
    const res = await postSync(app, batch, { signature: sig, timestamp: oldTs });
    expect(res.status).toBe(403);
  });

  it('missing signature → 403', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/internal/sync')
      .set('Content-Type', 'application/json')
      .send({ events: [] });
    expect(res.status).toBe(403);
  });

  it("unknown entityType → failed list'inde error mesajı", async () => {
    const batch = {
      events: [
        {
          id: 'evt-bad',
          source: 'CLOUD',
          entityType: 'unknownEntity',
          entityId: '00000000-0000-0000-0000-000000000099',
          operation: 'INSERT' as const,
          tenantId: fixtures.tenantA.id,
          payload: { id: '00000000-0000-0000-0000-000000000099' },
          occurredAt: new Date().toISOString(),
        },
      ],
    };
    const res = await postSync(app, batch);
    expect(res.status).toBe(200);
    const body = res.body as { applied: number; failed: Array<{ eventId: string; error: string }> };
    expect(body.applied).toBe(0);
    expect(body.failed.length).toBe(1);
    expect(body.failed[0].error).toMatch(/Unknown entityType/);
  });

  // P0 2.10 — HMAC raw body: parsed-and-restringified body kullanan eski
  // pattern saldırgana whitespace/key-ordering ile aynı imzayı oluşturma
  // fırsatı veriyordu. Şimdi imza raw buffer üzerinde, body'nin tek byte'ı
  // bile değişirse signature mismatch → 403.
  it('P0 2.10 — body byte tamper (whitespace değişimi) → 403', async () => {
    const newId = '99999999-9999-9999-9999-99999999aaaa';
    const batch = {
      events: [
        {
          id: 'evt-tamper',
          source: 'CLOUD',
          entityType: 'patient',
          entityId: newId,
          operation: 'INSERT' as const,
          tenantId: fixtures.tenantA.id,
          payload: { id: newId, tenant_id: fixtures.tenantA.id, mrn: 'TAMPER-001' },
          occurredAt: new Date().toISOString(),
        },
      ],
    };
    // Tek byte değişim: array sonu yerine boşluk eklenmiş varyant; sender imzası
    // orijinal stringify üzerinden hesaplandı, gönderilen body ise farklı bytes.
    const original = JSON.stringify(batch);
    const tampered = original.replace('}]}', '} ]}'); // ekstra boşluk
    expect(tampered.length).not.toBe(original.length);

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sig = signSyncBody(SECRET, original, timestamp); // orijinal üzerinden imza
    const res = await request(app.getHttpServer() as App)
      .post('/api/internal/sync')
      .set('X-Sync-Signature', sig)
      .set('X-Sync-Timestamp', timestamp)
      .set('Content-Type', 'application/json')
      .send(tampered); // farklı bytes gönder
    expect(res.status).toBe(403);
  });

  // P0 2.9 — Per-event SAVEPOINT: bir event fail olursa kalan event'ler
  // uygulanabilir kalmalı. Eskiden ilk event PG tx state'ini abort ediyordu
  // → kalan event'ler de fail olarak işaretleniyordu (zombie batch).
  it('P0 2.9 — batch içinde bir event fail olursa kalanlar applied (savepoint izolasyonu)', async () => {
    const goodId1 = '99999999-9999-9999-9999-99999999bbb1';
    const goodId2 = '99999999-9999-9999-9999-99999999bbb2';
    const batch = {
      events: [
        // Event 0: PG-level fail (invalid uuid cast → applyEvent throw)
        {
          id: 'evt-bad-pg',
          source: 'CLOUD',
          entityType: 'patient',
          entityId: 'not-a-uuid', // PG cast hatası
          operation: 'DELETE' as const,
          tenantId: fixtures.tenantA.id,
          payload: {},
          occurredAt: new Date().toISOString(),
        },
        // Event 1: geçerli, eskiden "current transaction aborted" ile fail olurdu
        {
          id: 'evt-good-1',
          source: 'CLOUD',
          entityType: 'patient',
          entityId: goodId1,
          operation: 'INSERT' as const,
          tenantId: fixtures.tenantA.id,
          payload: {
            id: goodId1,
            tenant_id: fixtures.tenantA.id,
            mrn: 'SAVEPOINT-001',
            first_name: 'After',
            last_name: 'Bad',
            birth_date: '1990-01-01',
            gender: 'male',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          occurredAt: new Date().toISOString(),
        },
        // Event 2: ikinci geçerli event
        {
          id: 'evt-good-2',
          source: 'CLOUD',
          entityType: 'patient',
          entityId: goodId2,
          operation: 'INSERT' as const,
          tenantId: fixtures.tenantA.id,
          payload: {
            id: goodId2,
            tenant_id: fixtures.tenantA.id,
            mrn: 'SAVEPOINT-002',
            first_name: 'Another',
            last_name: 'Good',
            birth_date: '1991-01-01',
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
    const body = res.body as { applied: number; failed: Array<{ eventId: string }> };
    expect(body.applied).toBe(2); // event 1 ve 2 başarılı
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].eventId).toBe('evt-bad-pg');

    // DB doğrulaması: iki geçerli patient yazıldı
    const written = await prisma.patient.findMany({
      where: { id: { in: [goodId1, goodId2] } },
    });
    expect(written).toHaveLength(2);
  });
});
