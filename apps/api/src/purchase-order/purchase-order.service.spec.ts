import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { PurchaseOrderService } from './purchase-order.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const SUPPLIER = '22222222-2222-2222-2222-222222222222';
const PO_ID = '33333333-3333-3333-3333-333333333333';
const ITEM_ID = '44444444-4444-4444-4444-444444444444';
const CONSUMABLE = '55555555-5555-5555-5555-555555555555';
const PHARMACY_PRODUCT = '66666666-6666-6666-6666-666666666666';
const BATCH_ID = '77777777-7777-7777-7777-777777777777';
const CREATOR = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const APPROVER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('PurchaseOrderService', () => {
  let service: PurchaseOrderService;
  let scoped: {
    purchaseOrder: {
      count: jest.Mock;
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    purchaseOrderItem: { findMany: jest.Mock; update: jest.Mock };
    supplier: { findFirst: jest.Mock };
    consumable: { updateMany: jest.Mock };
    pharmacyProduct: { findFirst: jest.Mock };
    pharmacyBatch: { create: jest.Mock };
    pharmacyStockMovement: { create: jest.Mock };
  };

  beforeEach(async () => {
    scoped = {
      purchaseOrder: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(async ({ data }) => ({ id: PO_ID, ...data })),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(async ({ data }) => ({ id: PO_ID, ...data })),
      },
      purchaseOrderItem: { findMany: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      supplier: { findFirst: jest.fn().mockResolvedValue({ id: SUPPLIER }) },
      consumable: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      pharmacyProduct: { findFirst: jest.fn().mockResolvedValue({ id: PHARMACY_PRODUCT }) },
      pharmacyBatch: { create: jest.fn(async ({ data }) => ({ id: BATCH_ID, ...data })) },
      pharmacyStockMovement: { create: jest.fn().mockResolvedValue({}) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PurchaseOrderService,
        { provide: PrismaService, useValue: { scoped } },
        { provide: TenantContextService, useValue: { requireTenantId: () => TENANT_ID } },
      ],
    }).compile();
    service = moduleRef.get(PurchaseOrderService);
  });

  const actor = { id: CREATOR, roles: ['stok_satinalma'] };

  it('create: orderNo üretir, toplamı hesaplar, draft açar', async () => {
    await service.create(
      {
        supplierId: SUPPLIER,
        domain: 'clinic',
        currency: 'TJS',
        items: [
          { itemName: 'Keratom', quantity: 2, unitPrice: 50 },
          { itemName: 'BSS', quantity: 1, unitPrice: 30 },
        ],
      },
      actor,
    );
    const data = scoped.purchaseOrder.create.mock.calls[0][0].data;
    expect(data.orderNo).toMatch(/^PO-\d{4}-00001$/);
    expect(data.totalAmount).toBe(130);
    expect(data.status).toBe('draft');
    expect(data.createdById).toBe(CREATOR);
  });

  it('submit: eşik altı → submitted', async () => {
    scoped.purchaseOrder.findFirst.mockResolvedValue({
      id: PO_ID,
      status: 'draft',
      totalAmount: 500,
      approvalThreshold: 10000,
    });
    await service.submit(PO_ID);
    expect(scoped.purchaseOrder.update.mock.calls[0][0].data.status).toBe('submitted');
  });

  it('submit: eşik üstü → pending_approval', async () => {
    scoped.purchaseOrder.findFirst.mockResolvedValue({
      id: PO_ID,
      status: 'draft',
      totalAmount: 25000,
      approvalThreshold: 10000,
    });
    await service.submit(PO_ID);
    expect(scoped.purchaseOrder.update.mock.calls[0][0].data.status).toBe('pending_approval');
  });

  it('approve: görev ayrılığı — oluşturan onaylayamaz', async () => {
    scoped.purchaseOrder.findFirst.mockResolvedValue({
      id: PO_ID,
      status: 'pending_approval',
      createdById: CREATOR,
    });
    await expect(service.approve(PO_ID, { id: CREATOR, roles: ['finans'] })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('approve: başka finans yetkilisi onaylar → approved', async () => {
    scoped.purchaseOrder.findFirst.mockResolvedValue({
      id: PO_ID,
      status: 'pending_approval',
      createdById: CREATOR,
    });
    await service.approve(PO_ID, { id: APPROVER, roles: ['finans'] });
    const data = scoped.purchaseOrder.update.mock.calls[0][0].data;
    expect(data.status).toBe('approved');
    expect(data.approvedById).toBe(APPROVER);
  });

  // #665 — fail-closed: createdById null ise oluşturan doğrulanamaz → onay reddedilir.
  it('approve: createdById null → fail-closed (onaylanamaz)', async () => {
    scoped.purchaseOrder.findFirst.mockResolvedValue({
      id: PO_ID,
      status: 'pending_approval',
      createdById: null,
    });
    await expect(
      service.approve(PO_ID, { id: APPROVER, roles: ['finans'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(scoped.purchaseOrder.update).not.toHaveBeenCalled();
  });

  it('receive: consumable referanslı kalem stoğu arttırır + received', async () => {
    scoped.purchaseOrder.findFirst.mockResolvedValue({ id: PO_ID, status: 'approved' });
    scoped.purchaseOrderItem.findMany.mockResolvedValue([
      { id: ITEM_ID, quantity: 3, referenceType: 'consumable', referenceId: CONSUMABLE },
    ]);
    await service.receive({ id: PO_ID }, actor);
    expect(scoped.consumable.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { availableQty: { increment: 3 } } }),
    );
    expect(scoped.purchaseOrder.update.mock.calls[0][0].data.status).toBe('received');
  });

  // #713 — eczane ürünü mal kabulü: yeni PharmacyBatch (cost=sale=unitPrice) +
  // intake stok hareketi; status → received.
  it('receive: pharmacy_product kalem yeni parti + intake hareketi yaratır', async () => {
    scoped.purchaseOrder.findFirst.mockResolvedValue({
      id: PO_ID,
      status: 'approved',
      currency: 'TJS',
      supplierId: SUPPLIER,
    });
    scoped.purchaseOrderItem.findMany.mockResolvedValue([
      {
        id: ITEM_ID,
        quantity: 5,
        unitPrice: 12,
        referenceType: 'pharmacy_product',
        referenceId: PHARMACY_PRODUCT,
      },
    ]);
    await service.receive({ id: PO_ID }, actor);
    expect(scoped.pharmacyBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: PHARMACY_PRODUCT,
          availableQty: 5,
          costPrice: 12,
          salePrice: 12,
          currency: 'TJS',
          supplierId: SUPPLIER,
        }),
      }),
    );
    expect(scoped.pharmacyStockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'intake',
          quantityDelta: 5,
          referenceType: 'purchase_order',
          referenceId: PO_ID,
          batchId: BATCH_ID,
        }),
      }),
    );
    expect(scoped.purchaseOrder.update.mock.calls[0][0].data.status).toBe('received');
  });

  it('cancel: teslim alınmış sipariş iptal edilemez', async () => {
    scoped.purchaseOrder.findFirst.mockResolvedValue({ id: PO_ID, status: 'received' });
    await expect(service.cancel(PO_ID)).rejects.toBeInstanceOf(BadRequestException);
  });
});
