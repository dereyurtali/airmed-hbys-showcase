import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { PrismaClient } from '@airmed/db';
import { AgentOrchestratorService } from './agent-orchestrator.service';
import { AUTOMATION_ADMIN_PRISMA } from './automation-ingest.service';

// EPIC #1018 / #1021 — Inbound işleme worker'ı. MessagingWorker kalıbı:
// DB-kuyruk (agent_messages.processed_at IS NULL) + kısa periyotlu cron +
// in-process kilit. LLM turu saniyeler sürer; kilit üst üste tick'i engeller,
// tick başına en fazla MAX_PER_TICK konuşma seri işlenir (tek klinik hacmi
// için yeterli; paralellik gerekirse #1021 sonrası ayrı iş).

const MAX_PER_TICK = 3;
// #1058 — enabled-config kontrolü cache süresi: feature tamamen kapalıyken
// (hiç enabled AgentConfig yok) kuyruk sorgusu hiç atılmaz.
const ENABLED_CHECK_TTL_MS = 30_000;

@Injectable()
export class AutomationWorker {
  private readonly logger = new Logger(AutomationWorker.name);
  private running = false;
  private enabledCheckedAt = 0;
  private hasEnabledConfig = false;

  constructor(
    @Inject(AUTOMATION_ADMIN_PRISMA) private readonly admin: PrismaClient,
    private readonly orchestrator: AgentOrchestratorService,
  ) {}

  // #1058 — 5sn → 15sn: hasta chat UX'i için hâlâ yeterli; Mac Mini'de
  // Postgres'i boş yere idle bırakmayan sıkı tick gevşetildi.
  @Cron('*/15 * * * * *', { name: 'automation-agent' })
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // #1058 — AI asistan hiçbir tenant'ta açık değilse kuyruğu hiç sorgulama.
      if (Date.now() - this.enabledCheckedAt > ENABLED_CHECK_TTL_MS) {
        this.hasEnabledConfig =
          (await this.admin.agentConfig.count({ where: { enabled: true } })) > 0;
        this.enabledCheckedAt = Date.now();
      }
      if (!this.hasEnabledConfig) return;

      const pending = await this.admin.agentMessage.findMany({
        where: {
          role: 'patient',
          processedAt: null,
          conversation: { status: 'bot_active', deletedAt: null },
        },
        select: { conversationId: true, tenantId: true },
        distinct: ['conversationId'],
        orderBy: { createdAt: 'asc' },
        take: MAX_PER_TICK,
      });
      for (const item of pending) {
        try {
          await this.orchestrator.processConversation(item.tenantId, item.conversationId);
        } catch (err) {
          // Orkestratör kendi hata yolunu yönetir; buraya düşen beklenmedik —
          // logla, diğer konuşmaları bloklamadan devam et.
          this.logger.error(
            `processConversation(${item.conversationId}) crashed: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`automation worker tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
