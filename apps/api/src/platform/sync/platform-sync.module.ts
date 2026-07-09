import { Module } from '@nestjs/common';
import { PlatformAuthModule } from '../auth/platform-auth.module';
import { PlatformAuditModule } from '../audit/platform-audit.module';
import { PlatformSyncController } from './platform-sync.controller';
import { PlatformSyncService } from './platform-sync.service';

@Module({
  imports: [PlatformAuthModule, PlatformAuditModule],
  controllers: [PlatformSyncController],
  providers: [PlatformSyncService],
})
export class PlatformSyncModule {}
