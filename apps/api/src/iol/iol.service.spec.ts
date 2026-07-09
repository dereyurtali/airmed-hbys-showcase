import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { IolService } from './iol.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantContextService } from '../tenant/tenant-context.service';
import type { MessagingService } from '../messaging/messaging.service';

// #938 — IolService 3-state stok lifecycle (reserve/release/consume) unit testi.
// Kritik invariantlar: qty>0, yeterli-stok kapıları, version-guarded updateMany
// (count===0 → ConflictException race), her geçişte movement audit satırı.

const ACTOR = { id: 'u1', roles: ['yonetici'] as const };

function makeService(scoped: Record<string, unknown>) {
  const prisma = { scoped } as unknown as PrismaService;
  const tenantContext = { requireTenantId: () => 't1' } as unknown as TenantContextService;
  const messaging = {} as unknown as MessagingService;
  return new IolService(prisma, tenantContext, messaging);
}

// findFirst döner lot + updateMany count + movement.create spy'ı olan mock.
function stockMock(lot: Record<string, unknown> | null, updateCount: number) {
  const updateMany = jest.fn().mockResolvedValue({ count: updateCount });
  const create = jest.fn().mockResolvedValue({});
  return {
    scoped: {
      iolLot: { findFirst: jest.fn().mockResolvedValue(lot), updateMany },
      iolStockMovement: { create },
    },
    updateMany,
    create,
  };
}

describe('IolService — 3-state stok lifecycle (#938)', () => {
  describe('reserve', () => {
    it('qty <= 0 → BadRequest', async () => {
      const m = stockMock({ availableQty: 5, version: 1, tenantId: 't1' }, 1);
      await expect(makeService(m.scoped).reserve('lot1', 0, ACTOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('lot yok → NotFound', async () => {
      const m = stockMock(null, 0);
      await expect(makeService(m.scoped).reserve('lot1', 1, ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('yetersiz available → BadRequest', async () => {
      const m = stockMock({ availableQty: 2, version: 1, tenantId: 't1' }, 1);
      await expect(makeService(m.scoped).reserve('lot1', 3, ACTOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(m.updateMany).not.toHaveBeenCalled();
    });

    it('version race (updateMany count=0) → Conflict', async () => {
      const m = stockMock({ availableQty: 5, version: 1, tenantId: 't1' }, 0);
      await expect(makeService(m.scoped).reserve('lot1', 2, ACTOR)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(m.create).not.toHaveBeenCalled(); // race → movement yazılmaz
    });

    it('başarılı → available↓ reserved↑ version↑ + movement audit', async () => {
      const m = stockMock({ availableQty: 5, version: 3, tenantId: 't1' }, 1);
      await makeService(m.scoped).reserve('lot1', 2, ACTOR);
      const where = m.updateMany.mock.calls[0][0].where;
      const data = m.updateMany.mock.calls[0][0].data;
      expect(where).toMatchObject({ id: 'lot1', version: 3 });
      expect(where.availableQty).toEqual({ gte: 2 }); // conditional guard
      expect(data.availableQty).toEqual({ decrement: 2 });
      expect(data.reservedQty).toEqual({ increment: 2 });
      expect(data.version).toEqual({ increment: 1 });
      expect(m.create).toHaveBeenCalledTimes(1);
      expect(m.create.mock.calls[0][0].data.quantity).toBe(-2);
    });
  });

  describe('release', () => {
    it('yetersiz reserved → BadRequest', async () => {
      const m = stockMock({ reservedQty: 1, version: 1, tenantId: 't1' }, 1);
      await expect(makeService(m.scoped).release('lot1', 2, ACTOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('başarılı → reserved↓ available↑ + movement (+qty)', async () => {
      const m = stockMock({ reservedQty: 4, version: 2, tenantId: 't1' }, 1);
      await makeService(m.scoped).release('lot1', 3, ACTOR);
      const data = m.updateMany.mock.calls[0][0].data;
      expect(data.reservedQty).toEqual({ decrement: 3 });
      expect(data.availableQty).toEqual({ increment: 3 });
      expect(m.create.mock.calls[0][0].data.quantity).toBe(3); // release = +qty
    });
  });

  describe('consume', () => {
    it('yetersiz reserved → BadRequest', async () => {
      const m = stockMock({ reservedQty: 1, version: 1, tenantId: 't1' }, 1);
      await expect(makeService(m.scoped).consume('lot1', 2, 'surg1', ACTOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('version race → Conflict', async () => {
      const m = stockMock({ reservedQty: 5, version: 1, tenantId: 't1' }, 0);
      await expect(makeService(m.scoped).consume('lot1', 2, 'surg1', ACTOR)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('başarılı → reserved↓ consumed↑ quantity↓ + consume movement (surgeryId)', async () => {
      const m = stockMock({ reservedQty: 5, version: 1, tenantId: 't1' }, 1);
      await makeService(m.scoped).consume('lot1', 2, 'surg1', ACTOR);
      const data = m.updateMany.mock.calls[0][0].data;
      expect(data.reservedQty).toEqual({ decrement: 2 });
      expect(data.consumedQty).toEqual({ increment: 2 });
      expect(data.quantity).toEqual({ decrement: 2 }); // legacy quantity de düşer
      const mv = m.create.mock.calls[0][0].data;
      expect(mv.type).toBe('consume');
      expect(mv.surgeryId).toBe('surg1');
      expect(mv.quantity).toBe(-2);
    });
  });
});
