import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

// bcrypt native modül → spyOn (Cannot redefine) yerine modül mock'u.
jest.mock('bcrypt', () => ({ compare: jest.fn(), hash: jest.fn() }));
import { TenantContextService } from '../tenant/tenant-context.service';
import { PharmacyRetailService } from './pharmacy-retail.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PRODUCT = '22222222-2222-2222-2222-222222222222';
const BATCH = '33333333-3333-3333-3333-333333333333';
const SALE = '44444444-4444-4444-4444-444444444444';
const CASH = '55555555-5555-5555-5555-555555555555';
const RX_PRODUCT = '66666666-6666-6666-6666-666666666666';
const RX_ID = '77777777-7777-7777-7777-777777777777';
const ACTOR = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', roles: ['eczane'] };

describe('PharmacyRetailService', () => {
  let service: PharmacyRetailService;
  let scoped: Record<string, Record<string, jest.Mock>>;

  beforeEach(async () => {
    scoped = {
      pharmacyProduct: {
        findFirst: jest.fn().mockResolvedValue({ id: PRODUCT }),
        // #711 — varsayılan: reçetesiz ürünler (requiresPrescription=false).
        findMany: jest.fn().mockResolvedValue([{ id: PRODUCT, requiresPrescription: false }]),
      },
      prescription: {
        findFirst: jest.fn().mockResolvedValue({ id: RX_ID }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(async ({ data }) => ({ id: RX_ID, ...data })),
      },
      pharmacyBatch: {
        findFirst: jest.fn().mockResolvedValue({ id: BATCH, productId: PRODUCT, availableQty: 10 }),
        // #1063 — satış ön-kontrolü artık tek findMany (kalem başına findFirst değil).
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: BATCH, productId: PRODUCT, availableQty: 10 }]),
        update: jest.fn().mockResolvedValue({}),
        // #711 — koşullu decrement; varsayılan: stok yeterli (1 satır güncellendi).
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pharmacySale: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(async ({ data }) => ({ id: SALE, ...data })),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([{ totalAmount: 80 }, { totalAmount: 40 }]),
      },
      pharmacyReturn: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(async ({ data }) => ({ id: 'ret-1', ...data })),
        findMany: jest.fn().mockResolvedValue([{ totalAmount: 20 }]),
      },
      pharmacyCashClosure: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }) => ({ id: CASH, ...data })),
        update: jest.fn(async ({ data }) => ({ id: CASH, ...data })),
      },
      pharmacyStockMovement: { create: jest.fn().mockResolvedValue({}) },
      // Karar 9 — POS >%10 indirim süpervizör override doğrulaması.
      user: { findFirst: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PharmacyRetailService,
        { provide: PrismaService, useValue: { scoped } },
        { provide: TenantContextService, useValue: { requireTenantId: () => TENANT_ID } },
      ],
    }).compile();
    service = moduleRef.get(PharmacyRetailService);
  });

  it('createSale: batch stoğunu düşürür + hareket kaydeder + toplam', async () => {
    const sale = await service.createSale(
      {
        items: [
          { productId: PRODUCT, batchId: BATCH, itemName: 'Aspirin', quantity: 2, unitPrice: 50 },
        ],
        isAnonymous: true,
        discount: 0,
        currency: 'TJS',
        paymentMethod: 'cash',
      },
      ACTOR,
    );
    expect(scoped.pharmacySale.create.mock.calls[0][0].data.totalAmount).toBe(100);
    expect(scoped.pharmacySale.create.mock.calls[0][0].data.saleNo).toMatch(/^S-\d{4}-00001$/);
    // #711 (B) — koşullu decrement + version artışı + availableQty>=qty guard'ı.
    expect(scoped.pharmacyBatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: BATCH, availableQty: { gte: 2 } }),
        data: { availableQty: { decrement: 2 }, version: { increment: 1 } },
      }),
    );
    expect(scoped.pharmacyStockMovement.create).toHaveBeenCalled();
    expect(sale.id).toBe(SALE);
  });

  describe('createSale — Karar 9 indirim cap + süpervizör override', () => {
    // subtotal = 2 × 50 = 100; discount mutlak tutar → %.
    const sale = (discount: number, supervisorOverride?: { email: string; password: string }) => ({
      items: [
        { productId: PRODUCT, batchId: BATCH, itemName: 'Aspirin', quantity: 2, unitPrice: 50 },
      ],
      isAnonymous: true,
      discount,
      currency: 'TJS' as const,
      paymentMethod: 'cash' as const,
      supervisorOverride,
    });

    it('%10 (eşit) indirim override istemez', async () => {
      const out = await service.createSale(sale(10), ACTOR);
      expect(out.id).toBe(SALE);
      expect(scoped.user.findFirst).not.toHaveBeenCalled();
    });

    it('>%10 + override yok → 403', async () => {
      await expect(service.createSale(sale(20), ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('>%10 + geçerli süpervizör (yönetici) → satış geçer', async () => {
      scoped.user.findFirst.mockResolvedValue({
        passwordHash: 'hash',
        userRoles: [{ role: { key: 'yonetici' } }],
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      const out = await service.createSale(sale(20, { email: 'm@a.tj', password: 'pw' }), ACTOR);
      expect(out.id).toBe(SALE);
    });

    it('>%10 + yanlış şifre → 403', async () => {
      scoped.user.findFirst.mockResolvedValue({
        passwordHash: 'hash',
        userRoles: [{ role: { key: 'yonetici' } }],
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(
        service.createSale(sale(20, { email: 'm@a.tj', password: 'wrong' }), ACTOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('>%10 + yetkisiz rol (eczane) → 403', async () => {
      scoped.user.findFirst.mockResolvedValue({
        passwordHash: 'hash',
        userRoles: [{ role: { key: 'eczane' } }],
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      await expect(
        service.createSale(sale(20, { email: 'e@a.tj', password: 'pw' }), ACTOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('createSale: yetersiz stok ön-kontrolde → 400', async () => {
    scoped.pharmacyBatch.findMany.mockResolvedValue([
      { id: BATCH, productId: PRODUCT, availableQty: 1 },
    ]);
    await expect(
      service.createSale(
        {
          items: [
            { productId: PRODUCT, batchId: BATCH, itemName: 'X', quantity: 5, unitPrice: 10 },
          ],
          isAnonymous: true,
          discount: 0,
          currency: 'TJS',
          paymentMethod: 'cash',
        },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(scoped.pharmacyBatch.updateMany).not.toHaveBeenCalled();
  });

  // #711 (B) — oversell yarışı: ön-kontrol geçti ama koşullu decrement 0 satır
  // güncelledi (stok eşzamanlı tükendi) → 409 (transaction rollback satışı geri alır).
  it('createSale: koşullu decrement 0 satır → 409 (oversell guard)', async () => {
    scoped.pharmacyBatch.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.createSale(
        {
          items: [
            { productId: PRODUCT, batchId: BATCH, itemName: 'Aspirin', quantity: 2, unitPrice: 50 },
          ],
          isAnonymous: true,
          discount: 0,
          currency: 'TJS',
          paymentMethod: 'cash',
        },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // #711 (A) — reçeteli ürün anonim/reçetesiz satılamaz.
  it('createSale: reçeteli ürün anonim satışta → 400', async () => {
    scoped.pharmacyProduct.findMany.mockResolvedValue([
      { id: RX_PRODUCT, requiresPrescription: true },
    ]);
    await expect(
      service.createSale(
        {
          items: [
            {
              productId: RX_PRODUCT,
              batchId: BATCH,
              itemName: 'Antibiyotik',
              quantity: 1,
              unitPrice: 30,
            },
          ],
          isAnonymous: true,
          discount: 0,
          currency: 'TJS',
          paymentMethod: 'cash',
        },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(scoped.pharmacySale.create).not.toHaveBeenCalled();
  });

  // #711 (A) — reçeteli ürün geçerli reçete + isAnonymous=false ile satılır.
  it('createSale: reçeteli ürün geçerli reçete ile satılır', async () => {
    scoped.pharmacyProduct.findMany.mockResolvedValue([
      { id: RX_PRODUCT, requiresPrescription: true },
    ]);
    const sale = await service.createSale(
      {
        items: [
          {
            productId: RX_PRODUCT,
            batchId: BATCH,
            itemName: 'Antibiyotik',
            quantity: 1,
            unitPrice: 30,
          },
        ],
        isAnonymous: false,
        prescriptionId: RX_ID,
        discount: 0,
        currency: 'TJS',
        paymentMethod: 'cash',
      },
      ACTOR,
    );
    expect(scoped.prescription.findFirst).toHaveBeenCalled();
    expect(sale.id).toBe(SALE);
  });

  it('createReturn: stoğu geri ekler', async () => {
    scoped.pharmacySale.findFirst.mockResolvedValue({
      id: SALE,
      status: 'completed',
      currency: 'TJS',
      items: [
        {
          id: 'si-1',
          productId: PRODUCT,
          batchId: BATCH,
          itemName: 'X',
          quantity: 3,
          unitPrice: 50,
        },
      ],
    });
    await service.createReturn(
      { saleId: SALE, items: [{ saleItemId: 'si-1', quantity: 2 }] },
      ACTOR,
    );
    expect(scoped.pharmacyReturn.create.mock.calls[0][0].data.totalAmount).toBe(100);
    expect(scoped.pharmacyBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { availableQty: { increment: 2 } } }),
    );
  });

  it('closeCash: beklenen + sapma hesaplar', async () => {
    scoped.pharmacyCashClosure.findFirst.mockResolvedValue({
      id: CASH,
      status: 'open',
      openingFloat: 100,
    });
    await service.closeCash({ id: CASH, countedAmount: 195 }, ACTOR);
    const data = scoped.pharmacyCashClosure.update.mock.calls[0][0].data;
    // beklenen = 100 (açılış) + 120 (satış) - 20 (iade) = 200; sapma = 195 - 200 = -5
    expect(data.salesTotal).toBe(120);
    expect(data.refundTotal).toBe(20);
    expect(data.expectedAmount).toBe(200);
    expect(data.variance).toBe(-5);
    expect(data.status).toBe('closed');
  });

  // #664 — 2-aşama kasa devri: finans mutabakatı + görev ayrılığı.
  it('reconcileCash: handed_to_finance + farklı finans yetkilisi → reconciledAt/ById set', async () => {
    scoped.pharmacyCashClosure.findFirst.mockResolvedValue({
      id: CASH,
      status: 'handed_to_finance',
      handedToFinanceById: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      reconciledAt: null,
    });
    await service.reconcileCash(CASH, ACTOR);
    const data = scoped.pharmacyCashClosure.update.mock.calls[0][0].data;
    expect(data.reconciledById).toBe(ACTOR.id);
    expect(data.reconciledAt).toBeInstanceOf(Date);
  });

  it('reconcileCash: teslim eden kişi mutabakatı yapamaz (görev ayrılığı → 403)', async () => {
    scoped.pharmacyCashClosure.findFirst.mockResolvedValue({
      id: CASH,
      status: 'handed_to_finance',
      handedToFinanceById: ACTOR.id, // teslim eden == mutabakat eden
      reconciledAt: null,
    });
    await expect(service.reconcileCash(CASH, ACTOR)).rejects.toThrow(/Görev ayrılığı/);
    expect(scoped.pharmacyCashClosure.update).not.toHaveBeenCalled();
  });

  it('reconcileCash: finansa teslim edilmemiş kasa mutabık edilemez (409)', async () => {
    scoped.pharmacyCashClosure.findFirst.mockResolvedValue({
      id: CASH,
      status: 'closed',
      handedToFinanceById: null,
      reconciledAt: null,
    });
    await expect(service.reconcileCash(CASH, ACTOR)).rejects.toThrow(/teslim edilmiş/);
    expect(scoped.pharmacyCashClosure.update).not.toHaveBeenCalled();
  });

  // #790 — reçete dispense durumu (kısmi/tam)
  describe('markPrescriptionDispense', () => {
    it('pending → dispensed işaretler', async () => {
      scoped.prescription.findFirst.mockResolvedValue({ id: RX_ID, dispenseStatus: 'pending' });
      const res = await service.markPrescriptionDispense(RX_ID, 'dispensed');
      expect(res.dispenseStatus).toBe('dispensed');
      expect(scoped.prescription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { dispenseStatus: 'dispensed' } }),
      );
    });

    it('partial → dispensed yükseltilebilir', async () => {
      scoped.prescription.findFirst.mockResolvedValue({ id: RX_ID, dispenseStatus: 'partial' });
      const res = await service.markPrescriptionDispense(RX_ID, 'dispensed');
      expect(res.dispenseStatus).toBe('dispensed');
    });

    it('zaten dispensed ise 400', async () => {
      scoped.prescription.findFirst.mockResolvedValue({ id: RX_ID, dispenseStatus: 'dispensed' });
      await expect(service.markPrescriptionDispense(RX_ID, 'dispensed')).rejects.toThrow(
        /zaten tamamen/,
      );
      expect(scoped.prescription.update).not.toHaveBeenCalled();
    });

    it('reçete yoksa 404', async () => {
      scoped.prescription.findFirst.mockResolvedValue(null);
      await expect(service.markPrescriptionDispense(RX_ID, 'partial')).rejects.toThrow(
        /bulunamadı/,
      );
    });
  });
});
