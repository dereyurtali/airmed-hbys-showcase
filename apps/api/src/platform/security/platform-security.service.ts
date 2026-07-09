import { Injectable } from '@nestjs/common';
import { AdminPrismaService } from '../../prisma/admin-prisma.service';

// #1090 — Güvenlik olayları görünürlük servisi (İZLEME'den ayrı GÜVENLİK
// grubu). Salt-okuma; aksiyon IP Allowlist + Audit ekranlarında. Cross-tenant
// kilitli kullanıcı tek RLS-bypass sorgusuyla (tenant-loop yok — #1057).

export interface LoginAttemptRow {
  id: string;
  email: string;
  ip: string | null;
  success: boolean;
  failureReason: string | null;
  createdAt: string;
}
export interface LockedUserRow {
  id: string;
  tenantName: string;
  email: string;
  name: string;
  lockedUntil: string;
  failedLoginCount: number;
}
export interface SecuritySummary {
  platformLoginFails24h: number;
  clinicLoginFails24h: number;
  lockedClinicUsers: number;
  activeImpersonations: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PlatformSecurityService {
  constructor(private readonly admin: AdminPrismaService) {}

  async summary(): Promise<SecuritySummary> {
    const since = new Date(Date.now() - DAY_MS);
    const [platformFails, clinicFails, locked, impersonations] = await Promise.all([
      this.admin.platformAdminLoginAttempt.count({
        where: { success: false, createdAt: { gte: since } },
      }),
      this.admin.auditLog.count({
        where: { action: 'auth.login.failure', createdAt: { gte: since } },
      }),
      this.admin.user.count({ where: { lockedUntil: { gt: new Date() } } }),
      this.admin.tenantImpersonation.count({ where: { endedAt: null } }),
    ]);
    return {
      platformLoginFails24h: platformFails,
      clinicLoginFails24h: clinicFails,
      lockedClinicUsers: locked,
      activeImpersonations: impersonations,
    };
  }

  /** Platform login denemeleri — cursor pagination (Audit ekranı deseni). */
  async loginAttempts(params: {
    email?: string;
    ip?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ rows: LoginAttemptRow[]; nextCursor: string | null }> {
    const take = Math.min(100, params.limit ?? 50);
    const rows = await this.admin.platformAdminLoginAttempt.findMany({
      where: {
        ...(params.email ? { email: { contains: params.email, mode: 'insensitive' } } : {}),
        ...(params.ip ? { ipAddress: { contains: params.ip } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      // id BigInt autoincrement — cursor string'i BigInt'e çevrilir.
      ...(params.cursor ? { cursor: { id: BigInt(params.cursor) }, skip: 1 } : {}),
      select: {
        id: true,
        email: true,
        ipAddress: true,
        success: true,
        failureReason: true,
        createdAt: true,
      },
    });
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    return {
      rows: page.map((r) => ({
        id: String(r.id),
        email: r.email,
        ip: r.ipAddress,
        success: r.success,
        failureReason: r.failureReason,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? String(page[page.length - 1].id) : null,
    };
  }

  /** Kilitli klinik hesaplar (cross-tenant tek sorgu, tenant adıyla). */
  async lockedUsers(): Promise<LockedUserRow[]> {
    const rows = await this.admin.user.findMany({
      where: { lockedUntil: { gt: new Date() } },
      orderBy: { lockedUntil: 'desc' },
      take: 200,
      select: {
        id: true,
        email: true,
        name: true,
        lockedUntil: true,
        failedLoginCount: true,
        tenant: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      tenantName: r.tenant?.name ?? '—',
      email: r.email,
      name: r.name,
      lockedUntil: r.lockedUntil!.toISOString(),
      failedLoginCount: r.failedLoginCount,
    }));
  }
}
