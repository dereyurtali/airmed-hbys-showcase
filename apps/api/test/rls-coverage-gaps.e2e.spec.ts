import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// #423 — RLS izolasyon kapsama tamamlama: cron job tenant-boundary, sync
// multi-tenant batch izolasyonu, API-key tenant-scope. RLS'in kendisi zaten
// testli (rls-smoke/sql-exploit/http-cross-tenant); bu dosya cron+sync+apikey'in
// dayandığı ortak primitif `runWithTenant`'ın tenant sınırını explicit doğrular.

describe('#423 RLS coverage: runWithTenant (cron/sync) + api-key tenant scope', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtures: IsolationFixtures;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  // Cron job'lar (no-show, webhook-retry, exchange-rate) ve sync worker her tenant
  // için runWithTenant(tenantId) içinde çalışır. Bu primitif sızdırırsa tüm
  // batch işler cross-tenant olur.
  it('runWithTenant(A) yalnız A tenant satırlarını görür (cron/sync batch boundary)', async () => {
    const patients = await prisma.runWithTenant(fixtures.tenantA.id, (tx) =>
      tx.patient.findMany({ select: { id: true, tenantId: true } }),
    );
    expect(patients.length).toBeGreaterThan(0);
    expect(patients.every((p) => p.tenantId === fixtures.tenantA.id)).toBe(true);
    // tenantB hastası A scope'unda görünmemeli.
    expect(patients.some((p) => p.id === fixtures.tenantB.patientId)).toBe(false);
  });

  it('runWithTenant(A) cross-tenant yazma yapamaz (RLS WITH CHECK / USING)', async () => {
    // A scope'unda B'nin hastasını güncellemeye çalış → RLS 0 satır etkiler.
    const res = await prisma.runWithTenant(fixtures.tenantA.id, (tx) =>
      tx.patient.updateMany({
        where: { id: fixtures.tenantB.patientId },
        data: { lastName: 'RLS_BREACH_ATTEMPT' },
      }),
    );
    expect(res.count).toBe(0);

    // B scope'unda hâlâ orijinal (sızıntı yok).
    const b = await prisma.runWithTenant(fixtures.tenantB.id, (tx) =>
      tx.patient.findFirst({
        where: { id: fixtures.tenantB.patientId },
        select: { lastName: true },
      }),
    );
    expect(b?.lastName).not.toBe('RLS_BREACH_ATTEMPT');
  });

  it('runWithTenant(B) yalnız B tenant satırlarını görür (ters yön)', async () => {
    const patients = await prisma.runWithTenant(fixtures.tenantB.id, (tx) =>
      tx.patient.findMany({ select: { id: true, tenantId: true } }),
    );
    expect(patients.every((p) => p.tenantId === fixtures.tenantB.id)).toBe(true);
    expect(patients.some((p) => p.id === fixtures.tenantA.patientId)).toBe(false);
  });

  it('API-key satırları tenant-scope: A scope B api-key satırını görmez', async () => {
    // İki tenant için birer api_keys satırı (hash alanları test için placeholder).
    const keyA = await prisma.runWithTenant(fixtures.tenantA.id, (tx) =>
      tx.apiKey.create({
        data: {
          tenantId: fixtures.tenantA.id,
          name: 'A-key',
          keyHash: 'hashA',
          prefix: 'ak_A',
          scopes: [],
        },
        select: { id: true },
      }),
    );
    const keyB = await prisma.runWithTenant(fixtures.tenantB.id, (tx) =>
      tx.apiKey.create({
        data: {
          tenantId: fixtures.tenantB.id,
          name: 'B-key',
          keyHash: 'hashB',
          prefix: 'ak_B',
          scopes: [],
        },
        select: { id: true },
      }),
    );

    // A scope yalnız A'nın anahtarını görür.
    const visibleInA = await prisma.runWithTenant(fixtures.tenantA.id, (tx) =>
      tx.apiKey.findMany({ select: { id: true } }),
    );
    const idsInA = visibleInA.map((k) => k.id);
    expect(idsInA).toContain(keyA.id);
    expect(idsInA).not.toContain(keyB.id);
  });
});
