import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { ChatwootAdapter } from './channel-adapter';
import type {
  AgentActionListQuery,
  AgentConfigUpdateInput,
  AgentConversationListQuery,
  AgentSecretsUpdateInput,
} from './automation.schemas';
import { DEFAULT_AGENT_SYSTEM_PROMPT } from './default-system-prompt';
import { SecretCryptoService } from './secret-crypto.service';

// EPIC #1018 — Yönetici yüzeyi (tRPC): config oku/güncelle (revizyonlu),
// konuşma + aksiyon denetimi. Request-bağlamlı → prisma.scoped (RLS).

// Prisma `Json` alanı (Prisma.JsonValue, rekürsif) tRPC tip çıkarımında
// istemcide TS2589'a yol açıyor — config API sınırında dar DTO'ya indirgenir.
export interface AgentChannelSettings {
  chatwootAccountId?: number;
  chatwootBaseUrl?: string;
  // #1034 — webhook URL'inin ekranda gösterilebilmesi için public taban adres
  // (staging: Tailscale Funnel; prod: klinik public endpoint'i).
  webhookPublicBaseUrl?: string;
}

// #1034 — sır DURUMU (asla değerin kendisi değil; write-only sözleşme).
export interface AgentSecretsStatus {
  webhook: { set: boolean };
  chatwootBotToken: { set: boolean; last4: string | null };
  anthropicKey: { set: boolean; last4: string | null };
  openrouterKey: { set: boolean; last4: string | null };
}

export interface AgentConfigDto {
  id: string;
  enabled: boolean;
  provider: string;
  model: string;
  systemPrompt: string;
  knowledgeBase: string | null;
  channelSettings: AgentChannelSettings | null;
  secrets: AgentSecretsStatus;
  revision: number;
  updatedAt: Date;
}

// DTO eşlemesinin okuduğu ham kolonlar (enc alanlar DTO'ya ASLA geçmez).
interface AgentConfigRow {
  id: string;
  enabled: boolean;
  provider: string;
  model: string;
  systemPrompt: string;
  knowledgeBase: string | null;
  channelSettings: unknown;
  webhookSecretEnc: string | null;
  chatwootBotTokenEnc: string | null;
  anthropicKeyEnc: string | null;
  openrouterKeyEnc: string | null;
  revision: number;
  updatedAt: Date;
}

@Injectable()
export class AutomationAdminService {
  private readonly logger = new Logger(AutomationAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly crypto: SecretCryptoService,
    private readonly chatwoot: ChatwootAdapter,
  ) {}

  // #1034 — explicit DTO eşlemesi: şifreli kolonlar istemciye SIZMAZ; yalnız
  // set-durumu + son 4 karakter döner.
  private toDto(row: AgentConfigRow): AgentConfigDto {
    const status = (enc: string | null) => ({
      set: !!enc,
      last4: enc ? this.crypto.last4(enc) : null,
    });
    return {
      id: row.id,
      enabled: row.enabled,
      provider: row.provider,
      model: row.model,
      systemPrompt: row.systemPrompt,
      knowledgeBase: row.knowledgeBase,
      channelSettings: (row.channelSettings ?? null) as AgentChannelSettings | null,
      secrets: {
        webhook: { set: !!row.webhookSecretEnc },
        chatwootBotToken: status(row.chatwootBotTokenEnc),
        anthropicKey: status(row.anthropicKeyEnc),
        openrouterKey: status(row.openrouterKeyEnc),
      },
      revision: row.revision,
      updatedAt: row.updatedAt,
    };
  }

  // #1031 — "Varsayılana sıfırla" butonu için (ekran textarea'yı doldurur,
  // kayıt yine updateConfig'ten revizyonlu geçer).
  getDefaultPrompt(): { systemPrompt: string } {
    return { systemPrompt: DEFAULT_AGENT_SYSTEM_PROMPT };
  }

  // Tenant başına tek config; yoksa kapalı varsayılanlarla oluştur (ekran ilk
  // açılışta boş durumla uğraşmasın).
  async getConfig(): Promise<AgentConfigDto> {
    const tenantId = this.tenantContext.requireTenantId();
    const existing = await this.prisma.scoped.agentConfig.findFirst({ where: { tenantId } });
    if (existing) return this.toDto(existing as unknown as AgentConfigRow);
    const created = await this.prisma.scoped.agentConfig.create({
      data: {
        tenantId,
        systemPrompt: DEFAULT_AGENT_SYSTEM_PROMPT,
        // #1034 — webhook secret ilk açılışta hazır (ekran URL'i hemen gösterir).
        webhookSecretEnc: this.crypto.encrypt(randomBytes(24).toString('hex')),
      },
    });
    return this.toDto(created as unknown as AgentConfigRow);
  }

  // #1034 — Sır güncelleme (write-only). null = sil; undefined = dokunma.
  // Revizyon tablosuna YAZILMAZ (sır geçmişi tutulmaz).
  async updateSecrets(input: AgentSecretsUpdateInput): Promise<AgentConfigDto> {
    const current = await this.getConfig();
    const enc = (v: string | null | undefined) =>
      v === undefined ? undefined : v === null ? null : this.crypto.encrypt(v);
    const updated = await this.prisma.scoped.agentConfig.update({
      where: { id: current.id },
      data: {
        ...(input.chatwootBotToken !== undefined
          ? { chatwootBotTokenEnc: enc(input.chatwootBotToken) }
          : {}),
        ...(input.anthropicKey !== undefined ? { anthropicKeyEnc: enc(input.anthropicKey) } : {}),
        ...(input.openrouterKey !== undefined
          ? { openrouterKeyEnc: enc(input.openrouterKey) }
          : {}),
      },
    });
    return this.toDto(updated as unknown as AgentConfigRow);
  }

  // #1034 — Webhook URL'i (Chatwoot bot tanımına yapıştırılır). Yalnız
  // yönetici ekranı çağırır; secret URL'in parçası olduğu için burada döner.
  async getWebhookInfo(): Promise<{ configured: boolean; url: string | null }> {
    const tenantId = this.tenantContext.requireTenantId();
    const row = await this.prisma.scoped.agentConfig.findFirst({
      where: { tenantId },
      select: { webhookSecretEnc: true, channelSettings: true },
    });
    if (!row?.webhookSecretEnc) return { configured: false, url: null };
    const settings = (row.channelSettings ?? {}) as AgentChannelSettings;
    const base = settings.webhookPublicBaseUrl?.replace(/\/$/, '');
    if (!base) return { configured: true, url: null };
    const token = this.crypto.decrypt(row.webhookSecretEnc);
    return { configured: true, url: `${base}/api/automation/webhook/chatwoot?token=${token}` };
  }

  // #1034 — Secret yenile: eski URL anında geçersizleşir (Chatwoot'taki bot
  // tanımı yeni URL ile güncellenmeli — ekran uyarır).
  async rotateWebhookSecret(): Promise<{ configured: boolean; url: string | null }> {
    const current = await this.getConfig();
    await this.prisma.scoped.agentConfig.update({
      where: { id: current.id },
      data: { webhookSecretEnc: this.crypto.encrypt(randomBytes(24).toString('hex')) },
    });
    return this.getWebhookInfo();
  }

  // Güncelleme öncesi mevcut hâl revizyon tablosuna yazılır (append-only,
  // kim değiştirdi izi) — rollback + denetim.
  async updateConfig(input: AgentConfigUpdateInput, actorUserId: string): Promise<AgentConfigDto> {
    const tenantId = this.tenantContext.requireTenantId();
    const current = await this.getConfig();

    await this.prisma.scoped.agentConfigRevision.create({
      data: {
        tenantId,
        configId: current.id,
        revision: current.revision,
        provider: current.provider,
        model: current.model,
        systemPrompt: current.systemPrompt,
        createdById: actorUserId,
      },
    });

    const updated = await this.prisma.scoped.agentConfig.update({
      where: { id: current.id },
      data: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.provider !== undefined ? { provider: input.provider } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
        ...(input.knowledgeBase !== undefined ? { knowledgeBase: input.knowledgeBase } : {}),
        ...(input.channelSettings !== undefined
          ? {
              channelSettings: input.channelSettings ?? undefined,
              // #1070 — webhook tenant çözümü bu index'li kolondan; JSONB ile
              // senkron tutulur.
              chatwootAccountId:
                (input.channelSettings as { chatwootAccountId?: number } | null)
                  ?.chatwootAccountId ?? null,
            }
          : {}),
        revision: { increment: 1 },
      },
    });
    return this.toDto(updated as unknown as AgentConfigRow);
  }

  async listConversations({ status, page, pageSize }: AgentConversationListQuery) {
    const where = { deletedAt: null, ...(status ? { status } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.scoped.agentConversation.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
          _count: { select: { messages: true, actions: true } },
        },
      }),
      this.prisma.scoped.agentConversation.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  // #1038 — Personel konuşmayı HBYS ekranından bota geri verir: HBYS durumu
  // bot_active olur (bot bir sonraki hasta mesajında devreye girer), Chatwoot
  // tarafı best-effort pending'e çekilir (başarısızlık HBYS devrini bozmaz —
  // hesap-webhook'u status'u zaten er geç senkronlar).
  async returnToBot(conversationId: string, actorUserId: string) {
    const tenantId = this.tenantContext.requireTenantId();
    const conversation = await this.prisma.scoped.agentConversation.findFirst({
      where: { id: conversationId, deletedAt: null },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.status !== 'human_active') {
      throw new BadRequestException('Conversation is not with staff');
    }

    await this.prisma.scoped.agentConversation.update({
      where: { id: conversationId },
      data: { status: 'bot_active' },
    });
    await this.prisma.scoped.agentAction.create({
      data: {
        tenantId,
        conversationId,
        type: 'returned_to_bot',
        summary: 'Personel konuşmayı bota geri verdi',
        payload: { actorUserId },
      },
    });

    const config = await this.prisma.scoped.agentConfig.findFirst({
      where: { tenantId },
      select: { channelSettings: true, chatwootBotTokenEnc: true },
    });
    const settings = (config?.channelSettings ?? {}) as AgentChannelSettings;
    if (settings.chatwootAccountId) {
      try {
        await this.chatwoot.returnToBot(
          {
            chatwootAccountId: settings.chatwootAccountId,
            chatwootConversationId: conversation.chatwootConversationId,
          },
          config?.chatwootBotTokenEnc ? this.crypto.decrypt(config.chatwootBotTokenEnc) : undefined,
        );
      } catch (err) {
        this.logger.warn(
          `Chatwoot pending toggle failed for conversation ${conversationId}: ${(err as Error).message}`,
        );
      }
    }

    return { id: conversationId, status: 'bot_active' as const };
  }

  async getConversation(id: string) {
    const conversation = await this.prisma.scoped.agentConversation.findFirst({
      where: { id, deletedAt: null },
      include: {
        patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
        // toolCalls Json alanı istemci tipini şişiriyor (TS2589) — transcript
        // görünümünün ihtiyacı olan alanlar select ile daraltılır.
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, role: true, content: true, error: true, createdAt: true },
        },
        actions: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, type: true, refId: true, summary: true, createdAt: true },
        },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  async listActions({ type, page, pageSize }: AgentActionListQuery) {
    const where = type ? { type } : {};
    const [items, total] = await Promise.all([
      this.prisma.scoped.agentAction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        // payload Json istemciye gitmez (TS2589 + gereksiz veri) — denetim
        // listesi özet + tip + zamanla çalışır.
        select: {
          id: true,
          type: true,
          refId: true,
          summary: true,
          createdAt: true,
          conversation: {
            select: { id: true, contactName: true, contactPhone: true, channel: true },
          },
        },
      }),
      this.prisma.scoped.agentAction.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  // #1022 — Yönetici ekranı KPI şeridi. Tek round-trip'te sayımlar; "bugün"
  // Duşanbe günü (UTC+5, DST yok — appointment.service formatTrDate ile aynı
  // yaklaşım).
  async stats() {
    const now = new Date();
    const dushanbe = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    const todayStart = new Date(
      Date.UTC(dushanbe.getUTCFullYear(), dushanbe.getUTCMonth(), dushanbe.getUTCDate()) -
        5 * 60 * 60 * 1000,
    );

    const [byStatus, byType, todayPatientMessages] = await Promise.all([
      this.prisma.scoped.agentConversation.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.scoped.agentAction.groupBy({ by: ['type'], _count: { _all: true } }),
      this.prisma.scoped.agentMessage.count({
        where: { role: 'patient', createdAt: { gte: todayStart } },
      }),
    ]);

    const statusCount = (key: string) => byStatus.find((r) => r.status === key)?._count._all ?? 0;
    const typeCount = (key: string) => byType.find((r) => r.type === key)?._count._all ?? 0;
    return {
      todayPatientMessages,
      conversations: {
        bot_active: statusCount('bot_active'),
        human_active: statusCount('human_active'),
        closed: statusCount('closed'),
      },
      actions: {
        appointment_created: typeCount('appointment_created'),
        patient_created: typeCount('patient_created'),
        handoff: typeCount('handoff'),
        error: typeCount('error'),
      },
    };
  }
}
