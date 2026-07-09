import { Module } from '@nestjs/common';
import { WebhookModule } from '../webhook/webhook.module';
import { ExchangeRateTask } from './exchange-rate.task';
import { NoShowTask } from './no-show.task';
import { RetentionCleanupTask } from './retention-cleanup.task';
import { WebhookRetryTask } from './webhook-retry.task';

// S14 — v0.1 cron task port. Sistem-genel arka plan işleri:
//   - NoShowTask: EVERY_5_MIN appointment no_show
//   - WebhookRetryTask: EVERY_MINUTE webhook delivery retry
//   - ExchangeRateTask: #419b — günlük NBT USD→TJS kuru (06:00 Duşanbe)
//   - RetentionCleanupTask: #1060 — gecelik operasyonel tablo prune (03:45)
//
// AuditService global (AuditModule @Global), ayrıca import etmeye gerek yok.

@Module({
  imports: [WebhookModule],
  providers: [ExchangeRateTask, NoShowTask, RetentionCleanupTask, WebhookRetryTask],
  exports: [ExchangeRateTask, NoShowTask, RetentionCleanupTask, WebhookRetryTask],
})
export class TasksModule {}
