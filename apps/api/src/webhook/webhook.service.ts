import { createHash, createHmac, randomBytes } from 'crypto';
import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { assertPublicWebhookUrl } from './ssrf-guard';
import type {
  WebhookCreateInput,
  WebhookDeliveryListQuery,
  WebhookEvent,
  WebhookUpdateInput,
} from './webhook.schemas';

// S14 — v0.1 webhook subscription + delivery service.
//
// Akış:
//   1. Admin webhook tanımlar (URL + event[]). Secret otomatik üretilir.
//   2. Domain event olduğunda emit() çağrılır → eşleşen webhook'lar için
//      WebhookDelivery 'pending' oluşur (nextRetryAt=now()).
//   3. Cron retryWebhooks her dakika 'pending' veya 'failed' && nextRetryAt
//      <=now()'ları çeker → deliver() çağırır.
//   4. deliver() HMAC-SHA256 imzalı POST → 2xx → delivered; aksi halde retry
//      planına göre sıraya alır. Schedule: [1m, 5m, 30m, 2h, 24h]. 5. fail →
//      dead_letter (artık denenmez).
//
// Güvenlik: webhook URL'leri https olmalı (schema enforce), secret kayda
// gizli yazılır (UI rotate yapabilir), payload her gönderide HMAC ile imzalı.
//
// emit() PrismaService.scoped'i kullanır — caller'ın tenant context'i set
// edilmiş olmalı. emit() arka planda çağrılırken (worker, cron) tenantId
// elle verilir ve runWithTenant ile sarmalanır.

const RETRY_SCHEDULE_SECONDS: readonly number[] = [
  60, // 1m
  5 * 60, // 5m
  30 * 60, // 30m
  2 * 60 * 60, // 2h
  24 * 60 * 60, // 24h
];
const MAX_ATTEMPTS = RETRY_SCHEDULE_SECONDS.length; // 5
const DELIVERY_TIMEOUT_MS = 10_000;

interface Actor {
  id: string;
  roles: readonly string[];
}

export interface DeliveryResult {
  ok: boolean;
  status: 'delivered' | 'failed' | 'dead_letter';
  responseStatus?: number;
  responseBody?: string;
  error?: string;
}

function generateSecret(): string {
  return randomBytes(32).toString('hex'); // 64 char hex
}

function signPayload(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function deliveryIdHash(
  tenantId: string,
  webhookId: string,
  event: string,
  payload: unknown,
): string {
  // Idempotency: aynı event + payload aynı webhook'a iki kez emit edilirse
  // tek delivery üretmek için stable hash. Şu an deliveryId'yi auto-gen Prisma
  // veriyor; bu fonksiyon ileri faz için.
  const body = JSON.stringify({ tenantId, webhookId, event, payload });
  return createHash('sha256').update(body).digest('hex');
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ---------------- Admin CRUD ----------------

  async list(actor: Actor) {
    this.assertAdmin(actor);
    return this.prisma.scoped.webhook.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, actor: Actor) {
    this.assertAdmin(actor);
    const row = await this.prisma.scoped.webhook.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Webhook bulunamadı');
    return row;
  }

  async create(input: WebhookCreateInput, actor: Actor) {
    this.assertAdmin(actor);
    const tenantId = this.tenantContext.requireTenantId();
    const secret = generateSecret();
    return this.prisma.scoped.webhook.create({
      data: {
        tenantId,
        name: input.name,
        url: input.url,
        secret,
        events: input.events,
        createdById: actor.id,
      },
    });
  }

  async update(id: string, input: WebhookUpdateInput, actor: Actor) {
    await this.findById(id, actor);
    return this.prisma.scoped.webhook.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.events !== undefined ? { events: input.events } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
  }

  async remove(id: string, actor: Actor) {
    await this.findById(id, actor);
    await this.prisma.scoped.webhook.delete({ where: { id } });
    return { ok: true as const };
  }

  /**
   * Test fire — admin UI'dan manuel olarak bir webhook'a örnek payload yollar.
   * Idempotency: gerçek event akışından bağımsız, ayrı delivery oluşturur.
   */
  async testFire(id: string, event: WebhookEvent, actor: Actor) {
    const webhook = await this.findById(id, actor);
    if (!webhook.isActive) throw new ForbiddenException('Webhook pasif — önce etkinleştirin');
    const tenantId = this.tenantContext.requireTenantId();
    const delivery = await this.prisma.scoped.webhookDelivery.create({
      data: {
        tenantId,
        webhookId: id,
        event,
        payload: { test: true, firedBy: actor.id, ts: new Date().toISOString() },
        status: 'pending',
        nextRetryAt: new Date(),
      },
    });
    return delivery;
  }

  // ---------------- Delivery list (admin UI) ----------------

  async listDeliveries(query: WebhookDeliveryListQuery, actor: Actor) {
    this.assertAdmin(actor);
    const where: Prisma.WebhookDeliveryWhereInput = {
      ...(query.webhookId && { webhookId: query.webhookId }),
      ...(query.status && { status: query.status }),
    };
    const [items, total] = await Promise.all([
      this.prisma.scoped.webhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.scoped.webhookDelivery.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  // ---------------- Internal emit (other services çağırır) ----------------

  /**
   * Domain event için eşleşen webhook'lara delivery kaydı oluşturur. Caller'ın
   * tenant context'i set edilmiş olmalı (scoped client).
   *
   * Idempotency: aynı (webhookId, event, payload) tekrar emit edilirse ikinci
   * kayıt da oluşur (caller bilinçliyse). Şu an deduplication kuralı yok;
   * payload'da unique business key (örn. appointmentId+timestamp) gönderilerek
   * tüketici tarafında handle edilir.
   */
  async emit(event: WebhookEvent, payload: Record<string, unknown>): Promise<number> {
    const tenantId = this.tenantContext.requireTenantId();
    const webhooks = await this.prisma.scoped.webhook.findMany({
      where: { isActive: true, events: { has: event } },
      select: { id: true },
    });
    if (webhooks.length === 0) return 0;

    await this.prisma.scoped.webhookDelivery.createMany({
      data: webhooks.map((w) => ({
        tenantId,
        webhookId: w.id,
        event,
        payload: payload as Prisma.InputJsonValue,
        status: 'pending',
        nextRetryAt: new Date(),
      })),
    });
    this.logger.log(`webhook.emit ${event} → ${webhooks.length} delivery`);
    return webhooks.length;
  }

  // ---------------- Delivery (cron çağırır) ----------------

  /**
   * Tek delivery'yi POST eder ve sonucuna göre status'ünü günceller. Cron
   * worker bu metodu sırayla çağırır (paralelizm: ileri faz; pilot için seri).
   *
   * NOT: Bu metod kendi tenant context'ini set etmez. Caller (cron task)
   * her delivery için runWithTenant(deliveryRecord.tenantId) içinde çağırır.
   */
  async deliver(deliveryId: string): Promise<DeliveryResult> {
    const delivery = await this.prisma.scoped.webhookDelivery.findFirst({
      where: { id: deliveryId },
      include: { webhook: { select: { id: true, url: true, secret: true, isActive: true } } },
    });
    if (!delivery) throw new NotFoundException('Delivery bulunamadı');

    if (delivery.status === 'delivered' || delivery.status === 'dead_letter') {
      return {
        ok: delivery.status === 'delivered',
        status: delivery.status as 'delivered' | 'dead_letter',
      };
    }
    if (!delivery.webhook.isActive) {
      // Webhook pasifleştirilmiş — yeniden denenmesin
      await this.prisma.scoped.webhookDelivery.update({
        where: { id: deliveryId },
        data: { status: 'dead_letter', lastError: 'Webhook deactivated', nextRetryAt: null },
      });
      return { ok: false, status: 'dead_letter', error: 'Webhook deactivated' };
    }

    const body = JSON.stringify({
      id: delivery.id,
      event: delivery.event,
      tenantId: delivery.tenantId,
      payload: delivery.payload,
      sentAt: new Date().toISOString(),
    });
    const signature = signPayload(delivery.webhook.secret, body);

    let result: DeliveryResult;
    try {
      // #937 — SSRF guard: https doğrulanmış URL bile private/loopback IP'ye
      // çözülebilir (metadata endpoint vb.). Delivery öncesi hostname çöz + reddet.
      await assertPublicWebhookUrl(delivery.webhook.url);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
      const response = await fetch(delivery.webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${signature}`,
          'X-Webhook-Event': delivery.event,
          'X-Webhook-Delivery': delivery.id,
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const responseBody = (await response.text()).slice(0, 900);
      if (response.ok) {
        result = { ok: true, status: 'delivered', responseStatus: response.status, responseBody };
      } else {
        result = {
          ok: false,
          status: 'failed',
          responseStatus: response.status,
          responseBody,
        };
      }
    } catch (err) {
      const message = (err as Error).message || 'unknown';
      result = { ok: false, status: 'failed', error: message.slice(0, 900) };
    }

    // Sonuca göre kayıt güncelle
    const nextAttempt = delivery.attemptCount + 1;
    if (result.ok) {
      await this.prisma.scoped.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'delivered',
          attemptCount: nextAttempt,
          deliveredAt: new Date(),
          lastResponse: result.responseBody?.slice(0, 900) ?? null,
          lastError: null,
          nextRetryAt: null,
        },
      });
      return result;
    }

    // Failed — schedule next retry or dead_letter
    if (nextAttempt >= MAX_ATTEMPTS) {
      await this.prisma.scoped.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'dead_letter',
          attemptCount: nextAttempt,
          lastResponse: result.responseBody?.slice(0, 900) ?? null,
          lastError: result.error?.slice(0, 900) ?? null,
          nextRetryAt: null,
        },
      });
      return { ...result, status: 'dead_letter' };
    }

    const delaySec = RETRY_SCHEDULE_SECONDS[nextAttempt];
    const nextRetryAt = new Date(Date.now() + delaySec * 1000);
    await this.prisma.scoped.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'failed',
        attemptCount: nextAttempt,
        lastResponse: result.responseBody?.slice(0, 900) ?? null,
        lastError: result.error?.slice(0, 900) ?? null,
        nextRetryAt,
      },
    });
    return result;
  }

  /**
   * Cron worker'ı için: pending|failed && nextRetryAt<=now() olan delivery
   * ID'lerini döner. Cross-tenant: caller tenant scope dışındadır (tenant_id
   * kolonunu select eder, sonra her delivery için runWithTenant çağırır).
   */
  async findDueDeliveryIds(limit: number): Promise<Array<{ id: string; tenantId: string }>> {
    return this.prisma.webhookDelivery.findMany({
      where: {
        status: { in: ['pending', 'failed'] },
        nextRetryAt: { lte: new Date() },
      },
      select: { id: true, tenantId: true },
      orderBy: { nextRetryAt: 'asc' },
      take: limit,
    });
  }

  // ---------------- Helpers ----------------

  private assertAdmin(actor: Actor): void {
    if (!actor.roles.includes('yonetici')) {
      throw new ForbiddenException('Yalnız yönetici webhook yönetebilir');
    }
  }
}

// Test'lerden de kullanılabilsin (HMAC doğrulama assertion'ları için)
export { signPayload, deliveryIdHash };
