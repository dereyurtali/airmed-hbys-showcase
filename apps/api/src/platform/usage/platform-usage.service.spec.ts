import type { AdminPrismaService } from '../../prisma/admin-prisma.service';
import { PlatformUsageService } from './platform-usage.service';

// #1088 — kullanım servisi davranış kilidi (#938). groupBy tek-sorgu pattern.

describe('PlatformUsageService (#1088)', () => {
  it('tenants: groupBy sonuçlarını tenant satırlarında birleştirir', async () => {
    const admin = {
      tenant: {
        findMany: jest.fn().mockResolvedValue([
          { id: 't1', name: 'A', slug: 'a', status: 'active', createdAt: new Date('2026-01-01') },
          { id: 't2', name: 'B', slug: 'b', status: 'trial', createdAt: new Date('2026-02-01') },
        ]),
      },
      user: { groupBy: jest.fn().mockResolvedValue([{ tenantId: 't1', _count: { _all: 4 } }]) },
      patient: {
        groupBy: jest.fn().mockResolvedValue([{ tenantId: 't1', _count: { _all: 50 } }]),
      },
      appointment: {
        groupBy: jest.fn().mockResolvedValue([{ tenantId: 't1', _count: { _all: 30 } }]),
      },
      invoice: { groupBy: jest.fn().mockResolvedValue([{ tenantId: 't1', _count: { _all: 20 } }]) },
      agentConversation: {
        groupBy: jest.fn().mockResolvedValue([{ tenantId: 't2', _count: { _all: 7 } }]),
      },
    } as unknown as AdminPrismaService;
    const svc = new PlatformUsageService(admin);
    const rows = await svc.tenants();
    const t1 = rows.find((r) => r.id === 't1')!;
    expect(t1.users).toBe(4);
    expect(t1.patients).toBe(50);
    expect(t1.appointments30d).toBe(30);
    expect(t1.invoices30d).toBe(20);
    expect(t1.dbShareRows).toBe(100); // 50 + 30 + 20
    const t2 = rows.find((r) => r.id === 't2')!;
    expect(t2.users).toBe(0);
    expect(t2.aiConversations30d).toBe(7);
  });

  it('summary: 4 sayacı paralel', async () => {
    const admin = {
      tenant: { count: jest.fn().mockResolvedValue(3) },
      user: { count: jest.fn().mockResolvedValue(40) },
      appointment: { count: jest.fn().mockResolvedValue(120) },
      patient: { count: jest.fn().mockResolvedValue(15) },
    } as unknown as AdminPrismaService;
    const svc = new PlatformUsageService(admin);
    const s = await svc.summary();
    expect(s).toEqual({
      activeTenants: 3,
      activeUsers: 40,
      appointments30d: 120,
      newPatients30d: 15,
    });
  });

  it('trend: haftalık bucket sayısı = weeks', async () => {
    const admin = {
      patient: { findMany: jest.fn().mockResolvedValue([]) },
      appointment: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as AdminPrismaService;
    const svc = new PlatformUsageService(admin);
    const rows = await svc.trend(12);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toHaveProperty('weekStart');
    expect(rows[0].newPatients).toBe(0);
  });
});
