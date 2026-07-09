import type { AdminPrismaService } from '../../prisma/admin-prisma.service';
import { PlatformDbStatsService } from './platform-db-stats.service';

// #1087 — DB analiz servisi davranış kilidi (#938: yeni platform servisi
// testsiz merge edilmez).

function makeAdmin(queryImpl: (sql: string) => unknown) {
  return {
    $queryRawUnsafe: jest.fn((sql: string) => Promise.resolve(queryImpl(sql))),
  } as unknown as AdminPrismaService;
}

describe('PlatformDbStatsService (#1087)', () => {
  it('tables: ölü satır oranını hesaplar + BigInt→number', async () => {
    const admin = makeAdmin(() => [
      {
        name: 'patients',
        total_bytes: 1000n,
        table_bytes: 600n,
        index_bytes: 300n,
        toast_bytes: 100n,
        live_rows: 80n,
        dead_rows: 20n,
        seq_scan: 5n,
        idx_scan: 95n,
        last_autovacuum: new Date('2026-07-04T00:00:00Z'),
      },
    ]);
    const svc = new PlatformDbStatsService(admin);
    const rows = await svc.tables();
    expect(rows[0].totalBytes).toBe(1000);
    expect(rows[0].deadRatio).toBeCloseTo(0.2);
    expect(rows[0].lastAutovacuum).toBe('2026-07-04T00:00:00.000Z');
  });

  it('tables: sıfır satırda deadRatio 0 (bölme hatası yok)', async () => {
    const admin = makeAdmin(() => [
      {
        name: 'empty_t',
        total_bytes: 0n,
        table_bytes: 0n,
        index_bytes: 0n,
        toast_bytes: 0n,
        live_rows: 0n,
        dead_rows: 0n,
        seq_scan: 0n,
        idx_scan: 0n,
        last_autovacuum: null,
      },
    ]);
    const svc = new PlatformDbStatsService(admin);
    const rows = await svc.tables();
    expect(rows[0].deadRatio).toBe(0);
    expect(rows[0].lastAutovacuum).toBeNull();
  });

  it('slowQueries: pg_stat_statements yoksa null döner', async () => {
    const admin = {
      $queryRawUnsafe: jest.fn().mockRejectedValue(new Error('relation does not exist')),
    } as unknown as AdminPrismaService;
    const svc = new PlatformDbStatsService(admin);
    await expect(svc.slowQueries()).resolves.toBeNull();
  });

  it('slowQueries: sorgu metni 300 char ile kırpılır', async () => {
    const long = 'SELECT ' + 'x'.repeat(400);
    const admin = makeAdmin(() => [{ query: long, calls: 3n, mean_ms: 12.345, total_ms: 40 }]);
    const svc = new PlatformDbStatsService(admin);
    const rows = await svc.slowQueries();
    expect(rows).not.toBeNull();
    expect(rows![0].query.length).toBeLessThanOrEqual(300);
    expect(rows![0].meanMs).toBe(12.35);
  });

  it('unusedIndexes: idx_scan=0 index listesi', async () => {
    const admin = makeAdmin(() => [
      { table: 'orders', index: 'orders_unused_idx', size_bytes: 5000n, scans: 0n },
    ]);
    const svc = new PlatformDbStatsService(admin);
    const rows = await svc.unusedIndexes();
    expect(rows[0].index).toBe('orders_unused_idx');
    expect(rows[0].sizeBytes).toBe(5000);
  });
});
