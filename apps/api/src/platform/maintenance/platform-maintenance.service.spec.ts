import { BadRequestException } from '@nestjs/common';
import type { AdminPrismaService } from '../../prisma/admin-prisma.service';
import { PlatformMaintenanceService } from './platform-maintenance.service';

// #1093 — bakım + duyuru servisi davranış kilidi (#938).

describe('PlatformMaintenanceService (#1093)', () => {
  it('activeMaintenance: global + tenant penceresini OR ile sorgular', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      message: 'Bakım',
      endsAt: new Date('2026-07-04T12:00:00Z'),
    });
    const admin = { maintenanceWindow: { findFirst } } as unknown as AdminPrismaService;
    const svc = new PlatformMaintenanceService(admin);
    const r = await svc.activeMaintenance('t1');
    expect(r?.message).toBe('Bakım');
    const where = findFirst.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ scope: 'global' });
    expect(where.OR).toContainEqual({ scope: 'tenant', targetTenantId: 't1' });
  });

  it('activeMaintenance: tenantId null → yalnız global', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const admin = { maintenanceWindow: { findFirst } } as unknown as AdminPrismaService;
    const svc = new PlatformMaintenanceService(admin);
    await svc.activeMaintenance(null);
    expect(findFirst.mock.calls[0][0].where.OR).toEqual([{ scope: 'global' }]);
  });

  it('activeAnnouncements: warning severity dismiss-siz', async () => {
    const admin = {
      platformAnnouncement: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'a1', title: 'T', body: 'B', severity: 'warning' },
          { id: 'a2', title: 'T2', body: 'B2', severity: 'info' },
        ]),
      },
    } as unknown as AdminPrismaService;
    const svc = new PlatformMaintenanceService(admin);
    const rows = await svc.activeAnnouncements('t1');
    expect(rows.find((r) => r.id === 'a1')!.dismissible).toBe(false);
    expect(rows.find((r) => r.id === 'a2')!.dismissible).toBe(true);
  });

  it('createMaintenance: starts>=ends → 400', async () => {
    const admin = { maintenanceWindow: { create: jest.fn() } } as unknown as AdminPrismaService;
    const svc = new PlatformMaintenanceService(admin);
    await expect(
      svc.createMaintenance({
        scope: 'global',
        message: 'x',
        startsAt: '2026-07-04T12:00:00Z',
        endsAt: '2026-07-04T11:00:00Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createMaintenance: tenant kapsamı targetTenantId zorunlu → 400', async () => {
    const admin = { maintenanceWindow: { create: jest.fn() } } as unknown as AdminPrismaService;
    const svc = new PlatformMaintenanceService(admin);
    await expect(
      svc.createMaintenance({
        scope: 'tenant',
        message: 'x',
        startsAt: '2026-07-04T10:00:00Z',
        endsAt: '2026-07-04T12:00:00Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
