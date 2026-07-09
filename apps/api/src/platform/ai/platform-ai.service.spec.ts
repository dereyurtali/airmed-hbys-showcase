import type { AdminPrismaService } from '../../prisma/admin-prisma.service';
import { PlatformAiService } from './platform-ai.service';

// #1089 — AI rollup servisi davranış kilidi (#938).

describe('PlatformAiService (#1089)', () => {
  it('summary: handoff oranı + token toplamı', async () => {
    const admin = {
      agentConfig: { count: jest.fn().mockResolvedValue(2) },
      agentConversation: { count: jest.fn().mockResolvedValue(100) },
      agentMessage: {
        count: jest.fn().mockResolvedValue(500),
        aggregate: jest.fn().mockResolvedValue({ _sum: { inputTokens: 1000, outputTokens: 400 } }),
      },
      agentAction: {
        count: jest
          .fn()
          .mockResolvedValueOnce(20) // handoff
          .mockResolvedValueOnce(5), // error
      },
    } as unknown as AdminPrismaService;
    const svc = new PlatformAiService(admin);
    const s = await svc.summary();
    expect(s.activeTenants).toBe(2);
    expect(s.handoffRate).toBeCloseTo(0.2);
    expect(s.tokens7d).toBe(1400);
    expect(s.errors7d).toBe(5);
  });

  it('summary: sıfır konuşmada handoffRate 0 (bölme hatası yok)', async () => {
    const admin = {
      agentConfig: { count: jest.fn().mockResolvedValue(0) },
      agentConversation: { count: jest.fn().mockResolvedValue(0) },
      agentMessage: {
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { inputTokens: null, outputTokens: null } }),
      },
      agentAction: { count: jest.fn().mockResolvedValue(0) },
    } as unknown as AdminPrismaService;
    const svc = new PlatformAiService(admin);
    const s = await svc.summary();
    expect(s.handoffRate).toBe(0);
    expect(s.tokens7d).toBe(0);
  });

  it('tenants: handoff/error/token groupBy birleştirir', async () => {
    const admin = {
      agentConversation: {
        groupBy: jest.fn().mockResolvedValue([{ tenantId: 't1', _count: { _all: 10 } }]),
      },
      agentAction: {
        groupBy: jest.fn().mockResolvedValue([
          { tenantId: 't1', type: 'handoff', _count: { _all: 3 } },
          { tenantId: 't1', type: 'error', _count: { _all: 1 } },
        ]),
      },
      agentMessage: {
        groupBy: jest
          .fn()
          .mockResolvedValue([{ tenantId: 't1', _sum: { inputTokens: 200, outputTokens: 80 } }]),
      },
    } as unknown as AdminPrismaService;
    const svc = new PlatformAiService(admin);
    const rows = await svc.tenants();
    const t1 = rows.find((r) => r.tenantId === 't1')!;
    expect(t1.conversations7d).toBe(10);
    expect(t1.handoffs7d).toBe(3);
    expect(t1.errors7d).toBe(1);
    expect(t1.inputTokens7d).toBe(200);
  });

  it('recentErrors: yalnız summary metadata döner (mesaj içeriği YOK)', async () => {
    const admin = {
      agentAction: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            {
              id: 'a1',
              tenantId: 't1',
              summary: 'Bot hatası: timeout',
              createdAt: new Date('2026-07-04'),
            },
          ]),
      },
    } as unknown as AdminPrismaService;
    const svc = new PlatformAiService(admin);
    const rows = await svc.recentErrors();
    expect(rows[0].summary).toBe('Bot hatası: timeout');
    expect(Object.keys(rows[0])).toEqual(['id', 'tenantId', 'summary', 'createdAt']);
  });
});
