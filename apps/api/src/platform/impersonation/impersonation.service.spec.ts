import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { AdminPrismaService } from '../../prisma/admin-prisma.service';
import type { PlatformAuditService } from '../audit/platform-audit.service';
import type { PlatformJwtPayload } from '../auth/platform-auth.types';
import { ImpersonationService } from './impersonation.service';

// #938 — ImpersonationService unit testi. Kilitlenen kurallar: start guard'ları
// (hedef/tenant aktif, aynı user'a tek aktif oturum), token'ın AYRI secret ile
// imzalanması + imp claim'i, start/stop audit kaydı, force-stop'un yalnız
// platform_owner olması, listActive rol scope'u. #1065 sonrası AdminPrismaService.

const IMP_SECRET = 'imp-secret';
const OWNER = {
  sub: 'adm-owner',
  email: 'ali@dnasoft.co',
  role: 'platform_owner',
} as unknown as PlatformJwtPayload;
const SUPPORT = {
  sub: 'adm-sup',
  email: 'sup@dnasoft.co',
  role: 'platform_support',
} as unknown as PlatformJwtPayload;

function makeConfig(secret: string | null = IMP_SECRET): ConfigService {
  return { get: () => secret ?? undefined } as unknown as ConfigService;
}

function mockAudit() {
  return { record: jest.fn().mockResolvedValue(undefined) } as unknown as PlatformAuditService;
}

function targetUser(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'usr-1',
    tenantId: 'ten-1',
    email: 'doktor@klinik.tj',
    name: 'Dr. X',
    status: 'active',
    tenant: { id: 'ten-1', slug: 'demoeye', name: 'DemoEye', status: 'active' },
    userRoles: [{ role: { key: 'doktor' } }],
    ...over,
  };
}

function makeAdmin(over: Record<string, Record<string, jest.Mock>> = {}) {
  const admin = {
    user: {
      findFirst: jest.fn().mockResolvedValue(targetUser()),
      ...(over.user ?? {}),
    },
    tenantImpersonation: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }) => ({ id: 'imp-1', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      ...(over.tenantImpersonation ?? {}),
    },
  };
  return admin;
}

function makeService(adminMock = makeAdmin()) {
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed-token') } as unknown as JwtService;
  const audit = mockAudit();
  const service = new ImpersonationService(
    jwt,
    audit,
    makeConfig(),
    adminMock as unknown as AdminPrismaService,
  );
  return { service, jwt, audit, admin: adminMock };
}

const START_INPUT = {
  targetUserId: 'usr-1',
  reason: 'destek talebi #42',
  durationMin: 30,
  admin: OWNER,
  ip: '10.0.0.1',
  userAgent: 'jest',
};

describe('ImpersonationService (#938)', () => {
  it('PLATFORM_IMPERSONATION_JWT_SECRET yoksa boot`ta hata (fail-fast)', () => {
    expect(
      () =>
        new ImpersonationService(
          {} as unknown as JwtService,
          mockAudit(),
          makeConfig(null),
          makeAdmin() as unknown as AdminPrismaService,
        ),
    ).toThrow('PLATFORM_IMPERSONATION_JWT_SECRET');
  });

  describe('start', () => {
    it('hedef kullanıcı yoksa → NotFound', async () => {
      const admin = makeAdmin({ user: { findFirst: jest.fn().mockResolvedValue(null) } });
      const { service } = makeService(admin);
      await expect(service.start(START_INPUT)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('hedef kullanıcı aktif değil → BadRequest', async () => {
      const admin = makeAdmin({
        user: { findFirst: jest.fn().mockResolvedValue(targetUser({ status: 'disabled' })) },
      });
      const { service } = makeService(admin);
      await expect(service.start(START_INPUT)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('hedef tenant suspended → BadRequest (askıdaki kliniğe girilemez)', async () => {
      const admin = makeAdmin({
        user: {
          findFirst: jest.fn().mockResolvedValue(
            targetUser({
              tenant: { id: 'ten-1', slug: 'demoeye', name: 'DemoEye', status: 'suspended' },
            }),
          ),
        },
      });
      const { service } = makeService(admin);
      await expect(service.start(START_INPUT)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('aynı kullanıcıya ikinci aktif oturum → Conflict', async () => {
      const admin = makeAdmin({
        tenantImpersonation: {
          findFirst: jest.fn().mockResolvedValue({ id: 'imp-existing' }),
          create: jest.fn(),
        },
      });
      const { service } = makeService(admin);
      await expect(service.start(START_INPUT)).rejects.toBeInstanceOf(ConflictException);
      expect(admin.tenantImpersonation.create).not.toHaveBeenCalled();
    });

    it('başarılı start: DB kaydı + AYRI secret ile imp claim`li token + audit', async () => {
      const { service, jwt, audit, admin } = makeService();
      const result = await service.start(START_INPUT);

      // DB satırı süre + kim bilgisiyle yazılır.
      const rowData = admin.tenantImpersonation.create.mock.calls[0][0].data;
      expect(rowData.platformAdminId).toBe('adm-owner');
      expect(rowData.targetUserId).toBe('usr-1');
      expect(rowData.reason).toBe('destek talebi #42');

      // Token impersonation secret'i ile imzalanır; payload imp claim'i taşır.
      const [payload, options] = (jwt.signAsync as jest.Mock).mock.calls[0];
      expect(options.secret).toBe(IMP_SECRET);
      expect(options.expiresIn).toBe(30 * 60);
      expect(payload).toEqual(
        expect.objectContaining({
          sub: 'usr-1',
          tenantId: 'ten-1',
          roles: ['doktor'],
          imp: { id: 'imp-1', by: 'adm-owner', byName: 'ali@dnasoft.co' },
        }),
      );

      expect(result.impersonationToken).toBe('signed-token');
      expect(result.targetUser.tenantSlug).toBe('demoeye');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tenant.impersonate.start', entityId: 'usr-1' }),
      );
    });
  });

  describe('stopOwnActive', () => {
    it('aktif oturum yoksa {stopped:0}, audit yazılmaz', async () => {
      const { service, audit } = makeService();
      await expect(service.stopOwnActive(OWNER, null)).resolves.toEqual({ stopped: 0 });
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('kendi aktif oturumları manual_stop ile kapanır + her biri audit`lenir', async () => {
      const admin = makeAdmin({
        tenantImpersonation: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'imp-1', targetUserId: 'u1' },
            { id: 'imp-2', targetUserId: 'u2' },
          ]),
          updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
      });
      const { service, audit } = makeService(admin);
      await expect(service.stopOwnActive(OWNER, '10.0.0.1')).resolves.toEqual({ stopped: 2 });
      expect(admin.tenantImpersonation.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['imp-1', 'imp-2'] }, endedAt: null },
        data: { endedAt: expect.any(Date), endedReason: 'manual_stop' },
      });
      expect(audit.record).toHaveBeenCalledTimes(2);
    });
  });

  describe('forceStop', () => {
    it('platform_owner olmayan → Forbidden', async () => {
      const { service } = makeService();
      await expect(service.forceStop('imp-1', SUPPORT, null)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('zaten bitmiş oturum → idempotent ok, update yapılmaz', async () => {
      const admin = makeAdmin({
        tenantImpersonation: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'imp-1', endedAt: new Date(), targetUserId: 'u1' }),
          updateMany: jest.fn(),
        },
      });
      const { service } = makeService(admin);
      await expect(service.forceStop('imp-1', OWNER, null)).resolves.toEqual({ ok: true });
      expect(admin.tenantImpersonation.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('listActive', () => {
    it('owner tüm aktifleri görür; support yalnız kendi açtıklarını', async () => {
      const { service, admin } = makeService();
      await service.listActive(OWNER);
      const ownerWhere = admin.tenantImpersonation.findMany.mock.calls[0][0].where;
      expect(ownerWhere.platformAdminId).toBeUndefined();
      expect(ownerWhere.endedAt).toBeNull();

      await service.listActive(SUPPORT);
      const supportWhere = admin.tenantImpersonation.findMany.mock.calls[1][0].where;
      expect(supportWhere.platformAdminId).toBe('adm-sup');
    });

    it('süresi geçmiş kayıtlar sorgu seviyesinde elenir + remainingSeconds negatif olamaz', async () => {
      const past = new Date(Date.now() - 60_000);
      const admin = makeAdmin({
        tenantImpersonation: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'imp-1',
              platformAdminId: 'adm-owner',
              platformAdmin: { email: 'a@x', name: 'A' },
              targetUserId: 'u1',
              targetUser: { email: 'u@x', name: 'U' },
              targetTenantId: 'ten-1',
              targetTenant: { slug: 's', name: 'S' },
              reason: 'r',
              startedAt: past,
              expiresAt: past,
            },
          ]),
        },
      });
      const { service } = makeService(admin);
      const rows = await service.listActive(OWNER);
      expect(admin.tenantImpersonation.findMany.mock.calls[0][0].where.expiresAt.gt).toBeInstanceOf(
        Date,
      );
      expect(rows[0].remainingSeconds).toBe(0);
    });
  });
});
