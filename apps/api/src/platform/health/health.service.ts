import { ForbiddenException, Injectable } from '@nestjs/common';
import { AdminPrismaService } from '../../prisma/admin-prisma.service';

// F5-pilot Sistem Sağlığı (v0.2 dilimi).
//
// Tek bir endpoint: GET /platform/health/snapshot — anlık durum kartı.
// Time-series, alerts, telegram push, Redis metrics v0.3'e ertelendi.
//
// Yetki: tüm platform admin (read-only).

interface PlatformActor {
  id: string;
  role: 'platform_owner' | 'platform_engineer' | 'platform_support';
}

interface DbConnRow {
  state: string;
  count: bigint;
}

interface DbSizeRow {
  bytes: bigint;
}

interface SlowQueryRow {
  count: bigint;
}

export interface HealthSnapshot {
  collectedAt: string;
  deployment: {
    gitSha: string | null;
    imageTag: string | null;
    buildTime: string | null;
    deployedAt: string;
    nodeEnv: string;
  };
  database: {
    connections: { active: number; idle: number; idleInTransaction: number; total: number };
    sizeBytes: number;
    sizePretty: string;
    slowQueryCountLast5m: number | null;
  };
  tenants: {
    active: number;
    trial: number;
    suspended: number;
    churned: number;
    total: number;
  };
  users: {
    totalActive: number;
    lockedUsers: number;
  };
  sessions: {
    activeRefreshTokens: number;
  };
  activity: {
    auditLogsLast24h: number;
    activeFraudAlerts: number;
    commissionsPendingReview: number;
  };
  storage: {
    iolLotsCount: number;
    patientPhotosCount: number;
  };
}

@Injectable()
export class PlatformHealthService {
  // #1065 — paylaşımlı AdminPrismaService (tek havuz).
  constructor(private readonly admin: AdminPrismaService) {}

  async snapshot(actor: PlatformActor): Promise<HealthSnapshot> {
    this.assertReader(actor);
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // DB metrics via raw query — pg_stat_activity + pg_database_size.
    const [connRows, sizeRows, slowQueryRows] = await Promise.all([
      this.admin.$queryRaw<DbConnRow[]>`
        SELECT state, COUNT(*)::bigint AS count
        FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
        GROUP BY state
      `,
      this.admin.$queryRaw<DbSizeRow[]>`
        SELECT pg_database_size(current_database())::bigint AS bytes
      `,
      // pg_stat_statements opsiyonel; yüklü değilse null döner.
      this.admin.$queryRaw<SlowQueryRow[]>`
          SELECT COUNT(*)::bigint AS count
          FROM pg_stat_statements
          WHERE mean_exec_time > 100
        `.catch(() => null as SlowQueryRow[] | null),
    ]);

    const connByState = new Map(connRows.map((r) => [r.state ?? 'unknown', Number(r.count)]));
    const dbBytes = Number(sizeRows[0]?.bytes ?? 0);

    const [
      tenantCounts,
      userActive,
      userLocked,
      activeTokens,
      auditLast24h,
      activeFraud,
      pendingCommission,
      iolLots,
      photos,
    ] = await Promise.all([
      this.admin.tenant.groupBy({
        by: ['status'],
        _count: { _all: true },
        where: { deletedAt: null },
      }),
      this.admin.user.count({ where: { status: 'active', deletedAt: null } }),
      this.admin.user.count({ where: { lockedUntil: { gt: new Date() } } }),
      this.admin.refreshToken.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
      this.admin.auditLog.count({ where: { createdAt: { gte: since24h } } }),
      this.admin.fraudAlert.count({ where: { status: 'new' } }),
      this.admin.commissionEntry.count({ where: { status: 'pending', deletedAt: null } }),
      this.admin.iolLot.count({ where: { deletedAt: null } }),
      this.admin.patientPhoto.count({ where: { deletedAt: null } }),
    ]);

    const tenantMap = new Map(tenantCounts.map((t) => [t.status, t._count._all]));
    const tenantsActive = tenantMap.get('active') ?? 0;
    const tenantsTrial = tenantMap.get('trial') ?? 0;
    const tenantsSuspended = tenantMap.get('suspended') ?? 0;
    const tenantsChurned = tenantMap.get('churned') ?? 0;

    return {
      collectedAt: new Date().toISOString(),
      deployment: this.deployment(),
      database: {
        connections: {
          active: connByState.get('active') ?? 0,
          idle: connByState.get('idle') ?? 0,
          idleInTransaction: connByState.get('idle in transaction') ?? 0,
          total: Array.from(connByState.values()).reduce((a, b) => a + b, 0),
        },
        sizeBytes: dbBytes,
        sizePretty: prettyBytes(dbBytes),
        slowQueryCountLast5m:
          slowQueryRows && slowQueryRows.length > 0 ? Number(slowQueryRows[0]!.count) : null,
      },
      tenants: {
        active: tenantsActive,
        trial: tenantsTrial,
        suspended: tenantsSuspended,
        churned: tenantsChurned,
        total: tenantsActive + tenantsTrial + tenantsSuspended + tenantsChurned,
      },
      users: { totalActive: userActive, lockedUsers: userLocked },
      sessions: { activeRefreshTokens: activeTokens },
      activity: {
        auditLogsLast24h: auditLast24h,
        activeFraudAlerts: activeFraud,
        commissionsPendingReview: pendingCommission,
      },
      storage: { iolLotsCount: iolLots, patientPhotosCount: photos },
    };
  }

  // #955 — Çalışan sürüm + deploy görünürlüğü. gitSha/imageTag/buildTime image'a
  // build-time gömülür (Dockerfile ARG → ENV); deployedAt bu container process'inin
  // başlangıcından türetilir (= son deploy/restart anı, her zaman doğru). nodeEnv
  // staging/prod ayrımı için kritik.
  private deployment(): HealthSnapshot['deployment'] {
    return {
      gitSha: process.env.GIT_SHA ?? null,
      imageTag: process.env.IMAGE_TAG ?? null,
      buildTime: process.env.BUILD_TIME ?? null,
      deployedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      nodeEnv: process.env.NODE_ENV ?? 'development',
    };
  }

  private assertReader(actor: PlatformActor): void {
    const allowed =
      actor.role === 'platform_owner' ||
      actor.role === 'platform_engineer' ||
      actor.role === 'platform_support';
    if (!allowed) throw new ForbiddenException('Health snapshot platform admin gerektirir');
  }
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}
