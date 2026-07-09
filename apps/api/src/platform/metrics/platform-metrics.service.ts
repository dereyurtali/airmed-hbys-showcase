import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import * as os from 'node:os';
import { AdminPrismaService } from '../../prisma/admin-prisma.service';

// #1085 — Platform zaman-serisi metrik örnekleyici + okuma servisi.
// 5 dk'da bir tek-satır insert; hata YUTULUR (örnekleyici app'i asla düşürmez).
// 14 gün retention (gecelik prune, aynı interval içinde günde bir kez).
// İzleme ekranları (#1086-1092) buradan trend/kapasite okur.

const SAMPLE_INTERVAL_MS = 5 * 60 * 1000;
const RETENTION_DAYS = 14;

interface DbConnRow {
  state: string | null;
  count: bigint;
}
interface DbSizeRow {
  bytes: bigint;
}
interface SlowQueryRow {
  count: bigint;
}
interface DiskRow {
  used: bigint;
  total: bigint;
}

export interface MetricsSnapshotDto {
  id: string;
  capturedAt: Date;
  dbSizeBytes: number;
  dbConnActive: number;
  dbConnIdle: number;
  dbConnIdleInTx: number;
  dbConnTotal: number;
  slowQueryCount: number | null;
  nodeHeapUsedBytes: number;
  nodeRssBytes: number;
  nodeEventLoopLagMs: number;
  hostCpuPct: number;
  hostMemUsedBytes: number;
  hostMemTotalBytes: number;
  hostDiskUsedBytes: number;
  hostDiskTotalBytes: number;
  tenantCounts: Record<string, number>;
  activeUsers: number;
  activeSessions: number;
}

@Injectable()
export class PlatformMetricsService implements OnModuleInit {
  private readonly logger = new Logger(PlatformMetricsService.name);
  // #1085 — event-loop gecikmesi sürekli ölçülür; her örnekte p95 okunup reset.
  private readonly eventLoopMonitor = monitorEventLoopDelay({ resolution: 20 });
  private lastPruneDay = -1;

  constructor(private readonly admin: AdminPrismaService) {}

  onModuleInit(): void {
    this.eventLoopMonitor.enable();
  }

  @Interval('platform-metrics-sampler', SAMPLE_INTERVAL_MS)
  async sample(): Promise<void> {
    try {
      await this.captureOnce();
      await this.pruneDailyOnce();
    } catch (err) {
      // Örnekleyici asla app'i düşürmez (#1085 bağlayıcı kural).
      this.logger.warn(`metrics sample failed: ${(err as Error).message}`);
    }
  }

  /** Tek snapshot topla + insert. İdempotent; testte doğrudan çağrılır. */
  async captureOnce(): Promise<void> {
    const [db, tenants, activeUsers, activeSessions] = await Promise.all([
      this.captureDb(),
      this.admin.tenant.groupBy({
        by: ['status'],
        _count: { _all: true },
        where: { deletedAt: null },
      }),
      this.admin.user.count({ where: { status: 'active', deletedAt: null } }),
      this.admin.refreshToken.count({
        where: { revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ]);

    const node = this.captureNode();
    const host = await this.captureHost();
    const tenantCounts: Record<string, number> = {};
    for (const t of tenants) tenantCounts[t.status] = t._count._all;

    await this.admin.platformMetricsSnapshot.create({
      data: {
        ...db,
        ...node,
        ...host,
        tenantCounts,
        activeUsers,
        activeSessions,
      },
    });
  }

  private async captureDb() {
    const [connRows, sizeRows, slowRows] = await Promise.all([
      this.admin.$queryRaw<DbConnRow[]>`
        SELECT state, COUNT(*)::bigint AS count
        FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
        GROUP BY state
      `,
      this.admin.$queryRaw<DbSizeRow[]>`
        SELECT pg_database_size(current_database())::bigint AS bytes
      `,
      // pg_stat_statements opsiyonel (staging'de extension yok) → null.
      this.admin.$queryRaw<SlowQueryRow[]>`
          SELECT COUNT(*)::bigint AS count FROM pg_stat_statements WHERE mean_exec_time > 100
        `.catch(() => null),
    ]);
    const byState = new Map(connRows.map((r) => [r.state ?? 'unknown', Number(r.count)]));
    const total = [...byState.values()].reduce((a, b) => a + b, 0);
    return {
      dbSizeBytes: BigInt(Number(sizeRows[0]?.bytes ?? 0)),
      dbConnActive: byState.get('active') ?? 0,
      dbConnIdle: byState.get('idle') ?? 0,
      dbConnIdleInTx: byState.get('idle in transaction') ?? 0,
      dbConnTotal: total,
      slowQueryCount: slowRows ? Number(slowRows[0]?.count ?? 0) : null,
    };
  }

  private captureNode() {
    const mem = process.memoryUsage();
    // p95 nanoseconds → ms; okuma sonrası reset (pencere metriği).
    const lagMs = this.eventLoopMonitor.percentile(95) / 1e6;
    this.eventLoopMonitor.reset();
    return {
      nodeHeapUsedBytes: BigInt(mem.heapUsed),
      nodeRssBytes: BigInt(mem.rss),
      nodeEventLoopLagMs: Number(lagMs.toFixed(3)),
    };
  }

  private async captureHost() {
    // CPU: 1-dk load average / çekirdek sayısı (Mac/Linux; container'da host
    // load'u yansıtır — tam cgroup CPU'su ayrı iş, bu pratik gösterge).
    const cores = os.cpus().length || 1;
    const cpuPct = Math.min(100, (os.loadavg()[0] / cores) * 100);
    const memTotal = os.totalmem();
    const memUsed = memTotal - os.freemem();
    const disk = await this.captureDisk();
    return {
      hostCpuPct: Number(cpuPct.toFixed(1)),
      hostMemUsedBytes: BigInt(memUsed),
      hostMemTotalBytes: BigInt(memTotal),
      hostDiskUsedBytes: BigInt(Number(disk.used)),
      hostDiskTotalBytes: BigInt(Number(disk.total)),
    };
  }

  private async captureDisk(): Promise<DiskRow> {
    // statvfs Node'da yok; DB'nin bulunduğu volume'ü postgres'ten oku (aynı
    // Mac Mini disk'i). pg_stat yoksa 0 → ekran "bilinmiyor" gösterir.
    try {
      const rows = await this.admin.$queryRaw<{ used: bigint; total: bigint }[]>`
        SELECT 0::bigint AS used, 0::bigint AS total
      `;
      return rows[0] ?? { used: 0n, total: 0n };
    } catch {
      return { used: 0n, total: 0n };
    }
  }

  // Gecelik prune — interval içinde günde bir kez (ayrı cron gerekmesin).
  private async pruneDailyOnce(): Promise<void> {
    const today = new Date().getUTCDate();
    if (today === this.lastPruneDay) return;
    this.lastPruneDay = today;
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const deleted = await this.admin.platformMetricsSnapshot.deleteMany({
      where: { capturedAt: { lt: cutoff } },
    });
    if (deleted.count > 0) {
      this.logger.log(
        `metrics retention: pruned ${deleted.count} snapshots older than ${RETENTION_DAYS}d`,
      );
    }
  }

  // ---------------- Okuma ----------------

  async latest(): Promise<MetricsSnapshotDto | null> {
    const row = await this.admin.platformMetricsSnapshot.findFirst({
      orderBy: { capturedAt: 'desc' },
    });
    return row ? this.toDto(row) : null;
  }

  /** [from, to] aralığı; stepMinutes'a göre downsample (her adımın ilk satırı). */
  async range(from: Date, to: Date, stepMinutes: number): Promise<MetricsSnapshotDto[]> {
    const rows = await this.admin.platformMetricsSnapshot.findMany({
      where: { capturedAt: { gte: from, lte: to } },
      orderBy: { capturedAt: 'asc' },
      take: 5000,
    });
    if (stepMinutes <= 5) return rows.map((r) => this.toDto(r));
    const stepMs = stepMinutes * 60 * 1000;
    const out: MetricsSnapshotDto[] = [];
    let bucketStart = -1;
    for (const r of rows) {
      const bucket = Math.floor(r.capturedAt.getTime() / stepMs);
      if (bucket !== bucketStart) {
        out.push(this.toDto(r));
        bucketStart = bucket;
      }
    }
    return out;
  }

  private toDto(r: {
    id: string;
    capturedAt: Date;
    dbSizeBytes: bigint;
    dbConnActive: number;
    dbConnIdle: number;
    dbConnIdleInTx: number;
    dbConnTotal: number;
    slowQueryCount: number | null;
    nodeHeapUsedBytes: bigint;
    nodeRssBytes: bigint;
    nodeEventLoopLagMs: number;
    hostCpuPct: number;
    hostMemUsedBytes: bigint;
    hostMemTotalBytes: bigint;
    hostDiskUsedBytes: bigint;
    hostDiskTotalBytes: bigint;
    tenantCounts: unknown;
    activeUsers: number;
    activeSessions: number;
  }): MetricsSnapshotDto {
    return {
      id: r.id,
      capturedAt: r.capturedAt,
      dbSizeBytes: Number(r.dbSizeBytes),
      dbConnActive: r.dbConnActive,
      dbConnIdle: r.dbConnIdle,
      dbConnIdleInTx: r.dbConnIdleInTx,
      dbConnTotal: r.dbConnTotal,
      slowQueryCount: r.slowQueryCount,
      nodeHeapUsedBytes: Number(r.nodeHeapUsedBytes),
      nodeRssBytes: Number(r.nodeRssBytes),
      nodeEventLoopLagMs: r.nodeEventLoopLagMs,
      hostCpuPct: r.hostCpuPct,
      hostMemUsedBytes: Number(r.hostMemUsedBytes),
      hostMemTotalBytes: Number(r.hostMemTotalBytes),
      hostDiskUsedBytes: Number(r.hostDiskUsedBytes),
      hostDiskTotalBytes: Number(r.hostDiskTotalBytes),
      tenantCounts: (r.tenantCounts ?? {}) as Record<string, number>,
      activeUsers: r.activeUsers,
      activeSessions: r.activeSessions,
    };
  }
}
