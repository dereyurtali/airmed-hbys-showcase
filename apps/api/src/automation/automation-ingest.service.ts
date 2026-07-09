import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@airmed/db';
import { mapChatwootChannel, type ChatwootWebhookPayload } from './chatwoot.types';

// EPIC #1018 / #1020 — Chatwoot webhook ingest. Webhook JWT'siz gelir (tenant
// context yok) → MessagingService kalıbı: BYPASSRLS admin client + explicit
// tenantId. Tenant, AgentConfig.channelSettings.chatwootAccountId eşlemesinden
// çözülür; config yok/kapalıysa payload SAKLANMADAN yutulur (veri biriktirme
// ancak yönetici botu açınca başlar).

export const AUTOMATION_ADMIN_PRISMA = Symbol('AUTOMATION_ADMIN_PRISMA');

export type IngestResult =
  | { outcome: 'ignored'; reason: string }
  | { outcome: 'stored'; conversationId: string; messageId?: string }
  | { outcome: 'status_synced'; conversationId: string };

@Injectable()
export class AutomationIngestService {
  private readonly logger = new Logger(AutomationIngestService.name);

  // #1065 — AUTOMATION_ADMIN_PRISMA paylaşımlı AdminPrismaService'e bağlı
  // (useExisting); yaşam döngüsü onda — burada $disconnect ETME.
  constructor(@Inject(AUTOMATION_ADMIN_PRISMA) private readonly admin: PrismaClient) {}

  async ingest(payload: ChatwootWebhookPayload): Promise<IngestResult> {
    // #1036 — hesap-webhook'unda hesap kimliği kökte (account_id) gelebilir.
    const accountId = payload.account?.id ?? payload.account_id;
    if (!accountId) return { outcome: 'ignored', reason: 'missing account/conversation' };

    // #1070 — index'li kolon üzerinden (eski JSONB path sorgusu her webhook'ta
    // seq scan yapıyordu).
    const config = await this.admin.agentConfig.findUnique({
      where: { chatwootAccountId: accountId },
      select: { tenantId: true, enabled: true },
    });
    if (!config) return { outcome: 'ignored', reason: 'no config for account' };
    if (!config.enabled) return { outcome: 'ignored', reason: 'agent disabled' };

    // #1036 — Chatwoot agent-bot webhook'u durum olayı GÖNDERMİYOR; Pending'e
    // çekilen konuşma botta geri açılamıyordu. Durum senkronu HESAP
    // webhook'undan gelir ve orada konuşma alanları KÖKTE olabilir
    // (payload.id = conversation id, payload.status). İki formu da destekle.
    if (payload.event === 'conversation_status_changed') {
      const conversationId = payload.conversation?.id ?? payload.id;
      const status = payload.status ?? payload.conversation?.status;
      if (!conversationId) {
        return { outcome: 'ignored', reason: 'missing account/conversation' };
      }
      return this.syncStatus(config.tenantId, conversationId, status);
    }
    if (payload.event !== 'message_created') {
      return { outcome: 'ignored', reason: `unhandled event ${payload.event}` };
    }
    const conversation = payload.conversation;
    if (!conversation?.id) {
      return { outcome: 'ignored', reason: 'missing account/conversation' };
    }
    if (payload.private) return { outcome: 'ignored', reason: 'private note' };
    const content = (payload.content ?? '').trim();
    if (!content) return { outcome: 'ignored', reason: 'empty content' };
    if (payload.message_type !== 'incoming' && payload.message_type !== 'outgoing') {
      return { outcome: 'ignored', reason: `unhandled message_type ${payload.message_type}` };
    }

    const sender = payload.conversation?.meta?.sender ?? payload.sender;
    const conv = await this.upsertConversation(config.tenantId, {
      chatwootConversationId: conversation.id,
      channel: mapChatwootChannel(conversation.channel),
      contactName: sender?.name ?? null,
      contactPhone: sender?.phone_number ?? null,
    });

    // incoming = hasta (kuyruğa girer, processedAt=null); outgoing = bot'un
    // KENDİ gönderdiği mesajın yankısı OLABİLİR ya da personelin Chatwoot'tan
    // yazdığı mesaj. Bot kendi mesajlarını assistant olarak zaten loglar
    // (#1021) — yankıyı staff sayıp çiftlememek için outgoing'de sender.type
    // bakılır: agent_bot yankısı yutulur.
    if (payload.message_type === 'outgoing' && payload.sender?.type === 'agent_bot') {
      return { outcome: 'stored', conversationId: conv.id };
    }
    const role = payload.message_type === 'incoming' ? 'patient' : 'staff';

    try {
      const message = await this.admin.agentMessage.create({
        data: {
          tenantId: config.tenantId,
          conversationId: conv.id,
          role,
          content,
          chatwootMessageId: payload.id ?? null,
          processedAt: role === 'staff' ? new Date() : null,
        },
      });
      await this.admin.agentConversation.update({
        where: { id: conv.id },
        data: { lastMessageAt: new Date() },
      });
      return { outcome: 'stored', conversationId: conv.id, messageId: message.id };
    } catch (err) {
      // Chatwoot webhook'ları en-az-bir-kez teslim eder — aynı mesaj iki kez
      // gelebilir. Unique (tenantId, chatwootMessageId) yakalar; sessiz geç.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { outcome: 'stored', conversationId: conv.id };
      }
      throw err;
    }
  }

  private async syncStatus(
    tenantId: string,
    chatwootConversationId: number,
    status: string | undefined,
  ): Promise<IngestResult> {
    const existing = await this.admin.agentConversation.findUnique({
      where: { tenantId_chatwootConversationId: { tenantId, chatwootConversationId } },
      select: { id: true, status: true },
    });
    if (!existing) return { outcome: 'ignored', reason: 'unknown conversation' };

    // Chatwoot → HBYS durum makinesi (#1023'te bildirimle tamamlanır):
    // open = personel devraldı; pending = bot kuyruğu; resolved = kapandı.
    const mapped =
      status === 'open'
        ? ('human_active' as const)
        : status === 'resolved'
          ? ('closed' as const)
          : status === 'pending'
            ? ('bot_active' as const)
            : null;
    if (!mapped || mapped === existing.status) {
      return { outcome: 'ignored', reason: `status ${status} no-op` };
    }
    await this.admin.agentConversation.update({
      where: { id: existing.id },
      data: {
        status: mapped,
        ...(mapped === 'human_active' ? { handedOffAt: new Date() } : {}),
        ...(mapped === 'closed' ? { closedAt: new Date() } : {}),
      },
    });
    this.logger.log(
      `conversation ${existing.id}: ${existing.status} → ${mapped} (chatwoot ${status})`,
    );
    return { outcome: 'status_synced', conversationId: existing.id };
  }

  private upsertConversation(
    tenantId: string,
    data: {
      chatwootConversationId: number;
      channel: ReturnType<typeof mapChatwootChannel>;
      contactName: string | null;
      contactPhone: string | null;
    },
  ) {
    return this.admin.agentConversation.upsert({
      where: {
        tenantId_chatwootConversationId: {
          tenantId,
          chatwootConversationId: data.chatwootConversationId,
        },
      },
      create: { tenantId, ...data },
      // Kontak bilgisi sonradan netleşebilir (WhatsApp isim günceller).
      update: {
        ...(data.contactName ? { contactName: data.contactName } : {}),
        ...(data.contactPhone ? { contactPhone: data.contactPhone } : {}),
      },
      select: { id: true },
    });
  }
}
