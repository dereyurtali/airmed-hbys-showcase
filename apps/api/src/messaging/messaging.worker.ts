import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MessagingService } from './messaging.service';

// D1 — Mesaj delivery worker. 10sn periyot, PENDING + scheduledAt <= now
// satırları batch'le dispatch eder. Bull queue YOK; A12 sync worker'la
// aynı pattern. In-process kilit ile paralel tick engeli.

@Injectable()
export class MessagingWorker {
  private readonly logger = new Logger(MessagingWorker.name);
  private running = false;

  constructor(private readonly messaging: MessagingService) {}

  @Cron('*/10 * * * * *', { name: 'messaging-dispatcher' })
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.messaging.processPendingBatch();
      if (result.sent > 0 || result.failed > 0) {
        this.logger.log(`messaging: sent=${result.sent} failed=${result.failed}`);
      }
    } catch (err) {
      this.logger.error(`messaging worker tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
