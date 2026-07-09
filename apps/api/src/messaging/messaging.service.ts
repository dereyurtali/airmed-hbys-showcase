import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@airmed/db';
import Handlebars from 'handlebars';
import { AdminPrismaService } from '../prisma/admin-prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { MockMessageProvider } from './mock-message.provider';
import { HttpSmsProvider } from './http-sms.provider';
import {
  POST_OP_TEMPLATES_MULTI_LANG,
  TEMPLATE_DEFAULTS_TR,
  TRIGGER_DEFAULTS,
} from './messaging.defaults';
import type {
  FireTriggerInput,
  IMessageProvider,
  MessageChannel,
  MessageLanguage,
  RenderedMessage,
} from './messaging.types';

// D1 — Mesajlaşma core service.
//
// Sorumluluklar:
// - ensureDefaults(tenantId): trigger + template seed (idempotent upsert)
// - fire(input): trigger lookup → quiet hours check → template render
//   → MessageDelivery PENDING insert (worker pickup)
// - processPendingBatch(): worker'ın çağırdığı batch dispatcher
// - Provider registry: channel → IMessageProvider map; MOCK her zaman var
//
// Quiet hours uygulaması Asia/Dushanbe TZ (klinik yerel saat, UTC+5, DST yok).
// Eğer şu anki saat trigger.quietHoursStart-end aralığındaysa, scheduledAt'i
// pencere sonuna kaydır.

@Injectable()
export class MessagingService implements OnModuleInit {
  private readonly logger = new Logger(MessagingService.name);
  private readonly providers = new Map<MessageChannel, IMessageProvider>();

  // Admin client: BYPASSRLS role. Sadece cross-tenant operasyonlar (worker
  // batch pickup, ensureDefaults onboarding seed) için. Request-bağlamı içinde
  // çağrılan fire() artık prisma.scoped üzerinden yazıyor → parent transaction
  // rollback olursa messaging.fire'ın yazdığı MessageDelivery de geri alınır
  // (orphan SMS önlenir, denetim P0 2.6).
  // #1065 — paylaşımlı AdminPrismaService (tek havuz).
  constructor(
    private readonly mockProvider: MockMessageProvider,
    private readonly smsProvider: HttpSmsProvider,
    private readonly tenantContext: TenantContextService,
    private readonly admin: AdminPrismaService,
  ) {}

  onModuleInit(): void {
    this.providers.set('MOCK', this.mockProvider);
    // #428 — Gerçek SMS kanalı yalnız gateway yapılandırılmışsa register edilir;
    // aksi halde 'SMS' kanalına alınmış bir trigger "No provider for channel" ile
    // net biçimde başarısız olur (sessizce yutmaz). Hatırlatma / "gelmeden öde" /
    // ameliyat-günü şablonları zaten tanımlı; trigger kanalı SMS'e alınınca
    // (admin panel) gerçek gönderilir. WhatsApp/Email/Telegram aynı şekilde eklenir.
    if (HttpSmsProvider.isConfigured()) {
      this.providers.set('SMS', this.smsProvider);
      this.logger.log('SMS provider kayıtlı (SMS_GATEWAY_URL yapılandırıldı)');
    }
  }

  // ---------- Defaults seed ----------

  async ensureDefaults(tenantId: string): Promise<void> {
    for (const t of TRIGGER_DEFAULTS) {
      await this.admin.messageTrigger.upsert({
        where: { tenantId_key: { tenantId, key: t.key } },
        update: {}, // existing config korunur (admin override)
        create: {
          tenantId,
          key: t.key,
          category: t.category,
          name: t.name,
          isEnabled: t.isEnabled,
          isMandatory: t.isMandatory ?? false,
          channels: t.channels,
          quietHoursStart: t.quietHoursStart ?? null,
          quietHoursEnd: t.quietHoursEnd ?? null,
        },
      });
    }
    const allTemplates = [...TEMPLATE_DEFAULTS_TR, ...POST_OP_TEMPLATES_MULTI_LANG];
    for (const tpl of allTemplates) {
      await this.admin.messageTemplate.upsert({
        where: {
          tenantId_triggerKey_language_channelType: {
            tenantId,
            triggerKey: tpl.triggerKey,
            language: tpl.language,
            channelType: tpl.channelType,
          },
        },
        update: {},
        create: {
          tenantId,
          triggerKey: tpl.triggerKey,
          language: tpl.language,
          channelType: tpl.channelType,
          subject: tpl.subject,
          body: tpl.body,
          variables: tpl.variables,
        },
      });
    }
  }

  // ---------- Fire trigger (modüllerden çağrılır) ----------

  async fire(input: FireTriggerInput): Promise<{ queued: number; skipped: string | null }> {
    await this.ensureDefaults(input.tenantId);

    // P0 2.6 — fire MessageDelivery yazımları artık caller'ın request tx'inde
    // (TenantInterceptor.setTransaction). Parent rollback → messaging de
    // rollback (orphan SMS önlenir). Request bağlamı dışında çağrılırsa
    // (cron worker'dan değil ama batch onboarding scriptlerinden çağrılırsa)
    // admin client'a düşer — onboarding zaten cross-tenant erişim ister.
    const tx = this.tenantContext.getTransaction() ?? this.admin;

    const trigger = await tx.messageTrigger.findUnique({
      where: { tenantId_key: { tenantId: input.tenantId, key: input.key } },
    });
    if (!trigger) {
      this.logger.warn(`Unknown trigger key: ${input.key} (tenant ${input.tenantId})`);
      return { queued: 0, skipped: 'unknown_trigger' };
    }
    if (!trigger.isEnabled) {
      return { queued: 0, skipped: 'trigger_disabled' };
    }

    const language: MessageLanguage = input.language ?? 'tr';
    let scheduledAt = input.scheduledAt ?? new Date();
    // Quiet hours kontrolü (Asia/Dushanbe local hour)
    if (trigger.quietHoursStart !== null && trigger.quietHoursEnd !== null) {
      const localHour = this.getDushanbeHour(scheduledAt);
      if (isInQuietHours(localHour, trigger.quietHoursStart, trigger.quietHoursEnd)) {
        scheduledAt = nextWindowEnd(scheduledAt, trigger.quietHoursEnd);
      }
    }

    let queued = 0;
    for (const channel of trigger.channels as MessageChannel[]) {
      const tpl = await tx.messageTemplate.findUnique({
        where: {
          tenantId_triggerKey_language_channelType: {
            tenantId: input.tenantId,
            triggerKey: input.key,
            language,
            channelType: channel,
          },
        },
      });
      if (!tpl || !tpl.isActive || tpl.deletedAt) {
        this.logger.warn(
          `Template missing for ${input.key} ${language}/${channel}; skipping channel`,
        );
        continue;
      }
      const rendered = this.render(tpl.subject, tpl.body, tpl.variables, input.context);
      await tx.messageDelivery.create({
        data: {
          tenantId: input.tenantId,
          triggerKey: input.key,
          channelType: channel,
          recipient: input.recipient,
          subject: rendered.subject,
          body: rendered.body,
          contextSnapshot: input.context as Prisma.InputJsonValue,
          status: 'PENDING',
          scheduledAt,
        },
      });
      queued++;
    }
    return { queued, skipped: queued === 0 ? 'no_active_template' : null };
  }

  // ---------- Worker dispatch ----------

  async processPendingBatch(limit = 50): Promise<{ sent: number; failed: number }> {
    const pending = await this.admin.messageDelivery.findMany({
      where: { status: 'PENDING', scheduledAt: { lte: new Date() } },
      orderBy: { scheduledAt: 'asc' },
      take: limit,
    });
    if (pending.length === 0) return { sent: 0, failed: 0 };

    let sent = 0;
    let failed = 0;
    for (const d of pending) {
      const provider = this.providers.get(d.channelType as MessageChannel);
      if (!provider) {
        await this.admin.messageDelivery.update({
          where: { id: d.id },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
            lastError: `No provider for channel ${d.channelType}`,
            attempts: { increment: 1 },
          },
        });
        failed++;
        continue;
      }
      try {
        const result = await provider.send(d.recipient, { subject: d.subject, body: d.body });
        await this.admin.messageDelivery.update({
          where: { id: d.id },
          data: {
            status: result.status,
            sentAt: new Date(),
            deliveredAt: result.status === 'DELIVERED' ? new Date() : null,
            attempts: { increment: 1 },
            lastError: result.error ?? null,
          },
        });
        if (result.status === 'FAILED') {
          failed++;
        } else {
          sent++;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.admin.messageDelivery.update({
          where: { id: d.id },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
            attempts: { increment: 1 },
            lastError: message.slice(0, 1000),
          },
        });
        failed++;
      }
    }
    return { sent, failed };
  }

  // ---------- Helpers ----------

  private render(
    subject: string | null,
    body: string,
    allowed: string[],
    context: Record<string, unknown>,
  ): RenderedMessage {
    const safe = this.filterContext(context, allowed);
    const renderTpl = (src: string | null) =>
      src ? Handlebars.compile(src, { noEscape: true, strict: false })(safe) : null;
    const renderedSubject = renderTpl(subject);
    const renderedBody = renderTpl(body);
    if (!renderedBody) throw new BadRequestException('Template body empty');
    return { subject: renderedSubject, body: renderedBody };
  }

  private filterContext(
    context: Record<string, unknown>,
    allowed: string[],
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in context) out[key] = context[key];
    }
    return out;
  }

  private getDushanbeHour(date: Date): number {
    // Asia/Dushanbe UTC+5 (no DST)
    return (date.getUTCHours() + 5) % 24;
  }
}

// Quiet hours pencere kontrolü — wrap-around destekli (örn. 22-7).
export function isInQuietHours(currentHour: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) {
    return currentHour >= start && currentHour < end;
  }
  // wrap-around (örn. 22 → 7): saat ya >= start ya da < end
  return currentHour >= start || currentHour < end;
}

// Quiet hours bittikten sonraki ilk dakika (Asia/Dushanbe → UTC çevrilmiş).
export function nextWindowEnd(now: Date, endHourDushanbe: number): Date {
  const result = new Date(now);
  // UTC saatinde Dushanbe end hour'una atla
  // Dushanbe = UTC + 5, endHourDushanbe local → endHourUTC = (end - 5 + 24) % 24
  const endHourUTC = (endHourDushanbe - 5 + 24) % 24;
  result.setUTCMinutes(0, 0, 0);
  result.setUTCHours(endHourUTC);
  // Eğer geçmişteyse +1 gün
  if (result.getTime() <= now.getTime()) {
    result.setUTCDate(result.getUTCDate() + 1);
  }
  return result;
}
