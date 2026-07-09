import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  PreconditionFailedException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { parseDays } from '../../common/duration.util';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { RecoveryCodeService } from './recovery-code.service';
import { TotpService } from './totp.service';
import { SESSION_IDLE_TIMEOUT_MS } from '../../common/session-idle';
import type {
  PlatformAuthTokens,
  PlatformChallengeJwtPayload,
  PlatformChallengeStage,
  PlatformJwtPayload,
} from './platform-auth.types';

const FAILED_LOGIN_THRESHOLD = 3;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const REFRESH_TTL_DAYS_DEFAULT = 7;
const CHALLENGE_TTL = '5m' as const;

interface LoginContext {
  ip?: string | null;
  userAgent?: string | null;
}

export interface PlatformLoginChallenge {
  challengeToken: string;
  needsTotpSetup: boolean;
}

export interface PlatformTotpSetupResult {
  otpauthUrl: string;
  secret: string;
  recoveryCodes: string[];
}

@Injectable()
export class PlatformAuthService {
  private readonly logger = new Logger(PlatformAuthService.name);
  private readonly accessSecret: string;
  // Challenge tokens are signed with the refresh secret — opaque random
  // bytes are still stored as the actual session refresh token. This keeps
  // the access secret tightly scoped to *fully authenticated* JWTs.
  private readonly challengeSecret: string;
  private readonly accessTtl: string;
  private readonly refreshTtlDays: number;
  private readonly bcryptCost: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: PlatformAuditService,
    private readonly totp: TotpService,
    private readonly recovery: RecoveryCodeService,
    config: ConfigService,
  ) {
    this.accessSecret = required(config, 'PLATFORM_JWT_ACCESS_SECRET');
    this.challengeSecret = required(config, 'PLATFORM_JWT_REFRESH_SECRET');
    this.accessTtl = config.get<string>('PLATFORM_JWT_ACCESS_TTL') ?? '15m';
    this.refreshTtlDays = parseDays(
      config.get<string>('PLATFORM_JWT_REFRESH_TTL') ?? '7d',
      REFRESH_TTL_DAYS_DEFAULT,
    );
    this.bcryptCost = Number(config.get('PLATFORM_BCRYPT_COST') ?? 12);
  }

  // ---------------------------------------------------------------------------
  // Step 1: email + password → 5-min challenge token
  // ---------------------------------------------------------------------------
  async login(email: string, password: string, ctx: LoginContext): Promise<PlatformLoginChallenge> {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { email } });
    if (!admin || !admin.isActive) {
      await this.recordAttempt(email, ctx, false, 'unknown_or_inactive');
      throw new UnauthorizedException('Invalid credentials');
    }
    if (admin.lockedUntil && admin.lockedUntil.getTime() > Date.now()) {
      await this.recordAttempt(email, ctx, false, 'locked_out', admin.id);
      throw new UnauthorizedException('Account temporarily locked');
    }

    // #1061 notu: platform login zaten açık tx İÇİNDE DEĞİL (platform route'ları
    // TenantInterceptor tx'ini atlar, buradaki sorgular tekil) — bcrypt burada
    // havuz bağlantısı rehin tutmaz. Yalnız sayaç atomikliği hizalandı.
    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) {
      await this.registerFailedLogin(admin.id);
      await this.recordAttempt(email, ctx, false, 'wrong_password', admin.id);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Password OK → reset failure counter (lockedUntil cleared at issueTokens
    // time; here we just track the password-step success).
    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });

    const needsTotpSetup = !admin.totpSecret;
    const stage: PlatformChallengeStage = needsTotpSetup ? 'totp_setup_required' : 'totp_required';
    const challengeToken = await this.signChallenge(admin.id, stage);

    await this.recordAttempt(email, ctx, true, null, admin.id);
    await this.audit.record({
      action: 'platform.auth.login.password_ok',
      adminId: admin.id,
      email: admin.email,
      payload: { stage },
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    return { challengeToken, needsTotpSetup };
  }

  // ---------------------------------------------------------------------------
  // Step 2a: setup-totp (only when admin has no totp_secret yet)
  // Persists secret + 10 recovery codes; returns secret + otpauth URL once.
  // After this, the *same* challenge stays valid (now stage='totp_required'
  // because the secret exists) — frontend immediately calls verify-totp.
  // ---------------------------------------------------------------------------
  async setupTotp(challengeToken: string, ctx: LoginContext): Promise<PlatformTotpSetupResult> {
    const claims = await this.verifyChallenge(challengeToken);
    if (claims.stage !== 'totp_setup_required') {
      throw new PreconditionFailedException('TOTP already configured');
    }
    const admin = await this.prisma.platformAdmin.findUniqueOrThrow({ where: { id: claims.sub } });
    if (admin.totpSecret) {
      throw new PreconditionFailedException('TOTP already configured');
    }

    const secret = this.totp.generateSecret();
    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      // #914 — DB'ye AES-256-GCM şifreli yaz (düz metin değil).
      data: { totpSecret: this.totp.encryptSecret(secret), totpVerifiedAt: null },
    });
    const recoveryCodes = await this.recovery.generateForAdmin(admin.id);
    const otpauthUrl = this.totp.buildOtpauthUrl(admin.email, secret);

    await this.audit.record({
      action: 'platform.auth.totp.setup',
      adminId: admin.id,
      email: admin.email,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    return { otpauthUrl, secret, recoveryCodes };
  }

  // ---------------------------------------------------------------------------
  // Step 2b: verify-totp — accepts authenticator code OR recovery code,
  //          issues final access + refresh.
  // ---------------------------------------------------------------------------
  async verifyTotp(
    challengeToken: string,
    body: { code?: string; recoveryCode?: string },
    ctx: LoginContext,
  ): Promise<PlatformAuthTokens> {
    if ((body.code && body.recoveryCode) || (!body.code && !body.recoveryCode)) {
      throw new BadRequestException('Provide exactly one of code or recoveryCode');
    }
    const claims = await this.verifyChallenge(challengeToken);
    const admin = await this.prisma.platformAdmin.findUniqueOrThrow({ where: { id: claims.sub } });
    if (!admin.totpSecret) {
      throw new PreconditionFailedException('TOTP setup required');
    }
    if (!admin.isActive) throw new ForbiddenException('Admin not active');

    let usedRecoveryCode = false;
    if (body.code) {
      // #914 — DB'deki şifreli sırrı çöz (legacy düz-metin ise aynen döner).
      const ok = this.totp.verify(body.code, this.totp.decryptSecret(admin.totpSecret));
      if (!ok) {
        await this.recordAttempt(admin.email, ctx, false, 'totp_invalid', admin.id);
        throw new UnauthorizedException('Invalid TOTP code');
      }
      // #914 — legacy düz-metin sır ilk başarılı doğrulamada şifrelenir (self-healing göç).
      if (!this.totp.isEncrypted(admin.totpSecret)) {
        await this.prisma.platformAdmin.update({
          where: { id: admin.id },
          data: { totpSecret: this.totp.encryptSecret(admin.totpSecret) },
        });
      }
    } else {
      const claimed = await this.recovery.claim(admin.id, body.recoveryCode!);
      if (!claimed) {
        await this.recordAttempt(admin.email, ctx, false, 'recovery_invalid', admin.id);
        throw new UnauthorizedException('Invalid recovery code');
      }
      usedRecoveryCode = true;
    }

    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: {
        totpVerifiedAt: admin.totpVerifiedAt ?? new Date(),
        lastLoginAt: new Date(),
        lastLoginIp: ctx.ip ?? null,
      },
    });

    const tokens = await this.issueTokens(
      { sub: admin.id, email: admin.email, role: admin.role },
      ctx,
    );

    await this.audit.record({
      action: usedRecoveryCode
        ? 'platform.auth.login.success_recovery'
        : 'platform.auth.login.success',
      adminId: admin.id,
      email: admin.email,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    return tokens;
  }

  async refresh(rawToken: string, ctx: LoginContext): Promise<PlatformAuthTokens> {
    const tokenHash = hashToken(rawToken);
    const session = await this.prisma.platformAdminSession.findUnique({
      where: { refreshTokenHash: tokenHash },
      include: { admin: true },
    });
    if (!session || session.revokedAt) throw new UnauthorizedException('Invalid refresh token');
    if (session.expiresAt.getTime() <= Date.now())
      throw new UnauthorizedException('Refresh token expired');
    // #921 — 30dk inaktivite timeout (klinik ile ortak eşik).
    if (Date.now() - session.createdAt.getTime() > SESSION_IDLE_TIMEOUT_MS) {
      await this.prisma.platformAdminSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Session idle timeout');
    }
    if (!session.admin.isActive) throw new ForbiddenException('Admin not active');

    await this.prisma.platformAdminSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(
      { sub: session.admin.id, email: session.admin.email, role: session.admin.role },
      ctx,
    );
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const tokenHash = hashToken(rawToken);
    const result = await this.prisma.platformAdminSession.updateMany({
      where: { refreshTokenHash: tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count > 0) {
      const session = await this.prisma.platformAdminSession.findUnique({
        where: { refreshTokenHash: tokenHash },
        select: { adminId: true },
      });
      await this.audit.record({
        action: 'platform.auth.logout',
        adminId: session?.adminId ?? null,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------
  private async signChallenge(adminId: string, stage: PlatformChallengeStage): Promise<string> {
    return this.jwt.signAsync({ sub: adminId, stage } satisfies PlatformChallengeJwtPayload, {
      secret: this.challengeSecret,
      expiresIn: CHALLENGE_TTL,
    });
  }

  private async verifyChallenge(token: string): Promise<PlatformChallengeJwtPayload> {
    try {
      const decoded = await this.jwt.verifyAsync<PlatformChallengeJwtPayload>(token, {
        secret: this.challengeSecret,
      });
      if (!decoded.sub || !decoded.stage) {
        throw new UnauthorizedException('Invalid challenge token');
      }
      return decoded;
    } catch {
      throw new UnauthorizedException('Invalid or expired challenge token');
    }
  }

  private async registerFailedLogin(adminId: string): Promise<void> {
    // #1061 — atomik increment: eşzamanlı denemelerde lost-update olmaz,
    // 3-fail/15-dk semantiği korunur (klinik registerFailedLogin ikizi).
    const updated = await this.prisma.platformAdmin.update({
      where: { id: adminId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    if (updated.failedLoginCount >= FAILED_LOGIN_THRESHOLD) {
      await this.prisma.platformAdmin.update({
        where: { id: adminId },
        data: { lockedUntil: new Date(Date.now() + LOCK_DURATION_MS) },
      });
      this.logger.warn(
        `Platform admin ${adminId} locked after ${updated.failedLoginCount} failed attempts`,
      );
    }
  }

  private async recordAttempt(
    email: string,
    ctx: LoginContext,
    success: boolean,
    failureReason: string | null,
    adminId?: string,
  ): Promise<void> {
    try {
      await this.prisma.platformAdminLoginAttempt.create({
        data: {
          email,
          ipAddress: ctx.ip ?? '0.0.0.0',
          success,
          failureReason: failureReason ?? null,
        },
      });
      if (!success) {
        await this.audit.record({
          action: 'platform.auth.login.failure',
          adminId: adminId ?? null,
          email,
          payload: { reason: failureReason },
          ip: ctx.ip ?? null,
          userAgent: ctx.userAgent ?? null,
        });
      }
    } catch (err) {
      this.logger.warn(`platform login attempt log failed: ${(err as Error).message}`);
    }
  }

  private async issueTokens(
    payload: PlatformJwtPayload,
    ctx: LoginContext,
  ): Promise<PlatformAuthTokens> {
    const accessToken = await this.jwt.signAsync(
      { ...payload },
      {
        secret: this.accessSecret,
        expiresIn: this.accessTtl as `${number}m` | `${number}d`,
      },
    );

    const rawRefresh = randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawRefresh);
    const expiresAt = new Date(Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000);

    await this.prisma.platformAdminSession.create({
      data: {
        adminId: payload.sub,
        refreshTokenHash: tokenHash,
        ipAddress: ctx.ip ?? '0.0.0.0',
        userAgent: ctx.userAgent ?? null,
        expiresAt,
      },
    });

    return { accessToken, refreshToken: rawRefresh };
  }

  // Reserved for the password rotation flow shipping with F2c.
  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.bcryptCost);
  }
}

function required(config: ConfigService, key: string): string {
  const value = config.get<string>(key);
  if (!value) throw new Error(`${key} is not set`);
  return value;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
