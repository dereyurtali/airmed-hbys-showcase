import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AdminPrismaService } from '../../prisma/admin-prisma.service';
import { PlatformAuditService } from '../audit/platform-audit.service';
import type { JwtPayload, ImpersonationClaim } from '../../auth/auth.types';
import type { PlatformJwtPayload } from '../auth/platform-auth.types';

interface StartInput {
  targetUserId: string;
  reason: string;
  durationMin: number;
  admin: PlatformJwtPayload;
  ip: string | null;
  userAgent: string | null;
}

export interface StartResult {
  impersonationId: string;
  impersonationToken: string;
  expiresAt: Date;
  targetUser: {
    id: string;
    tenantId: string;
    email: string;
    name: string;
    tenantSlug: string;
    tenantName: string;
    roles: string[];
  };
}

export interface ActiveRow {
  id: string;
  platformAdminId: string;
  platformAdminEmail: string;
  platformAdminName: string;
  targetUserId: string;
  targetUserEmail: string;
  targetUserName: string;
  targetTenantId: string;
  targetTenantSlug: string;
  targetTenantName: string;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
  remainingSeconds: number;
}

export interface HistoryRow {
  id: string;
  platformAdminEmail: string;
  platformAdminName: string;
  targetUserEmail: string;
  targetUserName: string;
  targetTenantSlug: string;
  targetTenantName: string;
  reason: string;
  startedAt: Date;
  endedAt: Date | null;
  endedReason: string | null;
  durationSeconds: number;
}

interface HistoryFilters {
  tenantId?: string;
  adminId?: string;
  from?: string;
  to?: string;
}

// F4 — Tenant impersonation service.
//
// Tasarım kararları:
// - **DB-tracked tokens** (Redis yerine). Stop = update tenant_impersonations.
//   JwtStrategy her istekte satırı doğruluyor, anında revocation.
// - **Ayrı secret** (denetim P0 2.3): impersonation token'ları
//   `PLATFORM_IMPERSONATION_JWT_SECRET` ile imzalanıyor (klinik JWT_ACCESS_SECRET'inden
//   AYRI). Bir secret leak iki yetki sınırını birden devirmez. JwtStrategy
//   `secretOrKeyProvider` ile token'ın `imp` claim'ine bakıp doğru secret'i
//   seçiyor.
// - **Yetki:** Üç platform rolü de start/stop yapabilir (platform_support
//   destek senaryosu için kritik). Force-stop sadece platform_owner.
// - **Tenant suspended kontrolü:** start anında tenant.status === 'active'
//   şartı; suspend olayı sırasında ayrıca `onTenantSuspended` çağrısı tüm
//   aktif token'ları reddediyor (F4 PR 2'de tenants service'e hook).
// - **Uniqueness:** Aynı user'a 2 aktif impersonation engelleniyor —
//   partial unique index `(target_user_id) WHERE ended_at IS NULL` + servis
//   katmanında 409 Conflict.

@Injectable()
export class ImpersonationService {
  private readonly logger = new Logger(ImpersonationService.name);
  private readonly impersonationSecret: string;

  // Cross-tenant okuma + RLS bypass için admin client (health/feature-flags/
  // tenants servisleriyle aynı pattern). Impersonation hedefi herhangi bir
  // tenant'tan kullanıcı olabilir → scoped client tek tenant'a sıkışmış olur.
  // #1065 — paylaşımlı AdminPrismaService (tek havuz).
  constructor(
    private readonly jwt: JwtService,
    private readonly audit: PlatformAuditService,
    config: ConfigService,
    private readonly admin: AdminPrismaService,
  ) {
    const secret = config.get<string>('PLATFORM_IMPERSONATION_JWT_SECRET');
    if (!secret) throw new Error('PLATFORM_IMPERSONATION_JWT_SECRET is not set');
    this.impersonationSecret = secret;
  }

  async start(input: StartInput): Promise<StartResult> {
    const target = await this.admin.user.findFirst({
      where: { id: input.targetUserId, deletedAt: null },
      include: {
        tenant: { select: { id: true, slug: true, name: true, status: true } },
        userRoles: { include: { role: { select: { key: true } } } },
      },
    });
    if (!target) throw new NotFoundException('Target user not found');
    if (target.status !== 'active') {
      throw new BadRequestException('Target user is not active');
    }
    if (target.tenant.status !== 'active') {
      throw new BadRequestException('Target tenant is not active');
    }

    const existing = await this.admin.tenantImpersonation.findFirst({
      where: { targetUserId: input.targetUserId, endedAt: null },
    });
    if (existing) {
      throw new ConflictException('Active impersonation already exists for this user');
    }

    const durationMs = input.durationMin * 60 * 1000;
    const expiresAt = new Date(Date.now() + durationMs);
    const roles = target.userRoles.map((r) => r.role.key);

    const created = await this.admin.tenantImpersonation.create({
      data: {
        platformAdminId: input.admin.sub,
        targetUserId: target.id,
        targetTenantId: target.tenantId,
        reason: input.reason,
        expiresAt,
        ipAddress: input.ip,
        userAgent: input.userAgent,
      },
    });

    const imp: ImpersonationClaim = {
      id: created.id,
      by: input.admin.sub,
      byName: input.admin.email,
    };
    const payload: JwtPayload = {
      sub: target.id,
      tenantId: target.tenantId,
      email: target.email,
      roles,
      imp,
    };
    const expiresInSeconds = Math.floor(durationMs / 1000);
    const impersonationToken = await this.jwt.signAsync(payload, {
      secret: this.impersonationSecret,
      expiresIn: expiresInSeconds,
    });

    await this.audit.record({
      action: 'tenant.impersonate.start',
      adminId: input.admin.sub,
      email: input.admin.email,
      entityType: 'user',
      entityId: target.id,
      payload: {
        targetTenantId: target.tenantId,
        targetTenantSlug: target.tenant.slug,
        targetUserEmail: target.email,
        reason: input.reason,
        durationMin: input.durationMin,
        impersonationId: created.id,
      },
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return {
      impersonationId: created.id,
      impersonationToken,
      expiresAt,
      targetUser: {
        id: target.id,
        tenantId: target.tenantId,
        email: target.email,
        name: target.name,
        tenantSlug: target.tenant.slug,
        tenantName: target.tenant.name,
        roles,
      },
    };
  }

  async stopOwnActive(admin: PlatformJwtPayload, ip: string | null): Promise<{ stopped: number }> {
    const active = await this.admin.tenantImpersonation.findMany({
      where: { platformAdminId: admin.sub, endedAt: null },
    });
    if (active.length === 0) return { stopped: 0 };
    await this.endRows(
      active.map((a) => a.id),
      'manual_stop',
    );
    for (const row of active) {
      await this.audit.record({
        action: 'tenant.impersonate.end',
        adminId: admin.sub,
        email: admin.email,
        entityType: 'user',
        entityId: row.targetUserId,
        payload: { impersonationId: row.id, endedReason: 'manual_stop' },
        ip,
      });
    }
    return { stopped: active.length };
  }

  async forceStop(
    impersonationId: string,
    admin: PlatformJwtPayload,
    ip: string | null,
  ): Promise<{ ok: true }> {
    if (admin.role !== 'platform_owner') {
      throw new ForbiddenException('Force-stop yalnızca platform_owner');
    }
    const row = await this.admin.tenantImpersonation.findUnique({
      where: { id: impersonationId },
    });
    if (!row) throw new NotFoundException('Impersonation not found');
    if (row.endedAt) return { ok: true };
    await this.endRows([row.id], 'force_stop');
    await this.audit.record({
      action: 'tenant.impersonate.end',
      adminId: admin.sub,
      email: admin.email,
      entityType: 'user',
      entityId: row.targetUserId,
      payload: {
        impersonationId: row.id,
        endedReason: 'force_stop',
        forcedByOwner: true,
        originalPlatformAdminId: row.platformAdminId,
      },
      ip,
    });
    return { ok: true };
  }

  async listActive(admin: PlatformJwtPayload): Promise<ActiveRow[]> {
    // platform_owner tüm aktif kayıtları görebilir; engineer/support sadece
    // kendi açtıklarını.
    const where =
      admin.role === 'platform_owner'
        ? { endedAt: null, expiresAt: { gt: new Date() } }
        : { endedAt: null, expiresAt: { gt: new Date() }, platformAdminId: admin.sub };

    const rows = await this.admin.tenantImpersonation.findMany({
      where,
      include: {
        platformAdmin: { select: { email: true, name: true } },
        targetUser: { select: { email: true, name: true } },
        targetTenant: { select: { slug: true, name: true } },
      },
      orderBy: { startedAt: 'desc' },
    });
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      platformAdminId: r.platformAdminId,
      platformAdminEmail: r.platformAdmin.email,
      platformAdminName: r.platformAdmin.name,
      targetUserId: r.targetUserId,
      targetUserEmail: r.targetUser.email,
      targetUserName: r.targetUser.name,
      targetTenantId: r.targetTenantId,
      targetTenantSlug: r.targetTenant.slug,
      targetTenantName: r.targetTenant.name,
      reason: r.reason,
      startedAt: r.startedAt,
      expiresAt: r.expiresAt,
      remainingSeconds: Math.max(0, Math.floor((r.expiresAt.getTime() - now) / 1000)),
    }));
  }

  // #950 (Feature 2) — biten oturum geçmişi. Owner tümünü, engineer/support
  // yalnız kendi açtıklarını görür (listActive ile aynı rol scope'u).
  async listHistory(admin: PlatformJwtPayload, filters: HistoryFilters): Promise<HistoryRow[]> {
    const rows = await this.admin.tenantImpersonation.findMany({
      where: {
        endedAt: { not: null },
        ...(admin.role === 'platform_owner' ? {} : { platformAdminId: admin.sub }),
        ...(filters.tenantId ? { targetTenantId: filters.tenantId } : {}),
        ...(filters.adminId ? { platformAdminId: filters.adminId } : {}),
        ...(filters.from || filters.to
          ? {
              startedAt: {
                ...(filters.from ? { gte: new Date(filters.from) } : {}),
                ...(filters.to ? { lte: new Date(filters.to) } : {}),
              },
            }
          : {}),
      },
      include: {
        platformAdmin: { select: { email: true, name: true } },
        targetUser: { select: { email: true, name: true } },
        targetTenant: { select: { slug: true, name: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      platformAdminEmail: r.platformAdmin.email,
      platformAdminName: r.platformAdmin.name,
      targetUserEmail: r.targetUser.email,
      targetUserName: r.targetUser.name,
      targetTenantSlug: r.targetTenant.slug,
      targetTenantName: r.targetTenant.name,
      reason: r.reason,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      endedReason: r.endedReason,
      durationSeconds: r.endedAt
        ? Math.max(0, Math.floor((r.endedAt.getTime() - r.startedAt.getTime()) / 1000))
        : 0,
    }));
  }

  // F4 PR 2'de tenants service'in suspend hook'undan çağrılacak.
  async onTenantSuspended(tenantId: string): Promise<{ revoked: number }> {
    const active = await this.admin.tenantImpersonation.findMany({
      where: { targetTenantId: tenantId, endedAt: null },
      select: { id: true, targetUserId: true, platformAdminId: true },
    });
    if (active.length === 0) return { revoked: 0 };
    await this.endRows(
      active.map((a) => a.id),
      'tenant_suspended',
    );
    for (const row of active) {
      await this.audit.record({
        action: 'tenant.impersonate.end',
        adminId: row.platformAdminId,
        entityType: 'user',
        entityId: row.targetUserId,
        payload: { impersonationId: row.id, endedReason: 'tenant_suspended' },
      });
    }
    this.logger.warn(
      `tenant ${tenantId} suspended → revoked ${active.length} active impersonation(s)`,
    );
    return { revoked: active.length };
  }

  private async endRows(ids: string[], reason: string): Promise<void> {
    await this.admin.tenantImpersonation.updateMany({
      where: { id: { in: ids }, endedAt: null },
      data: { endedAt: new Date(), endedReason: reason },
    });
  }
}
