import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { NotificationService } from './notification.service';

// S15b — Notification. SyncModule → SyncGateway (real-time broadcast). İstasyon
// servisleri (encounter/measurement/surgery) NotificationService'i enjekte eder.
@Module({
  imports: [SyncModule],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
