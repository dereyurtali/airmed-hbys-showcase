import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RefundService } from './refund.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantContextService } from '../tenant/tenant-context.service';
import type { InvoiceService } from './invoice.service';
import type { PaymentService } from './payment.service';

// #938 — RefundService 2-aşamalı iade state machine unit testi. Kritik mali
// invariantlar: refundable-cap, sadece-pending onaylanır/reddedilir, sadece-approved
// 24h içinde reverse edilir, tam-iade Payment.refundedAt set/clear. Prisma.Decimal gerçek.

const D = (n: number | string) => new Prisma.Decimal(n);
const MANAGER = { id: 'mgr', roles: ['yonetici'] as const };
const RECEPTION = { id: 'rec', roles: ['resepsiyon'] as const };

function makeService(scoped: Record<string, unknown>) {
  const prisma = { scoped } as unknown as PrismaService;
  const tenantContext = { requireTenantId: () => 't1' } as unknown as TenantContextService;
  const invoiceService = {
    recomputeStatus: jest.fn().mockResolvedValue(undefined),
  } as unknown as InvoiceService;
  const paymentService = {
    syncCommissionCollection: jest.fn().mockResolvedValue(undefined),
  } as unknown as PaymentService;
  return {
    service: new RefundService(prisma, tenantContext, invoiceService, paymentService),
    invoiceService,
    paymentService,
  };
}

function payment(
  over: Partial<{ amount: Prisma.Decimal; currency: string; refunds: unknown[] }> = {},
) {
  return {
    id: 'pay1',
    amount: over.amount ?? D(100),
    currency: over.currency ?? 'TJS',
    exchangeRate: D(1),
    invoice: { id: 'inv1', deletedAt: null, surgeryId: null, procedureId: null },
    refunds: over.refunds ?? [],
  };
}

describe('RefundService (#938)', () => {
  describe('request', () => {
    it('amount <= 0 → BadRequest', async () => {
      const { service } = makeService({
        payment: { findFirst: jest.fn() },
        refund: { create: jest.fn() },
      });
      await expect(
        service.request({ paymentId: 'pay1', amount: '0', reason: 'x' }, RECEPTION),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('payment yoksa → NotFound', async () => {
      const { service } = makeService({
        payment: { findFirst: jest.fn().mockResolvedValue(null) },
        refund: { create: jest.fn() },
      });
      await expect(
        service.request({ paymentId: 'nope', amount: '10', reason: 'x' }, RECEPTION),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('silinmiş invoice → BadRequest', async () => {
      const p = payment();
      p.invoice.deletedAt = new Date() as never;
      const { service } = makeService({
        payment: { findFirst: jest.fn().mockResolvedValue(p) },
        refund: { create: jest.fn() },
      });
      await expect(
        service.request({ paymentId: 'pay1', amount: '10', reason: 'x' }, RECEPTION),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refundable cap aşılırsa → BadRequest (pending+approved rezerve sayılır)', async () => {
      // 100 ödendi, 70 zaten pending/approved → refundable 30; 40 talep → red.
      const p = payment({
        refunds: [
          { id: 'r1', amount: D(50), approvalStatus: 'approved' },
          { id: 'r2', amount: D(20), approvalStatus: 'pending' },
        ],
      });
      const { service } = makeService({
        payment: { findFirst: jest.fn().mockResolvedValue(p) },
        refund: { create: jest.fn() },
      });
      await expect(
        service.request({ paymentId: 'pay1', amount: '40', reason: 'x' }, RECEPTION),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('geçerli talep → pending refund oluşturur (rejected/reversed rezerve saymaz)', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'r-new' });
      // rejected + reversed iadeler refundable'ı DÜŞÜRMEZ → 100 tam iade edilebilir.
      const p = payment({
        refunds: [
          { id: 'r1', amount: D(80), approvalStatus: 'rejected' },
          { id: 'r2', amount: D(80), approvalStatus: 'reversed' },
        ],
      });
      const { service } = makeService({
        payment: { findFirst: jest.fn().mockResolvedValue(p) },
        refund: { create },
      });
      await service.request({ paymentId: 'pay1', amount: '100', reason: 'x' }, RECEPTION);
      expect(create).toHaveBeenCalledTimes(1);
      const data = create.mock.calls[0][0].data;
      expect(data.approvalStatus).toBe('pending');
      expect(data.requestedById).toBe('rec');
    });

    it('yabancı para → tjsEquivalent exchangeRate ile hesaplanır', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'r-new' });
      const p = payment({ currency: 'USD' });
      p.exchangeRate = D('10.5') as never;
      p.amount = D(1000) as never;
      const { service } = makeService({
        payment: { findFirst: jest.fn().mockResolvedValue(p) },
        refund: { create },
      });
      await service.request({ paymentId: 'pay1', amount: '20', reason: 'x' }, RECEPTION);
      const data = create.mock.calls[0][0].data;
      expect(data.currency).toBe('USD');
      expect((data.tjsEquivalent as Prisma.Decimal).toString()).toBe('210'); // 20 * 10.5
    });
  });

  describe('approve', () => {
    it('yönetici değil → Forbidden', async () => {
      const { service } = makeService({ refund: { findFirst: jest.fn() } });
      await expect(service.approve('r1', RECEPTION)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('pending değil → BadRequest', async () => {
      const { service } = makeService({
        refund: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'r1',
            approvalStatus: 'approved',
            payment: { id: 'pay1', amount: D(100), refunds: [], invoice: { id: 'inv1' } },
          }),
        },
      });
      await expect(service.approve('r1', MANAGER)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('tam iade → approved + Payment.refundedAt set + invoice recompute', async () => {
      const refundUpdate = jest.fn().mockResolvedValue({ id: 'r1' });
      const paymentUpdate = jest.fn().mockResolvedValue({});
      const { service, invoiceService } = makeService({
        refund: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'r1',
            approvalStatus: 'pending',
            payment: {
              id: 'pay1',
              amount: D(100),
              refunds: [{ id: 'r1', amount: D(100), approvalStatus: 'pending' }],
              invoice: { id: 'inv1', surgeryId: null, procedureId: null },
            },
          }),
          update: refundUpdate,
        },
        payment: { update: paymentUpdate },
      });
      await service.approve('r1', MANAGER);
      expect(refundUpdate.mock.calls[0][0].data.approvalStatus).toBe('approved');
      expect(paymentUpdate).toHaveBeenCalledTimes(1); // tam iade → refundedAt set
      expect(invoiceService.recomputeStatus).toHaveBeenCalledWith('inv1');
    });

    it('kısmi iade → Payment.refundedAt SET EDİLMEZ', async () => {
      const paymentUpdate = jest.fn().mockResolvedValue({});
      const { service } = makeService({
        refund: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'r1',
            approvalStatus: 'pending',
            payment: {
              id: 'pay1',
              amount: D(100),
              refunds: [{ id: 'r1', amount: D(30), approvalStatus: 'pending' }],
              invoice: { id: 'inv1', surgeryId: null, procedureId: null },
            },
          }),
          update: jest.fn().mockResolvedValue({ id: 'r1' }),
        },
        payment: { update: paymentUpdate },
      });
      await service.approve('r1', MANAGER);
      expect(paymentUpdate).not.toHaveBeenCalled();
    });

    it('cerrahi faturada komisyon senkronu tetiklenir', async () => {
      const { service, paymentService } = makeService({
        refund: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'r1',
            approvalStatus: 'pending',
            payment: {
              id: 'pay1',
              amount: D(100),
              refunds: [{ id: 'r1', amount: D(100), approvalStatus: 'pending' }],
              invoice: { id: 'inv1', surgeryId: 'surg1', procedureId: null },
            },
          }),
          update: jest.fn().mockResolvedValue({ id: 'r1' }),
        },
        payment: { update: jest.fn().mockResolvedValue({}) },
      });
      await service.approve('r1', MANAGER);
      expect(paymentService.syncCommissionCollection).toHaveBeenCalledWith({
        sourceType: 'surgery',
        sourceId: 'surg1',
      });
    });
  });

  describe('reject', () => {
    it('yönetici değil → Forbidden', async () => {
      const { service } = makeService({ refund: { findFirst: jest.fn() } });
      await expect(
        service.reject({ refundId: 'r1', rejectionReason: 'x' }, RECEPTION),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('pending değil → BadRequest', async () => {
      const { service } = makeService({
        refund: {
          findFirst: jest.fn().mockResolvedValue({ id: 'r1', approvalStatus: 'approved' }),
        },
      });
      await expect(
        service.reject({ refundId: 'r1', rejectionReason: 'x' }, MANAGER),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('reverse', () => {
    it('approved değil → BadRequest', async () => {
      const { service } = makeService({
        refund: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'r1',
            approvalStatus: 'pending',
            approvedAt: null,
            payment: { id: 'pay1', amount: D(100), refunds: [], invoice: { id: 'inv1' } },
          }),
        },
      });
      await expect(service.reverse('r1', MANAGER)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('24h penceresi doldu → BadRequest', async () => {
      const { service } = makeService({
        refund: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'r1',
            approvalStatus: 'approved',
            approvedAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 saat önce
            payment: {
              id: 'pay1',
              amount: D(100),
              refunds: [],
              invoice: { id: 'inv1', surgeryId: null, procedureId: null },
            },
          }),
        },
      });
      await expect(service.reverse('r1', MANAGER)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('geçerli reverse → reversed + kalan approved < amount ise refundedAt temizlenir', async () => {
      const paymentUpdate = jest.fn().mockResolvedValue({});
      const { service } = makeService({
        refund: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'r1',
            approvalStatus: 'approved',
            approvedAt: new Date(Date.now() - 1000), // 1sn önce, pencere içinde
            payment: {
              id: 'pay1',
              amount: D(100),
              refunds: [{ id: 'r1', amount: D(100), approvalStatus: 'approved' }],
              invoice: { id: 'inv1', surgeryId: null, procedureId: null },
            },
          }),
          update: jest.fn().mockResolvedValue({ id: 'r1' }),
        },
        payment: { update: paymentUpdate },
      });
      await service.reverse('r1', MANAGER);
      expect(paymentUpdate).toHaveBeenCalledWith({
        where: { id: 'pay1' },
        data: { refundedAt: null },
      });
    });
  });
});
