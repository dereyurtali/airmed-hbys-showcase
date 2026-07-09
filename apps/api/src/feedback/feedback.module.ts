import { Module } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { FeedbackController } from './feedback.controller';
import { GithubIssueService } from './github-issue.service';
import { FeedbackStatusTask } from './feedback-status.task';
import { NotificationModule } from '../notification/notification.module';
import { StorageModule } from '../storage/storage.module';

// I2.3 (#821) — Geri-Bildirim Merkezi backend modülü. + I2.5 (#823) durum poll cron.
@Module({
  imports: [NotificationModule, StorageModule],
  controllers: [FeedbackController],
  providers: [FeedbackService, GithubIssueService, FeedbackStatusTask],
  exports: [FeedbackService],
})
export class FeedbackModule {}
