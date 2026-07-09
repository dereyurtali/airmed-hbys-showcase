import { NotFoundException } from '@nestjs/common';
import type { AdminPrismaService } from '../../prisma/admin-prisma.service';
import { PlatformSyncService } from './platform-sync.service';

// #1091 — senkron izleme servisi davranış kilidi (#938).

describe('PlatformSyncService (#1091)', () => {
  it('summary: 4 sayacı paralel toplar', async () => {
    const admin = {
      syncOutbox: {
        count: jest
          .fn()
          .mockResolvedValueOnce(5)
          .mockResolvedValueOnce(2)
          .mockResolvedValueOnce(100),
      },
      syncConflict: { count: jest.fn().mockResolvedValue(1) },
    } as unknown as AdminPrismaService;
    const svc = new PlatformSyncService(admin);
    const s = await svc.summary();
    expect(s).toEqual({ pendingOutbox: 5, deadLetter: 2, synced24h: 100, openConflicts: 1 });
  });

  it('deadLetter: lastError scrub + 300 char', async () => {
    const admin = {
      syncOutbox: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'o1',
            tenantId: 't1',
            entityType: 'patient',
            operation: 'UPDATE',
            retryCount: 3,
            failedAt: new Date('2026-07-04T00:00:00Z'),
            lastError: 'x'.repeat(400),
          },
        ]),
      },
    } as unknown as AdminPrismaService;
    const svc = new PlatformSyncService(admin);
    const rows = await svc.deadLetter();
    expect(rows[0].retryCount).toBe(3);
    expect((rows[0].lastError ?? '').length).toBeLessThanOrEqual(300);
  });

  it('requeue: bulunamayan satır → NotFound', async () => {
    const admin = {
      syncOutbox: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
    } as unknown as AdminPrismaService;
    const svc = new PlatformSyncService(admin);
    await expect(svc.requeue('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requeue: failedAt/lastError temizler + retryCount sıfırlar', async () => {
    const update = jest.fn().mockResolvedValue({});
    const admin = {
      syncOutbox: { findUnique: jest.fn().mockResolvedValue({ id: 'o1' }), update },
    } as unknown as AdminPrismaService;
    const svc = new PlatformSyncService(admin);
    await svc.requeue('o1');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { failedAt: null, lastError: null, retryCount: 0 },
    });
  });
});
