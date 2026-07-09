import type { AdminPrismaService } from '../../prisma/admin-prisma.service';
import { PlatformMetricsService } from './platform-metrics.service';

// #1085 — örnekleyici + okuma davranış kilidi (#938 borcu: yeni platform
// servisi testsiz merge edilmez).

function makeAdmin(overrides?: Partial<Record<string, unknown>>) {
  const snap = {
    id: 's1',
    capturedAt: new Date('2026-07-04T10:00:00Z'),
    dbSizeBytes: 123n,
    dbConnActive: 2,
    dbConnIdle: 5,
    dbConnIdleInTx: 0,
    dbConnTotal: 7,
    slowQueryCount: null,
    nodeHeapUsedBytes: 1000n,
    nodeRssBytes: 2000n,
    nodeEventLoopLagMs: 1.5,
    hostCpuPct: 12.3,
    hostMemUsedBytes: 3000n,
    hostMemTotalBytes: 8000n,
    hostDiskUsedBytes: 0n,
    hostDiskTotalBytes: 0n,
    tenantCounts: { active: 3 },
    activeUsers: 10,
    activeSessions: 4,
  };
  const admin = {
    $queryRaw: jest.fn().mockResolvedValue([{ bytes: 123n, used: 0n, total: 0n, count: 0n }]),
    tenant: { groupBy: jest.fn().mockResolvedValue([{ status: 'active', _count: { _all: 3 } }]) },
    user: { count: jest.fn().mockResolvedValue(10) },
    refreshToken: { count: jest.fn().mockResolvedValue(4) },
    platformMetricsSnapshot: {
      create: jest.fn().mockResolvedValue(snap),
      findFirst: jest.fn().mockResolvedValue(snap),
      findMany: jest.fn().mockResolvedValue([snap]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ...overrides,
  } as unknown as AdminPrismaService;
  return { admin, snap };
}

describe('PlatformMetricsService (#1085)', () => {
  it('captureOnce: tek snapshot insert eder (db+node+host+kullanım)', async () => {
    const { admin } = makeAdmin();
    const svc = new PlatformMetricsService(admin);
    svc.onModuleInit();
    await svc.captureOnce();
    const create = (admin.platformMetricsSnapshot.create as jest.Mock).mock.calls[0][0];
    expect(create.data.activeUsers).toBe(10);
    expect(create.data.activeSessions).toBe(4);
    expect(create.data.tenantCounts).toEqual({ active: 3 });
    // Byte alanları BigInt olmalı (Prisma).
    expect(typeof create.data.dbSizeBytes).toBe('bigint');
    expect(typeof create.data.nodeHeapUsedBytes).toBe('bigint');
  });

  it('pg_stat_statements yoksa slowQueryCount null ile devam eder', async () => {
    const { admin } = makeAdmin();
    // slow query sorgusu reddedilsin (extension yok senaryosu).
    (admin.$queryRaw as jest.Mock).mockImplementation((strings: TemplateStringsArray) => {
      const sql = String(strings.join(''));
      if (sql.includes('pg_stat_statements')) return Promise.reject(new Error('no extension'));
      if (sql.includes('pg_stat_activity'))
        return Promise.resolve([{ state: 'active', count: 2n }]);
      return Promise.resolve([{ bytes: 123n, used: 0n, total: 0n }]);
    });
    const svc = new PlatformMetricsService(admin);
    svc.onModuleInit();
    await expect(svc.captureOnce()).resolves.toBeUndefined();
    const create = (admin.platformMetricsSnapshot.create as jest.Mock).mock.calls[0][0];
    expect(create.data.slowQueryCount).toBeNull();
  });

  it('sample: hata YUTULUR (örnekleyici app düşürmez)', async () => {
    const { admin } = makeAdmin();
    (admin.platformMetricsSnapshot.create as jest.Mock).mockRejectedValue(new Error('db down'));
    const svc = new PlatformMetricsService(admin);
    svc.onModuleInit();
    await expect(svc.sample()).resolves.toBeUndefined();
  });

  it('latest: en son snapshot DTO döner (BigInt → number)', async () => {
    const { admin } = makeAdmin();
    const svc = new PlatformMetricsService(admin);
    const dto = await svc.latest();
    expect(dto?.dbSizeBytes).toBe(123);
    expect(dto?.nodeHeapUsedBytes).toBe(1000);
    expect(dto?.tenantCounts).toEqual({ active: 3 });
  });

  it('range: stepMinutes<=5 tüm satırları döndürür', async () => {
    const { admin } = makeAdmin();
    const svc = new PlatformMetricsService(admin);
    const rows = await svc.range(
      new Date('2026-07-04T00:00:00Z'),
      new Date('2026-07-05T00:00:00Z'),
      5,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('s1');
  });
});
