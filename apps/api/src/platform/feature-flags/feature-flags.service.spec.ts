import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AdminPrismaService } from '../../prisma/admin-prisma.service';
import type { PlatformAuditService } from '../audit/platform-audit.service';
import { FeatureFlagsService } from './feature-flags.service';

// #938 — FeatureFlagsService unit testi. Kilitlenen kurallar: bilinmeyen flag
// güvenli false, global flag override'ı yok sayar, override > default önceliği,
// set/clear sonrası cache invalidation (bayat değer dönmez), clear → default'a
// düşüş, yazma yetkisi yalnız owner/engineer. #1065 sonrası AdminPrismaService.

const TENANT = 'ten-1';
const OWNER = { id: 'adm-1', email: 'ali@dnasoft.co', role: 'platform_owner' as const };
const SUPPORT = { id: 'adm-2', email: 'sup@dnasoft.co', role: 'platform_support' as const };
const CTX = { ip: null, userAgent: null };

function def(key: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    key,
    name: key,
    description: null,
    defaultValue: false,
    isGlobal: false,
    ...over,
  };
}

function makeAdmin(over: Record<string, Record<string, jest.Mock>> = {}) {
  return {
    featureFlagDefinition: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }) => ({ ...data })),
      update: jest.fn(async ({ data }) => ({ ...data })),
      ...(over.featureFlagDefinition ?? {}),
    },
    featureFlagOverride: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(async ({ create }) => ({ ...create })),
      delete: jest.fn().mockResolvedValue({}),
      ...(over.featureFlagOverride ?? {}),
    },
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ id: TENANT }),
      ...(over.tenant ?? {}),
    },
  };
}

function makeService(admin = makeAdmin()) {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new FeatureFlagsService(
    audit as unknown as PlatformAuditService,
    admin as unknown as AdminPrismaService,
  );
  return { service, admin, audit };
}

describe('FeatureFlagsService (#938)', () => {
  describe('isEnabled', () => {
    it('bilinmeyen flag → false (güvenli default), override sorgusu yapılmaz', async () => {
      const { service, admin } = makeService();
      await expect(service.isEnabled('yok-boyle-flag', TENANT)).resolves.toBe(false);
      expect(admin.featureFlagOverride.findMany).not.toHaveBeenCalled();
    });

    it('global flag → her zaman defaultValue; tenant override`ına hiç bakılmaz', async () => {
      const admin = makeAdmin({
        featureFlagDefinition: {
          findMany: jest
            .fn()
            .mockResolvedValue([def('g1', { isGlobal: true, defaultValue: true })]),
        },
      });
      const { service } = makeService(admin);
      await expect(service.isEnabled('g1', TENANT)).resolves.toBe(true);
      expect(admin.featureFlagOverride.findMany).not.toHaveBeenCalled();
    });

    it('override varsa default`ı ezer; yoksa default döner', async () => {
      const admin = makeAdmin({
        featureFlagDefinition: {
          findMany: jest.fn().mockResolvedValue([def('f1'), def('f2', { defaultValue: true })]),
        },
        featureFlagOverride: {
          findMany: jest.fn().mockResolvedValue([{ flagKey: 'f1', value: true }]),
        },
      });
      const { service } = makeService(admin);
      await expect(service.isEnabled('f1', TENANT)).resolves.toBe(true); // override kazandı
      await expect(service.isEnabled('f2', TENANT)).resolves.toBe(true); // default'a düştü
    });

    it('60sn cache: ardışık okumalar DB`ye tek kez gider', async () => {
      const admin = makeAdmin({
        featureFlagDefinition: { findMany: jest.fn().mockResolvedValue([def('f1')]) },
      });
      const { service } = makeService(admin);
      await service.isEnabled('f1', TENANT);
      await service.isEnabled('f1', TENANT);
      expect(admin.featureFlagDefinition.findMany).toHaveBeenCalledTimes(1);
      expect(admin.featureFlagOverride.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('setOverride', () => {
    it('platform_support → Forbidden (salt-okur)', async () => {
      const { service, admin } = makeService();
      await expect(
        service.setOverride('f1', TENANT, { value: true }, SUPPORT, CTX),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(admin.featureFlagOverride.upsert).not.toHaveBeenCalled();
    });

    it('tanımsız flag → NotFound; global flag → Conflict; olmayan tenant → NotFound', async () => {
      const { service } = makeService();
      await expect(
        service.setOverride('yok', TENANT, { value: true }, OWNER, CTX),
      ).rejects.toBeInstanceOf(NotFoundException);

      const adminGlobal = makeAdmin({
        featureFlagDefinition: {
          findUnique: jest.fn().mockResolvedValue(def('g1', { isGlobal: true })),
        },
      });
      await expect(
        makeService(adminGlobal).service.setOverride('g1', TENANT, { value: true }, OWNER, CTX),
      ).rejects.toBeInstanceOf(ConflictException);

      const adminNoTenant = makeAdmin({
        featureFlagDefinition: { findUnique: jest.fn().mockResolvedValue(def('f1')) },
        tenant: { findUnique: jest.fn().mockResolvedValue(null) },
      });
      await expect(
        makeService(adminNoTenant).service.setOverride('f1', 'yok', { value: true }, OWNER, CTX),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('geçerli set: upsert + audit + tenant cache invalidation (bayat değer dönmez)', async () => {
      const overrideFindMany = jest
        .fn()
        .mockResolvedValueOnce([]) // ilk okuma: override yok
        .mockResolvedValueOnce([{ flagKey: 'f1', value: true }]); // set sonrası
      const admin = makeAdmin({
        featureFlagDefinition: {
          findMany: jest.fn().mockResolvedValue([def('f1')]),
          findUnique: jest.fn().mockResolvedValue(def('f1')),
        },
        featureFlagOverride: {
          findMany: overrideFindMany,
          upsert: jest.fn(async ({ create }) => ({ ...create })),
        },
      });
      const { service, audit } = makeService(admin);

      await expect(service.isEnabled('f1', TENANT)).resolves.toBe(false); // cache primed
      await service.setOverride('f1', TENANT, { value: true }, OWNER, CTX);
      // invalidateTenant çalıştıysa ikinci okuma DB'den taze değeri alır.
      await expect(service.isEnabled('f1', TENANT)).resolves.toBe(true);

      expect(admin.featureFlagOverride.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { flagKey_tenantId: { flagKey: 'f1', tenantId: TENANT } },
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'feature_flag.override.set',
          payload: { key: 'f1', tenantId: TENANT, value: true },
        }),
      );
    });
  });

  describe('clearOverride', () => {
    it('override yoksa → NotFound, delete çağrılmaz', async () => {
      const { service, admin } = makeService();
      await expect(service.clearOverride('f1', TENANT, OWNER, CTX)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(admin.featureFlagOverride.delete).not.toHaveBeenCalled();
    });

    it('geçerli clear: override silinir + flag default`ına düşer + audit', async () => {
      const overrideFindMany = jest
        .fn()
        .mockResolvedValueOnce([{ flagKey: 'f1', value: true }]) // clear öncesi
        .mockResolvedValueOnce([]); // clear sonrası
      const admin = makeAdmin({
        featureFlagDefinition: {
          findMany: jest.fn().mockResolvedValue([def('f1', { defaultValue: false })]),
        },
        featureFlagOverride: {
          findMany: overrideFindMany,
          findUnique: jest.fn().mockResolvedValue({ flagKey: 'f1', tenantId: TENANT }),
          delete: jest.fn().mockResolvedValue({}),
        },
      });
      const { service, audit } = makeService(admin);

      await expect(service.isEnabled('f1', TENANT)).resolves.toBe(true); // override aktif
      await service.clearOverride('f1', TENANT, OWNER, CTX);
      await expect(service.isEnabled('f1', TENANT)).resolves.toBe(false); // default'a düştü

      expect(admin.featureFlagOverride.delete).toHaveBeenCalledWith({
        where: { flagKey_tenantId: { flagKey: 'f1', tenantId: TENANT } },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'feature_flag.override.clear' }),
      );
    });
  });

  describe('createDefinition', () => {
    it('aynı key ikinci kez (P2002) → Conflict', async () => {
      const admin = makeAdmin({
        featureFlagDefinition: {
          create: jest.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' })),
        },
      });
      const { service } = makeService(admin);
      await expect(
        service.createDefinition({ key: 'f1', name: 'F1' } as never, OWNER, CTX),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
