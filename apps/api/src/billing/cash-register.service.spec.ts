import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { CashRegisterService } from './cash-register.service';

// R5 (#727) — Kasa kapatma 2-aşama draft testi. prepareDraft (asistan) payment
// bağlamaz + tek açık taslak; finalizeDraft (yönetici) recompute + bağla +
// finalized; discardDraft satırı siler.

const ASSISTANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MANAGER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DRAFT_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

function payment(id: string) {
  return {
    id,
    amount: new Prisma.Decimal('100'),
    currency: 'TJS' as const,
    tjsEquivalent: new Prisma.Decimal('100'),
    method: 'cash' as const,
  };
}

describe('CashRegisterService — draft 2-aşama', () => {
  let service: CashRegisterService;
  let scoped: {
    cashRegisterClosure: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    payment: { findMany: jest.Mock; updateMany: jest.Mock };
    refund: { findMany: jest.Mock; updateMany: jest.Mock };
  };

  beforeEach(async () => {
    scoped = {
      cashRegisterClosure: {
        findFirst: jest.fn(),
        create: jest.fn(async ({ data }) => ({ id: DRAFT_ID, ...data })),
        update: jest.fn(async ({ data }) => ({ id: DRAFT_ID, ...data })),
        delete: jest.fn(async () => ({})),
      },
      payment: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
      refund: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CashRegisterService,
        { provide: PrismaService, useValue: { scoped } },
        { provide: TenantContextService, useValue: { requireTenantId: () => 't1' } },
      ],
    }).compile();
    service = moduleRef.get(CashRegisterService);
  });

  describe('prepareDraft', () => {
    it('açık tahsilatlardan draft oluşturur ama payment BAĞLAMAZ', async () => {
      scoped.cashRegisterClosure.findFirst.mockResolvedValue(null);
      scoped.payment.findMany.mockResolvedValue([payment('p1')]);

      const res = await service.prepareDraft({ notes: 'sayım' }, { id: ASSISTANT });

      expect(res.status).toBe('draft');
      expect(scoped.cashRegisterClosure.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'draft', preparedById: ASSISTANT }),
        }),
      );
      expect(scoped.payment.updateMany).not.toHaveBeenCalled();
    });

    it('zaten açık taslak varsa 409', async () => {
      scoped.cashRegisterClosure.findFirst.mockResolvedValue({ id: 'x', status: 'draft' });
      await expect(service.prepareDraft({ notes: null }, { id: ASSISTANT })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('açık tahsilat yoksa 409', async () => {
      scoped.cashRegisterClosure.findFirst.mockResolvedValue(null);
      await expect(service.prepareDraft({ notes: null }, { id: ASSISTANT })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('finalizeDraft', () => {
    it('recompute + payment bağlar + finalized (closedBy=yönetici)', async () => {
      scoped.cashRegisterClosure.findFirst.mockResolvedValue({ id: DRAFT_ID, status: 'draft' });
      scoped.payment.findMany.mockResolvedValue([payment('p1'), payment('p2')]);

      await service.finalizeDraft(DRAFT_ID, { id: MANAGER });

      expect(scoped.cashRegisterClosure.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: DRAFT_ID },
          data: expect.objectContaining({ status: 'finalized', closedById: MANAGER }),
        }),
      );
      expect(scoped.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { cashRegisterClosureId: DRAFT_ID } }),
      );
    });

    it('taslak yoksa 404', async () => {
      scoped.cashRegisterClosure.findFirst.mockResolvedValue(null);
      await expect(service.finalizeDraft(DRAFT_ID, { id: MANAGER })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('finalize anında açık tahsilat yoksa 409', async () => {
      scoped.cashRegisterClosure.findFirst.mockResolvedValue({ id: DRAFT_ID, status: 'draft' });
      // payment/refund findMany default [] → açık yok
      await expect(service.finalizeDraft(DRAFT_ID, { id: MANAGER })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('discardDraft', () => {
    it('taslağı siler', async () => {
      scoped.cashRegisterClosure.findFirst.mockResolvedValue({ id: DRAFT_ID, status: 'draft' });
      const res = await service.discardDraft(DRAFT_ID);
      expect(res).toEqual({ discarded: true });
      expect(scoped.cashRegisterClosure.delete).toHaveBeenCalledWith({ where: { id: DRAFT_ID } });
    });

    it('taslak yoksa 404', async () => {
      scoped.cashRegisterClosure.findFirst.mockResolvedValue(null);
      await expect(service.discardDraft(DRAFT_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
