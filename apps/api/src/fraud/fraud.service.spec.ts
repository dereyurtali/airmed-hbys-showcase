import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AdminPrismaService } from '../prisma/admin-prisma.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantContextService } from '../tenant/tenant-context.service';
import { FraudDetectionService } from './fraud.service';

// #938 — FraudDetectionService unit testi. Kilitlenen davranışlar: admin-yetki
// kapısı, listAlerts filtre şekli, default kural upsert'i, detector tetiklenme /
// tetiklenmeme yolları, P2002 dedup ve tek kural hatasının taramayı durdurmaması.
// AdminPrismaService #1065 sonrası constructor'a inject edilir — elle mock.

const TENANT = '11111111-1111-1111-1111-111111111111';
const MANAGER = { id: 'mgr', roles: ['yonetici'] as const };
const NURSE = { id: 'nrs', roles: ['hemsire'] as const };

type ModelMocks = Record<string, jest.Mock>;

interface AdminMock {
  fraudRule: ModelMocks;
  fraudAlert: ModelMocks;
  iolStockMovement: ModelMocks;
  $queryRaw: jest.Mock;
}

function makeService(opts: { scoped?: Record<string, ModelMocks>; admin?: AdminMock } = {}) {
  const scoped = opts.scoped ?? {};
  const admin = opts.admin ?? {};
  const prisma = { scoped } as unknown as PrismaService;
  const tenantContext = { requireTenantId: () => TENANT } as unknown as TenantContextService;
  return new FraudDetectionService(prisma, tenantContext, admin as unknown as AdminPrismaService);
}

// scanTenant için default admin mock: 4 default kural upsert edilir, aktif kural
// listesi ve detector sorguları teste göre override edilir.
function adminForScan(over: Partial<AdminMock> = {}): AdminMock {
  return {
    fraudRule: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      ...(over.fraudRule ?? {}),
    },
    fraudAlert: {
      create: jest.fn().mockResolvedValue({}),
      ...(over.fraudAlert ?? {}),
    },
    iolStockMovement: {
      findMany: jest.fn().mockResolvedValue([]),
      ...(over.iolStockMovement ?? {}),
    },
    $queryRaw: over.$queryRaw ?? jest.fn().mockResolvedValue([]),
  };
}

describe('FraudDetectionService (#938)', () => {
  it('listAlerts: yonetici/yonetici_asistani dışındaki rol → Forbidden', async () => {
    const findMany = jest.fn();
    const service = makeService({ scoped: { fraudAlert: { findMany } } });
    await expect(service.listAlerts({ limit: 50 } as never, NURSE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it('listAlerts: status/severity/ruleKey filtreleri where`e geçer, limit take olur', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = makeService({ scoped: { fraudAlert: { findMany } } });
    await service.listAlerts(
      { status: 'open', severity: 'high', ruleKey: 'multi_ip_login', limit: 25 } as never,
      MANAGER,
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'open', severity: 'high', ruleKey: 'multi_ip_login' },
        take: 25,
      }),
    );
  });

  it('updateAlertStatus: alert yoksa → NotFound, update çağrılmaz', async () => {
    const update = jest.fn();
    const service = makeService({
      scoped: { fraudAlert: { findFirst: jest.fn().mockResolvedValue(null), update } },
    });
    await expect(
      service.updateAlertStatus({ id: 'a1', status: 'reviewed' } as never, MANAGER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });

  it('updateAlertStatus: inceleyen kişi + zaman damgası kaydedilir', async () => {
    const update = jest.fn().mockResolvedValue({});
    const service = makeService({
      scoped: {
        fraudAlert: {
          findFirst: jest.fn().mockResolvedValue({ id: 'a1', reviewNote: 'eski' }),
          update,
        },
      },
    });
    await service.updateAlertStatus({ id: 'a1', status: 'dismissed' } as never, MANAGER);
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('dismissed');
    expect(data.reviewedById).toBe('mgr');
    expect(data.reviewedAt).toBeInstanceOf(Date);
    // reviewNote gönderilmediyse mevcut not korunur.
    expect(data.reviewNote).toBe('eski');
  });

  it('scanTenant: 4 default kural upsert edilir (mevcutlar update:{} ile korunur)', async () => {
    const admin = adminForScan();
    const service = makeService({ admin });
    const result = await service.scanTenant(TENANT);
    expect(result).toEqual({ created: 0 });
    expect(admin.fraudRule.upsert).toHaveBeenCalledTimes(4);
    const keys = admin.fraudRule.upsert.mock.calls.map((c) => c[0].create.key).sort();
    expect(keys).toEqual([
      'frequent_patient_appointment',
      'multi_ip_login',
      'night_operations',
      'stock_consume_without_surgery',
    ]);
    // update:{} → admin override'ları ezilmez.
    expect(admin.fraudRule.upsert.mock.calls[0][0].update).toEqual({});
  });

  it('stok kuralı: cerrahisiz consume hareketi alert üretir, temiz tenant üretmez', async () => {
    const stockRule = {
      id: 'r-stock',
      key: 'stock_consume_without_surgery',
      severity: 'high',
      config: { windowHours: 24 },
    };
    const admin = adminForScan({
      fraudRule: {
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([stockRule]),
      },
      iolStockMovement: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'm1', lotId: 'l1', quantity: 1, createdById: 'u1', createdAt: new Date() },
          ]),
      },
    });
    const service = makeService({ admin });
    const result = await service.scanTenant(TENANT);
    expect(result).toEqual({ created: 1 });
    const alertData = admin.fraudAlert.create.mock.calls[0][0].data;
    expect(alertData.ruleKey).toBe('stock_consume_without_surgery');
    expect(alertData.severity).toBe('high');
    expect(alertData.signatureKey).toBe('stock_no_surgery:m1');
    expect(alertData.actorUserId).toBe('u1');

    // Tetiklenmeyen yol: hareket yoksa alert oluşmaz.
    admin.fraudAlert.create.mockClear();
    admin.iolStockMovement.findMany.mockResolvedValue([]);
    await expect(service.scanTenant(TENANT)).resolves.toEqual({ created: 0 });
    expect(admin.fraudAlert.create).not.toHaveBeenCalled();
  });

  it('P2002 (aynı signatureKey) → dedup: sayılmaz ve hata fırlatılmaz', async () => {
    const stockRule = {
      id: 'r-stock',
      key: 'stock_consume_without_surgery',
      severity: 'high',
      config: {},
    };
    const create = jest
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    const admin = adminForScan({
      fraudRule: {
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([stockRule]),
      },
      fraudAlert: { create },
      iolStockMovement: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'm1', lotId: 'l1', quantity: 1, createdById: 'u1', createdAt: new Date() },
          { id: 'm2', lotId: 'l1', quantity: 1, createdById: 'u1', createdAt: new Date() },
        ]),
      },
    });
    const service = makeService({ admin });
    await expect(service.scanTenant(TENANT)).resolves.toEqual({ created: 1 });
  });

  it('bir kuralın sorgusu patlarsa tarama durmaz — kalan kurallar çalışır', async () => {
    const rules = [
      { id: 'r-stock', key: 'stock_consume_without_surgery', severity: 'high', config: {} },
      { id: 'r-freq', key: 'frequent_patient_appointment', severity: 'medium', config: {} },
    ];
    const admin = adminForScan({
      fraudRule: {
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue(rules),
      },
      iolStockMovement: { findMany: jest.fn().mockRejectedValue(new Error('db down')) },
      // frequent_patient_appointment $queryRaw ile çalışır → 1 eşleşme.
      $queryRaw: jest.fn().mockResolvedValue([{ patient_id: 'p1', cnt: BigInt(7) }]),
    });
    const service = makeService({ admin });
    const result = await service.scanTenant(TENANT);
    expect(result).toEqual({ created: 1 });
    const alertData = admin.fraudAlert.create.mock.calls[0][0].data;
    expect(alertData.ruleKey).toBe('frequent_patient_appointment');
    expect(alertData.entityId).toBe('p1');
    expect(alertData.details.appointmentCount).toBe(7);
  });

  it('scanNow: tenant context`ten tenantId alır ve admin client ile tarar', async () => {
    const admin = adminForScan();
    const service = makeService({ admin });
    await service.scanNow(MANAGER);
    // ensureDefaultRulesWithAdmin çağrısı context tenant'ı ile yapılır.
    expect(admin.fraudRule.upsert.mock.calls[0][0].where.tenantId_key.tenantId).toBe(TENANT);
  });

  it('scanNow: yetkisiz rol → Forbidden, tarama başlamaz', async () => {
    const admin = adminForScan();
    const service = makeService({ admin });
    await expect(service.scanNow(NURSE)).rejects.toBeInstanceOf(ForbiddenException);
    expect(admin.fraudRule.upsert).not.toHaveBeenCalled();
  });
});
