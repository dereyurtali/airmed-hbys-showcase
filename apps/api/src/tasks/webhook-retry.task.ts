import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookService } from '../webhook/webhook.service';

// S14 — v0.1 webhook retry cron port. Her dakika pending|failed status'lü ve
// nextRetryAt <= now() olan delivery'leri toplar, sırayla deliver() çağırır.
// Exponential schedule + dead_letter logic WebhookService.deliver içinde.

const BATCH_SIZE = 50;

@Injectable()
export class WebhookRetryTask {
  private readonly logger = new Logger(WebhookRetryTask.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'webhook-retry' })
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.runOnce();
      if (result.attempted > 0) {
        this.logger.log(
          `webhook-retry: attempted=${result.attempted} delivered=${result.delivered} failed=${result.failed} dead=${result.dead}`,
        );
      }
    } catch (err) {
      this.logger.error(`webhook-retry tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Test'lerden doğrudan çağrılır.
   */
  async runOnce(): Promise<{
    attempted: number;
    delivered: number;
    failed: number;
    dead: number;
  }> {
    const due = await this.webhooks.findDueDeliveryIds(BATCH_SIZE);
    if (due.length === 0) return { attempted: 0, delivered: 0, failed: 0, dead: 0 };

    let delivered = 0;
    let failed = 0;
    let dead = 0;

    for (const { id, tenantId } of due) {
      try {
        await this.prisma.runWithTenant(tenantId, async () => {
          const result = await this.webhooks.deliver(id);
          if (result.status === 'delivered') delivered += 1;
          else if (result.status === 'dead_letter') dead += 1;
          else failed += 1;
        });
      } catch (err) {
        this.logger.warn(`deliver ${id} failed: ${(err as Error).message}`);
        failed += 1;
      }
    }

    return { attempted: due.length, delivered, failed, dead };
  }
}
