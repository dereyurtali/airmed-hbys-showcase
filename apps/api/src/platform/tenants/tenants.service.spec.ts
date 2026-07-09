import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { DEFAULT_CLINIC_ROLES } from '@airmed/db';
import type { AdminPrismaService } from '../../prisma/admin-prisma.service';
import type { PlatformAuditService } from '../audit/platform-audit.service';
import type { ImpersonationService } from '../impersonation/impersonation.service';
import { PlatformTenantsService } from './tenants.service';

// #938 — PlatformTenantsService unit testi. Kilitlenen kurallar: list filtre
// şekli + 200 tavanı, create'te slug üretimi/çakışması + tek transaction'da
// tenant+roller+admin user, suspend/reactivate durum geçişleri + refresh token
// revoke + impersonation hook. #1065 sonrası AdminPrismaService inject edilir.

// bcrypt cost-12 gerçek hash unit testte gereksiz yavaş → modül mock'u.
jest.mock('bcrypt', () => ({ hash: jest.fn().mockResolvedValue('hashed-pw') }));

const OWNER = { id: 'adm-1', email: 'ali@dnasoft.co', role: 'platform_owner' as const };
const SUPPORT = { id: 'adm-2', email: 'sup@dnasoft.co', role: 'platform_support' as const };
const CTX = { ip: '10.0.0.1', userAgent: 'jest' };

function mockAudit() {
  return { record: jest.fn().mockResolvedValue(undefined) } as unknown as PlatformAuditService;
}

function mockImpersonation() {
  return {
    onTenantSuspended: jest.fn().mockResolvedValue({ revoked: 0 }),
  } as unknown as ImpersonationService;
}

type TxMock = Record<string, Record<string, jest.Mock>>;

function makeTx(): TxMock {
  return {
    tenant: {
      create: jest.fn(async ({ data }) => ({ id: 'ten-1', ...data })),
      update: jest.fn(async ({ data }) => ({ id: 'ten-1', ...data })),
    },
    role: {
      create: jest.fn().mockResolvedValue({}),
      findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'role-yonetici' }),
    },
    user: { create: jest.fn(async ({ data }) => ({ id: 'usr-1', ...data })) },
    refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
  };
}

function makeAdmin(over: Record<string, unknown> = {}, tx: TxMock = makeTx()) {
  const admin = {
    tenant: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: 'ten-1', status: 'active' }),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(async ({ data }) => ({ id: 'ten-1', ...data })),
    },
    $transaction: jest.fn(async (fn: (tx: TxMock) => Promise<unknown>) => fn(tx)),
    ...over,
  };
  return { admin: admin as unknown as AdminPrismaService, raw: admin, tx };
}

function makeService(adminBundle = makeAdmin()) {
  const audit = mockAudit();
  const impersonation = mockImpersonation();
  const service = new PlatformTenantsService(audit, impersonation, adminBundle.admin);
  return { service, audit, impersonation, ...adminBundle };
}

describe('PlatformTenantsService (#938)', () => {
  describe('list', () => {
    it('filtreler where`e geçer, silinmişler default dışlanır, tavan 200', async () => {
      const { service, raw } = makeService();
      await service.list({ status: 'active', plan: 'pilot', search: 'turk' } as never);
      expect((raw.tenant as Record<string, jest.Mock>).findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            status: 'active',
            plan: 'pilot',
            OR: [
              { name: { contains: 'turk', mode: 'insensitive' } },
              { slug: { contains: 'turk', mode: 'insensitive' } },
            ],
          },
          take: 200,
        }),
      );
    });

    it('includeDeleted=true → deletedAt filtresi kalkar', async () => {
      const { service, raw } = makeService();
      await service.list({ includeDeleted: true } as never);
      const where = (raw.tenant as Record<string, jest.Mock>).findMany.mock.calls[0][0].where;
      expect(where.deletedAt).toBeUndefined();
    });
  });

  describe('create', () => {
    const input = {
      name: 'Göz Kliniği Şifa',
      adminEmail: 'Admin@Klinik.TJ',
      adminName: 'Dr. Admin',
    };

    it('platform_support → Forbidden (yalnız owner/engineer yazar)', async () => {
      const { service, raw } = makeService();
      await expect(service.create(input as never, SUPPORT, CTX)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect((raw.tenant as Record<string, jest.Mock>).findUnique).not.toHaveBeenCalled();
    });

    it('slug verilmezse Türkçe karakterli isimden ascii-kebab üretilir', async () => {
      const { service, tx } = makeService();
      await service.create(input as never, OWNER, CTX);
      expect(tx.tenant.create.mock.calls[0][0].data.slug).toBe('goz-klinigi-sifa');
    });

    it('slug çakışması → Conflict, transaction hiç başlamaz', async () => {
      const bundle = makeAdmin();
      (bundle.raw.tenant as Record<string, jest.Mock>).findUnique.mockResolvedValue({
        id: 'existing',
      });
      const { service, raw } = makeService(bundle);
      await expect(service.create(input as never, OWNER, CTX)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(raw.$transaction as jest.Mock).not.toHaveBeenCalled();
    });

    it('geçersiz üretilmiş slug (< 3 char) → BadRequest', async () => {
      const { service } = makeService();
      await expect(
        service.create({ ...input, name: '№!' } as never, OWNER, CTX),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('tek transaction: tenant + tüm default roller + yonetici admin user + audit + one-shot parola', async () => {
      const { service, tx, audit } = makeService();
      const result = await service.create(input as never, OWNER, CTX);

      expect(tx.role.create).toHaveBeenCalledTimes(DEFAULT_CLINIC_ROLES.length);
      const userData = tx.user.create.mock.calls[0][0].data;
      expect(userData.email).toBe('admin@klinik.tj'); // normalize edilir
      expect(userData.mustChangePassword).toBe(true);
      expect(userData.userRoles.create.roleId).toBe('role-yonetici');

      // Parola verilmediyse random üretilir ve YALNIZ cevapta döner.
      expect(result.adminTempPassword).toMatch(/^[0-9a-f]{16}$/);
      expect(result.adminEmail).toBe('admin@klinik.tj');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tenant.create', adminId: 'adm-1' }),
      );
    });
  });

  describe('suspend', () => {
    const suspendInput = { reason: 'payment_overdue' as const, note: 'geç ödeme' };

    it('zaten suspended → Conflict', async () => {
      const bundle = makeAdmin();
      (bundle.raw.tenant as Record<string, jest.Mock>).findFirst.mockResolvedValue({
        id: 'ten-1',
        status: 'suspended',
      });
      const { service } = makeService(bundle);
      await expect(
        service.suspend('ten-1', suspendInput as never, OWNER, CTX),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('geçersiz sebep → BadRequest', async () => {
      const { service } = makeService();
      await expect(
        service.suspend('ten-1', { reason: 'keyfi' } as never, OWNER, CTX),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('geçerli suspend: status geçişi + TÜM aktif refresh token revoke + impersonation hook + audit', async () => {
      const { service, tx, impersonation, audit } = makeService();
      await service.suspend('ten-1', suspendInput as never, OWNER, CTX);

      const data = tx.tenant.update.mock.calls[0][0].data;
      expect(data.status).toBe('suspended');
      expect(data.suspendReason).toBe('payment_overdue');
      expect(data.suspendedAt).toBeInstanceOf(Date);

      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { tenantId: 'ten-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(impersonation.onTenantSuspended).toHaveBeenCalledWith('ten-1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tenant.suspend', entityId: 'ten-1' }),
      );
    });
  });

  describe('reactivate', () => {
    it('suspended olmayan tenant → Conflict', async () => {
      const { service } = makeService(); // findFirst default: status active
      await expect(service.reactivate('ten-1', OWNER, CTX)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('suspended → active; suspend alanlarının tümü temizlenir', async () => {
      const bundle = makeAdmin();
      (bundle.raw.tenant as Record<string, jest.Mock>).findFirst.mockResolvedValue({
        id: 'ten-1',
        status: 'suspended',
      });
      const { service, raw, audit } = makeService(bundle);
      await service.reactivate('ten-1', OWNER, CTX);
      expect((raw.tenant as Record<string, jest.Mock>).update).toHaveBeenCalledWith({
        where: { id: 'ten-1' },
        data: {
          status: 'active',
          suspendedAt: null,
          suspendReason: null,
          suspendNote: null,
          autoReactivateAt: null,
        },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tenant.reactivate' }),
      );
    });
  });
});
