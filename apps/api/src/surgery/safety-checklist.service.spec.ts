import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SafetyChecklistService } from './safety-checklist.service';
import { SAFETY_CHECKLIST_ITEMS, itemMapKey } from './safety-checklist.constants';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantContextService } from '../tenant/tenant-context.service';

// #938 batch 2 — WHO Cerrahi Güvenlik Checklist (S15-P0). Kritik invariantlar:
// geçersiz item red, zorunlu-item eksikse phase tamamlanamaz (400), intra-op kapısı
// (sign_in + time_out complete). Prisma mock'lu.

const VALID_KEY = itemMapKey(SAFETY_CHECKLIST_ITEMS[0]!);
// Tüm katalog item'ları confirmed → herhangi bir phase'in zorunlu alt-kümesi de tam.
const ALL_CONFIRMED = Object.fromEntries(
  SAFETY_CHECKLIST_ITEMS.map((i) => [
    itemMapKey(i),
    { confirmed: true, confirmedBy: 'u1', confirmedAt: '2026-07-03T00:00:00Z', notes: null },
  ]),
);

function makeService(scoped: Record<string, unknown>) {
  const prisma = { scoped } as unknown as PrismaService;
  const tenantContext = { requireTenantId: () => 't1' } as unknown as TenantContextService;
  return new SafetyChecklistService(prisma, tenantContext);
}

const CHECK_ROW = (over: Record<string, unknown> = {}) => ({
  id: 'chk1',
  surgeryId: 'surg1',
  items: {},
  signInCompletedAt: null,
  signInCompletedBy: null,
  timeOutCompletedAt: null,
  timeOutCompletedBy: null,
  signOutCompletedAt: null,
  signOutCompletedBy: null,
  ...over,
});

describe('SafetyChecklistService (#938 batch 2)', () => {
  describe('getOrCreate', () => {
    it('ameliyat yoksa → NotFound', async () => {
      const service = makeService({
        surgery: { findFirst: jest.fn().mockResolvedValue(null) },
        surgicalSafetyCheck: { upsert: jest.fn() },
      });
      await expect(service.getOrCreate('surg1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('confirmItem', () => {
    it('geçersiz item key → BadRequest', async () => {
      const service = makeService({ surgicalSafetyCheck: { upsert: jest.fn() } });
      await expect(
        service.confirmItem(
          { surgeryId: 'surg1', itemKey: 'not_a_real_item', confirmed: true, notes: null },
          'u1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('geçerli item → state confirmed + confirmedBy set', async () => {
      const update = jest.fn().mockResolvedValue(CHECK_ROW());
      const service = makeService({
        surgicalSafetyCheck: {
          upsert: jest.fn().mockResolvedValue(CHECK_ROW()),
          update,
        },
      });
      await service.confirmItem(
        { surgeryId: 'surg1', itemKey: VALID_KEY, confirmed: true, notes: 'ok' },
        'u1',
      );
      const savedItems = update.mock.calls[0][0].data.items as Record<
        string,
        { confirmed: boolean; confirmedBy: string | null }
      >;
      expect(savedItems[VALID_KEY].confirmed).toBe(true);
      expect(savedItems[VALID_KEY].confirmedBy).toBe('u1');
    });
  });

  describe('markPhaseComplete', () => {
    it('zorunlu item eksik (boş) → BadRequest', async () => {
      const service = makeService({
        surgicalSafetyCheck: {
          upsert: jest.fn().mockResolvedValue(CHECK_ROW({ items: {} })),
          update: jest.fn(),
        },
      });
      await expect(
        service.markPhaseComplete({ surgeryId: 'surg1', phase: 'sign_in' }, 'u1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('tüm zorunlu item dolu → phase timestamp set edilir', async () => {
      const update = jest.fn().mockResolvedValue(CHECK_ROW({ items: ALL_CONFIRMED }));
      const service = makeService({
        surgicalSafetyCheck: {
          upsert: jest.fn().mockResolvedValue(CHECK_ROW({ items: ALL_CONFIRMED })),
          update,
        },
      });
      await service.markPhaseComplete({ surgeryId: 'surg1', phase: 'sign_in' }, 'u1');
      const data = update.mock.calls[0][0].data;
      expect(data.signInCompletedBy).toBe('u1');
      expect(data.signInCompletedAt).toBeInstanceOf(Date);
    });
  });

  describe('canStartIntraOp (SurgeryDay kapı kuralı)', () => {
    it('check yok → false', async () => {
      const service = makeService({
        surgicalSafetyCheck: { findUnique: jest.fn().mockResolvedValue(null) },
      });
      expect(await service.canStartIntraOp('surg1')).toBe(false);
    });

    it('sign_in + time_out complete → true', async () => {
      const service = makeService({
        surgicalSafetyCheck: {
          findUnique: jest
            .fn()
            .mockResolvedValue(
              CHECK_ROW({ signInCompletedAt: new Date(), timeOutCompletedAt: new Date() }),
            ),
        },
      });
      expect(await service.canStartIntraOp('surg1')).toBe(true);
    });

    it('yalnız sign_in complete → false (time_out eksik)', async () => {
      const service = makeService({
        surgicalSafetyCheck: {
          findUnique: jest.fn().mockResolvedValue(CHECK_ROW({ signInCompletedAt: new Date() })),
        },
      });
      expect(await service.canStartIntraOp('surg1')).toBe(false);
    });
  });
});
