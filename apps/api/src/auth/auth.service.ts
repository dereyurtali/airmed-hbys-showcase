import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { type RoleKey } from '@airmed/db';
import { SESSION_IDLE_TIMEOUT_MS } from '../common/session-idle';
import { AuditService } from '../audit/audit.service';
import { AdminPrismaService } from '../prisma/admin-prisma.service';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantPrismaClient } from '../tenant/tenant-context.service';
import {
  computeEffectivePermissions,
  resolveLoginMode,
  type PermissionOverride,
} from '@airmed/contracts';
import type { AuthTokens, JwtPayload } from './auth.types';

// v0.4 (#539) — login iki fazlı olabilir: kullanıcının >1 uygun modu varsa ve
// istemci mod seçmediyse token verilmez, seçilebilir modlar döner; istemci modu
// seçip tekrar login eder. Tek/sıfır modda tek fazda token döner (klasik).
export type LoginResult =
  | (AuthTokens & { mustChangePassword: boolean })
  | { needsModeSelection: true; availableModes: string[] };

const FAILED_LOGIN_THRESHOLD = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const REFRESH_TTL_DAYS_DEFAULT = 7;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly bcryptCost: number;
  private readonly accessSecret: string;
  private readonly accessTtl: string;
  private readonly refreshTtlDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    config: ConfigService,
    private readonly adminPrisma: AdminPrismaService,
  ) {
    this.bcryptCost = Number(config.get('BCRYPT_COST') ?? 12);
    this.accessSecret = required(config, 'JWT_ACCESS_SECRET');
    required(config, 'JWT_REFRESH_SECRET');
    this.accessTtl = config.get<string>('JWT_ACCESS_TTL') ?? '15m';
    this.refreshTtlDays = parseDays(
      config.get<string>('JWT_REFRESH_TTL') ?? '7d',
      REFRESH_TTL_DAYS_DEFAULT,
    );
  }

  async login(
    tenantSlug: string,
    email: string,
    password: string,
    ip?: string,
    userAgent?: string,
    mode?: string,
  ): Promise<LoginResult> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant || tenant.deletedAt) throw new UnauthorizedException('Invalid credentials');
    if (tenant.status !== 'active') throw new ForbiddenException('Tenant suspended');

    try {
      // #1061 — Üç faz: kısa okuma tx'i → bcrypt TX DIŞINDA (~250ms saf CPU,
      // havuz bağlantısını rehin tutmasın) → kısa yazım tx'i. Vardiya başı
      // toplu girişte havuzun bcrypt hesaplarıyla dolmasını önler.
      const user = await this.prisma.runWithTenant(tenant.id, (tx) =>
        tx.user.findUnique({
          where: { tenantId_email: { tenantId: tenant.id, email } },
          include: { userRoles: { include: { role: true } } },
        }),
      );
      if (!user || user.deletedAt) throw new UnauthorizedException('Invalid credentials');

      if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
        throw new UnauthorizedException('Account temporarily locked');
      }
      if (user.status !== 'active') throw new ForbiddenException('Account is not active');

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        await this.prisma.runWithTenant(tenant.id, (tx) => this.registerFailedLogin(tx, user.id));
        throw new UnauthorizedException('Invalid credentials');
      }

      // S5 — user.flags JSON kolonu (rol üstü bayraklar + v0.4 modes).
      const flags = (user.flags ?? undefined) as JwtPayload['flags'];

      // v0.4 (#539) — Çalışma modu çözümü. Menü gizlemek yetmez; mod uygunluğu
      // arka planda doğrulanır. Uygunsuz mod → 400; >1 uygun mod + seçimsiz →
      // token verilmeden seçilebilir modlar döner (istemci moda göre tekrar login).
      const resolution = resolveLoginMode(flags?.modes, mode);
      if (resolution.kind === 'invalid') {
        throw new BadRequestException(
          resolution.reason === 'not-allowed'
            ? 'Bu kullanıcı için çalışma modu seçimi yok'
            : 'Geçersiz çalışma modu',
        );
      }
      if (resolution.kind === 'select') {
        return { needsModeSelection: true as const, availableModes: resolution.availableModes };
      }
      const selectedMode = resolution.mode;

      return await this.prisma.runWithTenant(tenant.id, async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: 0,
            lockedUntil: null,
            lastLoginAt: new Date(),
            lastLoginIp: ip ?? null,
          },
        });

        const roles = user.userRoles.filter((ur) => ur.role.isActive).map((ur) => ur.role.key);
        // PermissionAssignment runtime + v0.4 mod: kilitli modda effectivePerms
        // moda ait alt-kümeye daraltılır (kiosk izolasyonu, #537).
        const effectivePerms = await this.computeEffectivePerms(tx, tenant.id, roles, selectedMode);
        const tokens = await this.issueTokens(
          tx,
          {
            sub: user.id,
            tenantId: tenant.id,
            email: user.email,
            roles,
            flags,
            effectivePerms,
            mode: selectedMode,
          },
          ip,
          userAgent,
        );

        await tx.auditLog.create({
          data: {
            tenantId: tenant.id,
            userId: user.id,
            action: 'auth.login.success',
            entityType: 'user',
            entityId: user.id,
            // Kilitli kiosk girişleri dahil mod audit'lenir (güvenlik izi).
            payload: { email, mode: selectedMode ?? null },
            ip: ip ?? null,
            userAgent: userAgent ?? null,
          },
        });

        return { ...tokens, mustChangePassword: user.mustChangePassword };
      });
    } catch (err) {
      // Login transaction was rolled back; record the failure out of band.
      await this.audit.recordOutOfBand(tenant.id, {
        action: 'auth.login.failure',
        entityType: 'user',
        payload: { email, reason: (err as Error).message },
        ip: ip ?? null,
        userAgent: userAgent ?? null,
      });
      throw err;
    }
  }

  async refresh(refreshToken: string, ip?: string, userAgent?: string): Promise<AuthTokens> {
    const { tenantId, token } = parseRefreshCookie(refreshToken);
    const tokenHash = hashToken(token);

    return this.prisma.runWithTenant(tenantId, async (tx) => {
      const stored = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: { include: { userRoles: { include: { role: true } } } } },
      });
      if (!stored || stored.revokedAt) throw new UnauthorizedException('Invalid refresh token');
      if (stored.expiresAt.getTime() <= Date.now())
        throw new UnauthorizedException('Refresh token expired');
      // #921 — 30dk inaktivite timeout: token createdAt (son aktivite/rotasyon)
      // idle eşiğinden eski ise oturum idle-expired → revoke + reddet.
      if (Date.now() - stored.createdAt.getTime() > SESSION_IDLE_TIMEOUT_MS) {
        await tx.refreshToken.update({
          where: { id: stored.id },
          data: { revokedAt: new Date() },
        });
        throw new UnauthorizedException('Session idle timeout');
      }
      if (!stored.user || stored.user.deletedAt || stored.user.status !== 'active') {
        throw new UnauthorizedException('User not active');
      }

      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });

      const roles = stored.user.userRoles.filter((ur) => ur.role.isActive).map((ur) => ur.role.key);
      // S5 — refresh sırasında flag'leri user.flags'tan tekrar oku (admin
      // toggle'larda değişmiş olabilir; eski token'daki flag stale).
      const flags = (stored.user.flags ?? undefined) as JwtPayload['flags'];
      // v0.4 (#539) — Oturum modu refresh token satırından korunur. Kilitli kiosk
      // (olcum) access token (15dk) yenilenirken de kilitli kalır; çok-modlu
      // kullanıcı seçtiği moda sabit (yeniden giriş yapmadan mod değişmez).
      const sessionMode = stored.mode ?? undefined;
      // PermissionAssignment runtime: refresh'te override'lar yeniden okunur,
      // toggle değişikliği max access token TTL kadar gecikmeyle yansır.
      const effectivePerms = await this.computeEffectivePerms(
        tx,
        stored.tenantId,
        roles,
        sessionMode,
      );
      return this.issueTokens(
        tx,
        {
          sub: stored.user.id,
          tenantId: stored.tenantId,
          email: stored.user.email,
          roles,
          flags,
          effectivePerms,
          mode: sessionMode,
        },
        ip,
        userAgent,
      );
    });
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    let parsed: { tenantId: string; token: string };
    try {
      parsed = parseRefreshCookie(refreshToken);
    } catch {
      return;
    }
    const tokenHash = hashToken(parsed.token);
    await this.prisma.runWithTenant(parsed.tenantId, async (tx) => {
      const result = await tx.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (result.count > 0) {
        await tx.auditLog.create({
          data: {
            tenantId: parsed.tenantId,
            action: 'auth.logout',
            entityType: 'refresh_token',
            payload: { count: result.count },
          },
        });
      }
    });
  }

  // F7 — Tenant banner Stop butonu. Sadece impersonation token ile çağrılır
  // (controller guard `imp` claim'i zorunlu kılmaz, ama biz burada kontrol
  // ediyoruz). impersonation row'unu manual_stop_by_target reason ile
  // kapatır → strategy bir sonraki istekte 401.
  async stopImpersonation(payload: JwtPayload): Promise<void> {
    if (!payload.imp) {
      throw new ForbiddenException('No active impersonation context');
    }
    // ImpersonationService kullanmak yerine doğrudan admin client ile update:
    // AuthService halihazırda tenant scope'unda; impersonation tablosu
    // cross-tenant olduğu için admin client gerekir. Tek satırlık update —
    // yeni bir module dependency kurmaktan daha hafif.
    // #1065 — paylaşımlı AdminPrismaService (tek havuz); per-call client açma.
    await this.adminPrisma.tenantImpersonation.updateMany({
      where: { id: payload.imp.id, endedAt: null },
      data: { endedAt: new Date(), endedReason: 'manual_stop_by_target' },
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const client = this.prisma.scoped;
    const user = await client.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Current password is incorrect');

    if (currentPassword === newPassword) {
      throw new ForbiddenException('New password must differ from current password');
    }

    const passwordHash = await bcrypt.hash(newPassword, this.bcryptCost);
    await client.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });
    await client.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      action: 'auth.password.changed',
      entityType: 'user',
      entityId: userId,
      userId,
    });
  }

  private async registerFailedLogin(tx: TenantPrismaClient, userId: string): Promise<void> {
    // #1061 — bcrypt tx dışına alınınca sayaç okuma-anındaki değere değil
    // atomik increment'e dayanır: eşzamanlı denemelerde lost-update olmaz,
    // 5-fail/15-dk semantiği korunur.
    const updated = await tx.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    if (updated.failedLoginCount >= FAILED_LOGIN_THRESHOLD) {
      await tx.user.update({
        where: { id: userId },
        data: { lockedUntil: new Date(Date.now() + LOCK_DURATION_MS), status: 'locked' },
      });
      this.logger.warn(`User ${userId} locked after ${updated.failedLoginCount} failed attempts`);
    }
  }

  /**
   * Tenant'taki PermissionAssignment override'larını çekip kullanıcının
   * etkili izin setini hesaplar. JWT'ye gömülecek `effectivePerms` claim'i
   * üretilir; PermissionGuard ve frontend usePermission önce buna bakar.
   * Performans: tek findMany (tenant başına 7×300 = ~2100 satır) + in-memory
   * join; cache'siz, sadece login + refresh path'inde çağrılır.
   */
  private async computeEffectivePerms(
    tx: TenantPrismaClient,
    tenantId: string,
    roles: readonly string[],
    mode?: string,
  ): Promise<string[]> {
    const overrides = await tx.permissionAssignment.findMany({
      where: { tenantId, roleKey: { in: roles as RoleKey[] } },
      select: { roleKey: true, resource: true, allowed: true },
    });
    return computeEffectivePermissions(roles, overrides as PermissionOverride[], mode);
  }

  private async issueTokens(
    tx: TenantPrismaClient,
    payload: JwtPayload,
    ip: string | undefined,
    userAgent: string | undefined,
  ): Promise<AuthTokens> {
    const accessToken = await this.jwt.signAsync(
      { ...payload },
      {
        secret: this.accessSecret,
        // jsonwebtoken accepts the "15m" / "7d" string form natively. Cast to
        // `ms.StringValue` keeps the @nestjs/jwt 11 + jsonwebtoken 9 typings
        // happy without lying about the runtime value.
        expiresIn: this.accessTtl as `${number}m` | `${number}d`,
      },
    );

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000);

    await tx.refreshToken.create({
      data: {
        tenantId: payload.tenantId,
        userId: payload.sub,
        tokenHash,
        expiresAt,
        ip: ip ?? null,
        userAgent: userAgent ?? null,
        // v0.4 (#539) — oturum modunu sakla; refresh rotasyonunda korunur.
        mode: payload.mode ?? null,
      },
    });

    return { accessToken, refreshToken: buildRefreshCookie(payload.tenantId, rawToken) };
  }
}

function buildRefreshCookie(tenantId: string, token: string): string {
  return `${tenantId}.${token}`;
}

export function parseRefreshCookie(value: string): { tenantId: string; token: string } {
  const idx = value.indexOf('.');
  if (idx === -1) throw new UnauthorizedException('Malformed refresh token');
  const tenantId = value.slice(0, idx);
  const token = value.slice(idx + 1);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId) ||
    !/^[0-9a-f]{64}$/i.test(token)
  ) {
    throw new UnauthorizedException('Malformed refresh token');
  }
  return { tenantId, token };
}

function required(config: ConfigService, key: string): string {
  const value = config.get<string>(key);
  if (!value) throw new Error(`${key} is not set`);
  return value;
}

function parseDays(ttl: string, fallback: number): number {
  const match = /^(\d+)d$/.exec(ttl.trim());
  return match ? Number(match[1]) : fallback;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
