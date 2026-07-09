import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SyncService } from './sync.service';

// A12 — Sync worker. Her 10 saniyede bir outbox batch'i karşı node'a iletir.
//
// Disabled if SYNC_PEER_URL boş (single-node pilot deployment).
// İki paralel run'ı engellemek için basit in-process kilit (Cron zaten
// process-level, kümede sadece tek instance varsayımı).

@Injectable()
export class SyncWorker {
  private readonly logger = new Logger(SyncWorker.name);
  private running = false;

  constructor(private readonly sync: SyncService) {}

  @Cron('*/10 * * * * *', { name: 'sync-outbox-worker' })
  async tick(): Promise<void> {
    if (!this.sync.isPeerConfigured()) return; // disabled
    if (this.running) return; // skip if previous tick still running
    this.running = true;
    try {
      const result = await this.sync.runOutboundSync();
      if (result.sent > 0 || result.failed > 0) {
        this.logger.log(`sync: sent=${result.sent} failed=${result.failed}`);
      }
    } catch (err) {
      this.logger.error(`sync worker tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  // #421 + #934 — Günlük outbox hijyeni. (1) Teslim edilmiş (synced_at set) eski
  // satırları sil. (2) #934 Dormant: peer YOKKEN synced_at IS NULL satırlar hiç
  // synced olmaz → yaş-bazlı buda (aksi halde single-node kutuda sınırsız
  // birikir). (3) Outbox derinlik metriğini logla (operasyon + #928 monitör).
  @Cron('0 30 3 * * *', { name: 'sync-outbox-prune' })
  async prune(): Promise<void> {
    try {
      const deleted = await this.sync.pruneSyncedOutbox();
      if (deleted > 0) this.logger.log(`sync outbox prune: removed ${deleted} synced rows`);

      const dormantDeleted = await this.sync.pruneDormantOutbox();
      if (dormantDeleted > 0) {
        this.logger.log(
          `sync outbox dormant prune: removed ${dormantDeleted} unsynced peer-less rows`,
        );
      }

      const depth = await this.sync.outboxDepth();
      this.logger.log(
        `sync outbox depth: total=${depth.total} unsynced=${depth.unsynced} failed=${depth.failed}`,
      );
    } catch (err) {
      this.logger.error(`sync outbox prune failed: ${(err as Error).message}`);
    }
  }
}
