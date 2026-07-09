import { Injectable } from '@nestjs/common';
import { AdminPrismaService } from '../../prisma/admin-prisma.service';

// #1089 — AI Hasta Asistanı (EPIC #1018) platform-seviyesi rollup. Cross-tenant
// TEK sorgu (#1057). KVKK: hasta mesaj İÇERİĞİ platform panelinde GÖSTERİLMEZ —
// yalnız sayısal metrik + hata metadata'sı (AgentAction.summary, PII'siz).

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AiSummary {
  activeTenants: number;
  conversations7d: number;
  messages7d: number;
  handoffRate: number;
  errors7d: number;
  tokens7d: number;
}
export interface AiTenantRow {
  tenantId: string;
  conversations7d: number;
  handoffs7d: number;
  errors7d: number;
  inputTokens7d: number;
  outputTokens7d: number;
}
export interface AiErrorRow {
  id: string;
  tenantId: string;
  summary: string;
  createdAt: string;
}

@Injectable()
export class PlatformAiService {
  constructor(private readonly admin: AdminPrismaService) {}

  async summary(): Promise<AiSummary> {
    const since = new Date(Date.now() - 7 * DAY_MS);
    const [activeTenants, conversations, messages, handoffs, errors, tokenAgg] = await Promise.all([
      this.admin.agentConfig.count({ where: { enabled: true } }),
      this.admin.agentConversation.count({ where: { createdAt: { gte: since } } }),
      this.admin.agentMessage.count({ where: { createdAt: { gte: since } } }),
      this.admin.agentAction.count({ where: { type: 'handoff', createdAt: { gte: since } } }),
      this.admin.agentAction.count({ where: { type: 'error', createdAt: { gte: since } } }),
      this.admin.agentMessage.aggregate({
        _sum: { inputTokens: true, outputTokens: true },
        where: { createdAt: { gte: since } },
      }),
    ]);
    return {
      activeTenants,
      conversations7d: conversations,
      messages7d: messages,
      handoffRate: conversations > 0 ? handoffs / conversations : 0,
      errors7d: errors,
      tokens7d: (tokenAgg._sum.inputTokens ?? 0) + (tokenAgg._sum.outputTokens ?? 0),
    };
  }

  /** Tenant başına 7g rollup — her metrik tek groupBy. */
  async tenants(): Promise<AiTenantRow[]> {
    const since = new Date(Date.now() - 7 * DAY_MS);
    const [convG, actG, tokG] = await Promise.all([
      this.admin.agentConversation.groupBy({
        by: ['tenantId'],
        _count: { _all: true },
        where: { createdAt: { gte: since } },
      }),
      this.admin.agentAction.groupBy({
        by: ['tenantId', 'type'],
        _count: { _all: true },
        where: { type: { in: ['handoff', 'error'] }, createdAt: { gte: since } },
      }),
      this.admin.agentMessage.groupBy({
        by: ['tenantId'],
        _sum: { inputTokens: true, outputTokens: true },
        where: { createdAt: { gte: since } },
      }),
    ]);
    const conv = new Map(convG.map((r) => [r.tenantId, r._count._all]));
    const handoffs = new Map<string, number>();
    const errors = new Map<string, number>();
    for (const r of actG) {
      const m = r.type === 'handoff' ? handoffs : errors;
      m.set(r.tenantId, r._count._all);
    }
    const tokIn = new Map(tokG.map((r) => [r.tenantId, r._sum.inputTokens ?? 0]));
    const tokOut = new Map(tokG.map((r) => [r.tenantId, r._sum.outputTokens ?? 0]));
    const tenantIds = new Set<string>([
      ...conv.keys(),
      ...handoffs.keys(),
      ...errors.keys(),
      ...tokIn.keys(),
    ]);
    return [...tenantIds].map((tenantId) => ({
      tenantId,
      conversations7d: conv.get(tenantId) ?? 0,
      handoffs7d: handoffs.get(tenantId) ?? 0,
      errors7d: errors.get(tenantId) ?? 0,
      inputTokens7d: tokIn.get(tenantId) ?? 0,
      outputTokens7d: tokOut.get(tenantId) ?? 0,
    }));
  }

  /** Son 20 hata aksiyonu — yalnız summary metadata (PII'siz), mesaj içeriği YOK. */
  async recentErrors(): Promise<AiErrorRow[]> {
    const rows = await this.admin.agentAction.findMany({
      where: { type: 'error' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, tenantId: true, summary: true, createdAt: true },
    });
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      summary: r.summary,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
