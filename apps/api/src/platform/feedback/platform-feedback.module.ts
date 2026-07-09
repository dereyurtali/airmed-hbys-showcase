import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PlatformAuditModule } from '../audit/platform-audit.module';
import { PlatformAuthModule } from '../auth/platform-auth.module';
import { PlatformFeedbackController } from './platform-feedback.controller';
import { PlatformFeedbackService } from './platform-feedback.service';

@Module({
  imports: [PrismaModule, PlatformAuthModule, PlatformAuditModule],
  controllers: [PlatformFeedbackController],
  providers: [PlatformFeedbackService],
})
export class PlatformFeedbackModule {}
