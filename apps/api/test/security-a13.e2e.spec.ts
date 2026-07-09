import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuditCleanupService } from '../src/audit/audit-cleanup.service';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// A13 — güvenlik smoke: Helmet header'ları, CORS, audit retention cleanup.
//
// Login throttle test'i için tightLimit() NODE_ENV='test' iken 10_000'e geçer
// (auth.controller.ts), bu yüzden 429 doğrulamasını test ortamında yapamıyoruz.
// Bunun yerine throttle decorator'ın 5'i bekleyip beklemediğini kod-seviyesinde
// inspect ediyoruz: rate-limit-config.test.ts (unit).

describe('A13 — security hardening (Helmet + CORS + audit retention)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('Helmet: CSP + frame-options + referrer-policy header set', async () => {
    const res = await request(app.getHttpServer() as App).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    // HSTS prod-only — test'te kapalı olmalı
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('Helmet: x-powered-by header gizli', async () => {
    const res = await request(app.getHttpServer() as App).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('CORS: izinli origin için ACAO header döner', async () => {
    const res = await request(app.getHttpServer() as App)
      .options('/api/health')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.status).toBeLessThan(400);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('CORS: izinsiz origin için ACAO yok', async () => {
    const res = await request(app.getHttpServer() as App)
      .options('/api/health')
      .set('Origin', 'http://evil.example.com')
      .set('Access-Control-Request-Method', 'GET');
    // Express CORS evil origin için header'ı set etmez; istek 204 dönse de
    // ACAO yokluğu browser-side bloklar.
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('AuditCleanupService: cutoff öncesi satırları siler, sonrasını korur', async () => {
    const cleanup = app.get(AuditCleanupService);

    // 200 gün önce + bugünün audit'ini yarat. AuditLog RLS'li, ama postgres
    // superuser ile direct insert (FORCE RLS rolünü atlar; testte allowed).
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

    // #957 — eski ay partition'ını yarat ki 200-günlük satır DEFAULT yerine
    // gerçek bir partition'a düşsün → purgeOnce onu DROP etsin (primary path).
    await prisma.$executeRawUnsafe(
      `SELECT ensure_audit_log_partition('${oldDate.toISOString().slice(0, 10)}'::date)`,
    );

    await prisma.auditLog.createMany({
      data: [
        {
          tenantId: fixtures.tenantA.id,
          action: 'a13.test.old',
          payload: {},
          createdAt: oldDate,
        },
        {
          tenantId: fixtures.tenantA.id,
          action: 'a13.test.recent',
          payload: {},
          createdAt: recentDate,
        },
      ],
    });

    const beforeOld = await prisma.auditLog.count({ where: { action: 'a13.test.old' } });
    const beforeRecent = await prisma.auditLog.count({ where: { action: 'a13.test.recent' } });
    expect(beforeOld).toBe(1);
    expect(beforeRecent).toBe(1);

    // #957 — retention artık partition-drop (+ DEFAULT bounded delete).
    const result = await cleanup.purgeOnce();
    expect(result.droppedPartitions + result.deletedDefaultRows).toBeGreaterThanOrEqual(1);

    const afterOld = await prisma.auditLog.count({ where: { action: 'a13.test.old' } });
    const afterRecent = await prisma.auditLog.count({ where: { action: 'a13.test.recent' } });
    expect(afterOld).toBe(0);
    expect(afterRecent).toBe(1);

    // Cleanup
    await prisma.auditLog.deleteMany({ where: { action: 'a13.test.recent' } });
  });

  it('AuditCleanupService: retention env override (>=30 ve <=3650 gün)', async () => {
    const cleanup = app.get(AuditCleanupService);
    // private retentionDays() doğrulaması — env'i değiştirip purgeOnce çağırarak
    // dolaylı test ediyoruz. Default 180, override 30 set.
    const original = process.env.AUDIT_LOG_RETENTION_DAYS;
    try {
      process.env.AUDIT_LOG_RETENTION_DAYS = '30';
      await prisma.$executeRawUnsafe(
        `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
      );
      const middleDate = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000);
      await prisma.auditLog.create({
        data: {
          tenantId: fixtures.tenantA.id,
          action: 'a13.test.middle',
          payload: {},
          createdAt: middleDate,
        },
      });
      // #957 — 50-günlük satır (partition yok) DEFAULT'a düşer; 30-gün retention
      // ile DEFAULT bounded delete siler.
      const result = await cleanup.purgeOnce();
      expect(result.droppedPartitions + result.deletedDefaultRows).toBeGreaterThanOrEqual(1);
      const after = await prisma.auditLog.count({ where: { action: 'a13.test.middle' } });
      expect(after).toBe(0);
    } finally {
      if (original === undefined) delete process.env.AUDIT_LOG_RETENTION_DAYS;
      else process.env.AUDIT_LOG_RETENTION_DAYS = original;
    }
  });

  it('AuditCleanupService: geçersiz retention env değeri default 180e düşer', async () => {
    const cleanup = app.get(AuditCleanupService);
    const original = process.env.AUDIT_LOG_RETENTION_DAYS;
    try {
      process.env.AUDIT_LOG_RETENTION_DAYS = 'not-a-number';
      // 100 gün önceki satır default 180 ile silinmemeli
      await prisma.$executeRawUnsafe(
        `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
      );
      const date = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      await prisma.auditLog.create({
        data: {
          tenantId: fixtures.tenantA.id,
          action: 'a13.test.invalid-env',
          payload: {},
          createdAt: date,
        },
      });
      await cleanup.purgeOnce();
      const after = await prisma.auditLog.count({ where: { action: 'a13.test.invalid-env' } });
      expect(after).toBe(1);
      // cleanup
      await prisma.auditLog.deleteMany({ where: { action: 'a13.test.invalid-env' } });
    } finally {
      if (original === undefined) delete process.env.AUDIT_LOG_RETENTION_DAYS;
      else process.env.AUDIT_LOG_RETENTION_DAYS = original;
    }
  });
});
