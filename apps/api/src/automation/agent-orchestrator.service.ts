import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { AgentConfig, PrismaClient } from '@airmed/db';
import { NotificationService } from '../notification/notification.service';
import { SecretCryptoService } from './secret-crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { AgentToolsService, type ToolContext } from './agent-tools.service';
import { AUTOMATION_ADMIN_PRISMA } from './automation-ingest.service';
import { ChatwootAdapter, type OutboundMessageRef } from './channel-adapter';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenRouterProvider } from './providers/openrouter.provider';
import type { AgentHistoryMessage, IModelProvider } from './model-provider';

// EPIC #1018 / #1021 — Konuşma orkestratörü. Üç faz:
//   1) OKU (kısa tenant tx): config + konuşma + geçmiş + bekleyen inbound
//   2) MODEL DÖNGÜSÜ (tx YOK — LLM saniyeler/dakikalar sürebilir, 5sn tx
//      timeout'una ve bağlantı havuzuna asla oturmaz); her tool çağrısı
//      kendi KISA tenant tx'inde koşar
//   3) YAZ (kısa tenant tx): assistant mesajı + processed işaretleri + devir
// Sonra Chatwoot'a gönderim (DB dışı). Hata yolunda: mesajlar error ile
// kapatılır (hot-loop önlenir) + hasta askıda kalmasın diye insana devir.

const HISTORY_LIMIT = 40;

@Injectable()
export class AgentOrchestratorService {
  private readonly logger = new Logger(AgentOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    private readonly tenantContext: TenantContextService,
    private readonly tools: AgentToolsService,
    private readonly adapter: ChatwootAdapter,
    private readonly anthropic: AnthropicProvider,
    private readonly openrouter: OpenRouterProvider,
    private readonly notifications: NotificationService,
    private readonly crypto: SecretCryptoService,
    @Inject(AUTOMATION_ADMIN_PRISMA) private readonly admin: PrismaClient,
  ) {}

  // #1070 — config (prompt+KB+model) tenant başına ~hiç değişmez; her konuşma
  // işlemede DB'den okumak gereksizdi. Kısa TTL (30sn): ekrandan "Kaydet"
  // deploy'suz ≤30sn içinde bota yansır (kabul kriteri).
  private readonly configCache = new Map<string, { at: number; config: AgentConfig | null }>();
  private static readonly CONFIG_TTL_MS = 30_000;

  private async getConfigCached(tenantId: string): Promise<AgentConfig | null> {
    const hit = this.configCache.get(tenantId);
    if (hit && Date.now() - hit.at < AgentOrchestratorService.CONFIG_TTL_MS) return hit.config;
    const config = await this.inTenant(tenantId, () =>
      this.prisma.scoped.agentConfig.findFirst({ where: { tenantId } }),
    );
    this.configCache.set(tenantId, { at: Date.now(), config });
    return config;
  }

  async processConversation(tenantId: string, conversationId: string): Promise<void> {
    // Faz 1 — oku (config cache'ten; konuşma her zaman taze).
    const config = await this.getConfigCached(tenantId);
    if (!config?.enabled) return;
    const conversation = await this.inTenant(tenantId, () =>
      this.prisma.scoped.agentConversation.findFirst({
        where: { id: conversationId, deletedAt: null },
        include: {
          messages: { orderBy: { createdAt: 'desc' }, take: HISTORY_LIMIT },
          patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
        },
      }),
    );
    if (!conversation || conversation.status !== 'bot_active') return;
    const pendingIds = conversation.messages
      .filter((m) => m.role === 'patient' && m.processedAt === null)
      .map((m) => m.id);
    if (pendingIds.length === 0) return;

    const settings = (config.channelSettings ?? {}) as {
      chatwootAccountId?: number;
      chatwootBaseUrl?: string;
    };
    // #1034 — sırlar DB'den (ekrandan girilir, şifreli durur); yoksa provider/
    // adapter env fallback'ine düşer.
    const configRow = config as unknown as {
      chatwootBotTokenEnc: string | null;
      anthropicKeyEnc: string | null;
      openrouterKeyEnc: string | null;
    };
    const botToken = configRow.chatwootBotTokenEnc
      ? this.crypto.decrypt(configRow.chatwootBotTokenEnc)
      : undefined;
    const providerKeyEnc =
      config.provider === 'openrouter' ? configRow.openrouterKeyEnc : configRow.anthropicKeyEnc;
    const apiKey = providerKeyEnc ? this.crypto.decrypt(providerKeyEnc) : undefined;
    if (!settings.chatwootAccountId) {
      await this.failPending(
        tenantId,
        conversationId,
        pendingIds,
        'channelSettings.chatwootAccountId eksik',
      );
      return;
    }
    const ref: OutboundMessageRef = {
      chatwootAccountId: settings.chatwootAccountId,
      chatwootConversationId: conversation.chatwootConversationId,
    };
    const chatwootUrl = buildChatwootUrl(settings, conversation.chatwootConversationId);
    const contactLabel =
      conversation.contactName || conversation.contactPhone || conversation.chatwootConversationId;

    // Faz 2 — model döngüsü (tx dışı).
    const toolCtx: ToolContext = {
      tenantId,
      conversation: {
        id: conversation.id,
        channel: conversation.channel,
        contactPhone: conversation.contactPhone,
        patientId: conversation.patientId,
      },
      trace: [],
      handoff: { requested: false, reason: '' },
    };
    const provider = this.pickProvider(config.provider);
    const history = buildHistory(conversation.messages);
    const systemPrompt = composeSystemPrompt({
      base: config.systemPrompt,
      knowledgeBase: config.knowledgeBase,
      channel: conversation.channel,
      patient: conversation.patient,
      contactPhone: conversation.contactPhone,
    });

    let replyText: string;
    // #1089 — platform AI izleme için token kullanımı (assistant mesajına yazılır).
    let usage: { inputTokens: number; outputTokens: number; model: string } | undefined;
    try {
      const result = await provider.runTurn({
        model: config.model,
        systemPrompt,
        apiKey,
        messages: history,
        tools: this.tools.definitions(),
        executeTool: (call) => this.inTenant(tenantId, () => this.tools.execute(toolCtx, call)),
      });
      replyText = result.text;
      usage = result.usage;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`orchestration failed for conversation ${conversationId}: ${message}`);
      await this.failPending(tenantId, conversationId, pendingIds, message);
      // Hasta askıda kalmasın: cevap üretilemedi → insana devret (best-effort).
      await this.tryHandoff(
        tenantId,
        conversationId,
        ref,
        `Bot hatası: ${message.slice(0, 200)}`,
        botToken,
      );
      await this.notifyHandoff(tenantId, conversationId, {
        contactLabel: String(contactLabel),
        reason: 'Bot cevap üretemedi',
        chatwootUrl,
      });
      return;
    }

    // Faz 3 — yaz (gönderimden ÖNCE persist: yeniden işleme > çift cevap riski).
    await this.inTenant(tenantId, async () => {
      await this.prisma.scoped.agentMessage.create({
        data: {
          tenantId,
          conversationId,
          role: 'assistant',
          content: replyText,
          toolCalls:
            toolCtx.trace.length > 0 ? JSON.parse(JSON.stringify(toolCtx.trace)) : undefined,
          processedAt: new Date(),
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          model: usage?.model ?? null,
        },
      });
      await this.prisma.scoped.agentMessage.updateMany({
        where: { id: { in: pendingIds } },
        data: { processedAt: new Date() },
      });
      await this.prisma.scoped.agentConversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(),
          ...(toolCtx.handoff.requested
            ? { status: 'human_active' as const, handedOffAt: new Date() }
            : {}),
        },
      });
    });

    // #1023 — devir personel ziline düşer (Chatwoot push'una ek, HBYS-içi iz).
    if (toolCtx.handoff.requested) {
      await this.notifyHandoff(tenantId, conversationId, {
        contactLabel: String(contactLabel),
        reason: toolCtx.handoff.reason,
        chatwootUrl,
      });
    }

    try {
      await this.adapter.sendMessage(ref, replyText, botToken);
      if (toolCtx.handoff.requested) await this.adapter.handoffToHuman(ref, botToken);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`chatwoot delivery failed for ${conversationId}: ${message}`);
      await this.logErrorAction(tenantId, conversationId, `Chatwoot gönderim hatası: ${message}`);
    }
  }

  private pickProvider(key: string): IModelProvider {
    return key === 'openrouter' ? this.openrouter : this.anthropic;
  }

  // #1023 — Devir bildirimi: resepsiyon + yönetici zili (approval.service
  // eskalasyon kalıbı — tek sorgu, çift-rol kullanıcıya tek bildirim).
  private async notifyHandoff(
    tenantId: string,
    conversationId: string,
    info: { contactLabel: string; reason: string; chatwootUrl: string | null },
  ): Promise<void> {
    try {
      await this.inTenant(tenantId, async () => {
        const recipients = await this.prisma.scoped.user.findMany({
          where: {
            deletedAt: null,
            userRoles: { some: { role: { key: { in: ['resepsiyon', 'yonetici'] } } } },
          },
          select: { id: true },
        });
        await this.notifications.createForUsers(
          recipients.map((u) => u.id),
          {
            type: 'automation_escalated',
            title: 'AI asistan bir konuşmayı devretti',
            body: `${info.contactLabel} — ${info.reason}`.slice(0, 500),
            payload: {
              conversationId,
              ...(info.chatwootUrl ? { chatwootUrl: info.chatwootUrl } : {}),
            },
          },
        );
      });
    } catch (err) {
      this.logger.error(`handoff notification failed: ${(err as Error).message}`);
    }
  }

  // Arka plan işinde CLS bağlamı yok — TenantInterceptor.runScoped'un birebir
  // karşılığı: cls.run → runWithTenant tx → CLS'e tenant+tx yaz → fn.
  private inTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return this.cls.run(() =>
      this.prisma.runWithTenant(tenantId, async (tx) => {
        this.tenantContext.setTenantId(tenantId);
        this.tenantContext.setTransaction(tx);
        return fn();
      }),
    );
  }

  // Hata yolunda admin client: hot-loop kesilir (processedAt + error dolar).
  private async failPending(
    tenantId: string,
    conversationId: string,
    pendingIds: string[],
    error: string,
  ): Promise<void> {
    await this.admin.agentMessage.updateMany({
      where: { id: { in: pendingIds } },
      data: { processedAt: new Date(), error: error.slice(0, 1000) },
    });
    await this.logErrorAction(tenantId, conversationId, error.slice(0, 500));
  }

  private async tryHandoff(
    tenantId: string,
    conversationId: string,
    ref: OutboundMessageRef,
    reason: string,
    botToken?: string,
  ): Promise<void> {
    try {
      await this.admin.agentConversation.update({
        where: { id: conversationId },
        data: { status: 'human_active', handedOffAt: new Date() },
      });
      await this.admin.agentAction.create({
        data: { tenantId, conversationId, type: 'handoff', summary: reason.slice(0, 500) },
      });
      await this.adapter.handoffToHuman(ref, botToken);
    } catch (err) {
      this.logger.error(`handoff after failure also failed: ${(err as Error).message}`);
    }
  }

  private async logErrorAction(
    tenantId: string,
    conversationId: string,
    summary: string,
  ): Promise<void> {
    await this.admin.agentAction
      .create({ data: { tenantId, conversationId, type: 'error', summary: summary.slice(0, 500) } })
      .catch(() => undefined);
  }
}

// Chatwoot konuşma derin linki — Bell tıklaması personeli doğrudan devralma
// ekranına götürür (#1023).
function buildChatwootUrl(
  settings: { chatwootAccountId?: number; chatwootBaseUrl?: string },
  chatwootConversationId: number,
): string | null {
  if (!settings.chatwootAccountId) return null;
  const base = (settings.chatwootBaseUrl ?? 'https://app.chatwoot.com').replace(/\/$/, '');
  return `${base}/app/accounts/${settings.chatwootAccountId}/conversations/${chatwootConversationId}`;
}

// Geçmiş desc çekildi (son N) — modele asc verilir. Personel mesajı user
// rolünde etiketle taşınır (model bağlamı görsün); system satırları atlanır.
function buildHistory(
  messages: { role: string; content: string; createdAt: Date }[],
): AgentHistoryMessage[] {
  return [...messages]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (m.role === 'assistant') return { role: 'assistant' as const, content: m.content };
      if (m.role === 'staff') {
        return { role: 'user' as const, content: `[Klinik personeli yazdı]: ${m.content}` };
      }
      return { role: 'user' as const, content: m.content };
    });
}

function composeSystemPrompt(args: {
  base: string;
  knowledgeBase: string | null;
  channel: string;
  patient: { mrn: string; firstName: string; lastName: string } | null;
  contactPhone: string | null;
}): string {
  const now = new Date();
  const dushanbe = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const today = `${dushanbe.getUTCFullYear()}-${String(dushanbe.getUTCMonth() + 1).padStart(2, '0')}-${String(dushanbe.getUTCDate()).padStart(2, '0')}`;
  const parts = [args.base];
  if (args.knowledgeBase?.trim()) {
    parts.push(`<bilgi_tabani>\n${args.knowledgeBase.trim()}\n</bilgi_tabani>`);
  }
  parts.push(
    `<oturum_bilgisi>\nBugün (Duşanbe): ${today}. Kanal: ${args.channel}.` +
      (args.contactPhone ? ` Hastanın kanal telefon numarası: ${args.contactPhone}.` : '') +
      (args.patient
        ? ` Eşleşmiş hasta: ${args.patient.firstName} ${args.patient.lastName} (MRN ${args.patient.mrn}).`
        : ' Hasta henüz sistemde eşleşmedi.') +
      `\n</oturum_bilgisi>`,
  );
  return parts.join('\n\n');
}
