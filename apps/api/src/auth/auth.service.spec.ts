import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AuditService } from '../audit/audit.service';
import { AdminPrismaService } from '../prisma/admin-prisma.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

const ACCESS_SECRET = 'test-access-secret-32-bytes-min-aaaaaa';
const REFRESH_SECRET = 'test-refresh-secret-32-bytes-min-aaaaa';

const tenantId = '00000000-0000-0000-0000-000000000001';
const userId = '00000000-0000-0000-0000-000000000010';
const VALID_COOKIE = `${tenantId}.${'a'.repeat(64)}`;

function makeTenant(overrides: Partial<{ status: string; deletedAt: Date | null }> = {}) {
  return {
    id: tenantId,
    slug: 'demoeye-dushanbe',
    status: 'active',
    deletedAt: null,
    ...overrides,
  };
}

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: userId,
    tenantId,
    email: 'admin@demoeye.tj',
    passwordHash: '',
    name: 'Admin',
    status: 'active',
    mustChangePassword: false,
    failedLoginCount: 0,
    lockedUntil: null,
    deletedAt: null,
    userRoles: [{ role: { key: 'yonetici', isActive: true } }],
    ...overrides,
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    tenant: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock; update: jest.Mock };
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    runWithTenant: jest.Mock;
    scoped: unknown;
  };

  beforeEach(async () => {
    const inner = {
      tenant: { findUnique: jest.fn() },
      user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      // PermissionAssignment runtime: login/refresh artık tenant override'larını
      // çekiyor → mock boş döndürür, effectivePerms registry varsayılanına eşit
      // hesaplanır (mevcut test assertion'ları davranış değişmemiş gibi geçer).
      permissionAssignment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    prisma = {
      ...inner,
      runWithTenant: jest.fn(async (_tid: string, fn: (tx: unknown) => unknown) => fn(inner)),
      scoped: inner,
    };

    const configMap: Record<string, string> = {
      BCRYPT_COST: '4',
      JWT_ACCESS_SECRET: ACCESS_SECRET,
      JWT_REFRESH_SECRET: REFRESH_SECRET,
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL: '7d',
    };
    const config = { get: (key: string) => configMap[key] } as unknown as ConfigService;

    const auditMock = {
      record: jest.fn().mockResolvedValue(undefined),
      recordOutOfBand: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: new JwtService({}) },
        { provide: AuditService, useValue: auditMock },
        { provide: ConfigService, useValue: config },
        {
          provide: AdminPrismaService,
          useValue: {
            tenantImpersonation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          } as unknown as AdminPrismaService,
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('login', () => {
    it('rejects unknown tenant', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      await expect(service.login('nope', 'a@b.tj', 'password1')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects suspended tenant', async () => {
      prisma.tenant.findUnique.mockResolvedValue(makeTenant({ status: 'suspended' }));
      await expect(service.login('t', 'a@b.tj', 'password1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects unknown user', async () => {
      prisma.tenant.findUnique.mockResolvedValue(makeTenant());
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login('t', 'a@b.tj', 'password1')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects locked user', async () => {
      prisma.tenant.findUnique.mockResolvedValue(makeTenant());
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ lockedUntil: new Date(Date.now() + 60_000) }),
      );
      await expect(service.login('t', 'a@b.tj', 'password1')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects bad password and increments failed count (atomic, #1061)', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.tenant.findUnique.mockResolvedValue(makeTenant());
      prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash, failedLoginCount: 2 }));
      prisma.user.update.mockResolvedValue({ failedLoginCount: 3 });

      await expect(service.login('t', 'a@b.tj', 'wrong-password')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { failedLoginCount: { increment: 1 } },
        }),
      );
      // Eşik altında kilit yazımı yok (tek update).
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
    });

    it('locks account on 5th failed attempt', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.tenant.findUnique.mockResolvedValue(makeTenant());
      prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash, failedLoginCount: 4 }));
      prisma.user.update.mockResolvedValue({ failedLoginCount: 5 });

      await expect(service.login('t', 'a@b.tj', 'wrong-password')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      // 1. çağrı atomik increment, 2. çağrı kilit yazımı.
      expect(prisma.user.update).toHaveBeenCalledTimes(2);
      const lockCall = prisma.user.update.mock.calls[1][0];
      expect(lockCall.data.lockedUntil).toBeInstanceOf(Date);
      expect(lockCall.data.status).toBe('locked');
    });

    it('returns tokens and resets counters on success', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.tenant.findUnique.mockResolvedValue(makeTenant());
      prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash, failedLoginCount: 3 }));

      const result = await service.login('t', 'a@b.tj', 'correct-password', '127.0.0.1', 'jest');
      if ('needsModeSelection' in result) throw new Error('beklenmeyen needsModeSelection');

      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.refreshToken).toMatch(/^[0-9a-f-]{36}\.[0-9a-f]{64}$/);
      expect(result.mustChangePassword).toBe(false);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ failedLoginCount: 0, lockedUntil: null }),
        }),
      );
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });

    it('issues access token with tenantId and roles claim', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.tenant.findUnique.mockResolvedValue(makeTenant());
      prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash }));

      const loginResult = await service.login('t', 'a@b.tj', 'correct-password');
      if ('needsModeSelection' in loginResult) throw new Error('beklenmeyen needsModeSelection');
      const { accessToken } = loginResult;
      const jwt = new JwtService({});
      const decoded = jwt.verify<{ tenantId: string; roles: string[]; sub: string }>(accessToken, {
        secret: ACCESS_SECRET,
      });
      expect(decoded.tenantId).toBe(tenantId);
      expect(decoded.sub).toBe(userId);
      expect(decoded.roles).toEqual(['yonetici']);
    });

    it('opens tenant-scoped transaction with correct tenant id', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.tenant.findUnique.mockResolvedValue(makeTenant());
      prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash }));

      await service.login('t', 'a@b.tj', 'correct-password');
      expect(prisma.runWithTenant).toHaveBeenCalledWith(tenantId, expect.any(Function));
    });
  });

  describe('refresh', () => {
    it('rejects malformed cookie', async () => {
      await expect(service.refresh('not-a-cookie')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.runWithTenant).not.toHaveBeenCalled();
    });

    it('rejects unknown refresh token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refresh(VALID_COOKIE)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects revoked refresh token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'r1',
        tenantId,
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        user: makeUser(),
      });
      await expect(service.refresh(VALID_COOKIE)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects expired refresh token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'r1',
        tenantId,
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1_000),
        user: makeUser(),
      });
      await expect(service.refresh(VALID_COOKIE)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rotates token on success', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'r1',
        tenantId,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(), // #921 — idle timeout: taze token (gap ~0 < 30dk) → geçer
        user: makeUser(),
      });
      const tokens = await service.refresh(VALID_COOKIE);
      expect(tokens.accessToken).toEqual(expect.any(String));
      expect(tokens.refreshToken).toMatch(/^[0-9a-f-]{36}\.[0-9a-f]{64}$/);
      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'r1' }, data: { revokedAt: expect.any(Date) } }),
      );
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
      expect(prisma.runWithTenant).toHaveBeenCalledWith(tenantId, expect.any(Function));
    });

    it('idle timeout: createdAt 30dk`dan eski → 401 + token revoke (#921)', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'r1',
        tenantId,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000), // süresi dolmamış
        createdAt: new Date(Date.now() - 31 * 60_000), // 31 dk → 30dk idle eşiği aşıldı
        user: makeUser(),
      });
      await expect(service.refresh(VALID_COOKIE)).rejects.toBeInstanceOf(UnauthorizedException);
      // idle-expired token revoke edilir (yeniden kullanılamaz)
      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'r1' }, data: { revokedAt: expect.any(Date) } }),
      );
      // rotasyon olmaz (yeni token üretilmez)
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('oturum modunu refresh token satırından korur (kilitli kiosk kilitli kalır)', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'r1',
        tenantId,
        mode: 'olcum',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(), // #921 — idle timeout: taze token
        user: makeUser({ userRoles: [{ role: { key: 'hemsire', isActive: true } }] }),
      });
      const tokens = await service.refresh(VALID_COOKIE);
      const decoded = new JwtService({}).verify<{ mode?: string; effectivePerms?: string[] }>(
        tokens.accessToken,
        { secret: ACCESS_SECRET },
      );
      expect(decoded.mode).toBe('olcum');
      expect(decoded.effectivePerms).toContain('page:measurementQueue');
      expect(decoded.effectivePerms).not.toContain('page:dashboard');
      // Yeni (rotasyon) refresh token satırı da modu taşır.
      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ mode: 'olcum' }) }),
      );
    });
  });

  describe('login — v0.4 çalışma modu (#539)', () => {
    const decode = (token: string) =>
      new JwtService({}).verify<{ mode?: string; effectivePerms?: string[] }>(token, {
        secret: ACCESS_SECRET,
      });

    async function setupUser(overrides: Record<string, unknown>) {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.tenant.findUnique.mockResolvedValue(makeTenant());
      prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash, ...overrides }));
    }

    it('tek mod → otomatik seçilir; JWT mode dolu; refresh token modu saklar; kilitli kısıtlar', async () => {
      await setupUser({
        userRoles: [{ role: { key: 'hemsire', isActive: true } }],
        flags: { modes: ['olcum'] },
      });
      const result = await service.login('t', 'a@b.tj', 'correct-password');
      if ('needsModeSelection' in result) throw new Error('beklenmeyen needsModeSelection');
      const decoded = decode(result.accessToken);
      expect(decoded.mode).toBe('olcum');
      expect(decoded.effectivePerms).toContain('page:measurementQueue');
      expect(decoded.effectivePerms).not.toContain('page:dashboard');
      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ mode: 'olcum' }) }),
      );
    });

    it('çok mod + seçim yok → needsModeSelection (token verilmez)', async () => {
      await setupUser({
        userRoles: [{ role: { key: 'hemsire', isActive: true } }],
        flags: { modes: ['genel', 'asistan'] },
      });
      const result = await service.login('t', 'a@b.tj', 'correct-password');
      expect(result).toEqual({ needsModeSelection: true, availableModes: ['genel', 'asistan'] });
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('çok mod + geçerli seçim → token + mode claim', async () => {
      await setupUser({
        userRoles: [{ role: { key: 'hemsire', isActive: true } }],
        flags: { modes: ['genel', 'asistan'] },
      });
      const result = await service.login(
        't',
        'a@b.tj',
        'correct-password',
        undefined,
        undefined,
        'asistan',
      );
      if ('needsModeSelection' in result) throw new Error('beklenmeyen needsModeSelection');
      expect(decode(result.accessToken).mode).toBe('asistan');
    });

    it('uygunsuz mod → BadRequest', async () => {
      await setupUser({
        userRoles: [{ role: { key: 'hemsire', isActive: true } }],
        flags: { modes: ['genel', 'asistan'] },
      });
      await expect(
        service.login('t', 'a@b.tj', 'correct-password', undefined, undefined, 'olcum'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('modsuz kullanıcı + mod gönderildi → BadRequest', async () => {
      await setupUser({});
      await expect(
        service.login('t', 'a@b.tj', 'correct-password', undefined, undefined, 'genel'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('modsuz kullanıcı + mod yok → klasik (mode claim undefined)', async () => {
      await setupUser({});
      const result = await service.login('t', 'a@b.tj', 'correct-password');
      if ('needsModeSelection' in result) throw new Error('beklenmeyen needsModeSelection');
      expect(decode(result.accessToken).mode).toBeUndefined();
    });
  });

  describe('logout', () => {
    it('does nothing without a token', async () => {
      await service.logout(undefined);
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('silently ignores malformed cookies', async () => {
      await service.logout('garbage');
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('revokes the matching refresh token within tenant scope', async () => {
      await service.logout(VALID_COOKIE);
      expect(prisma.runWithTenant).toHaveBeenCalledWith(tenantId, expect.any(Function));
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ revokedAt: null }),
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });
  });

  describe('changePassword', () => {
    it('throws if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.changePassword(userId, 'old1pass', 'new1pass')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws if current password is wrong', async () => {
      const passwordHash = await bcrypt.hash('correct', 4);
      prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash }));
      await expect(service.changePassword(userId, 'wrong', 'new1pass')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects reuse of current password', async () => {
      const passwordHash = await bcrypt.hash('samepass1', 4);
      prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash }));
      await expect(service.changePassword(userId, 'samepass1', 'samepass1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('updates password and revokes refresh tokens on success', async () => {
      const passwordHash = await bcrypt.hash('oldpass1', 4);
      prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash }));
      await service.changePassword(userId, 'oldpass1', 'newpass1');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ mustChangePassword: false }),
        }),
      );
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
    });
  });
});
