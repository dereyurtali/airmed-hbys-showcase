import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PlatformAuthModule } from '../platform/auth/platform-auth.module';
import { SyncConflictsController } from './sync-conflicts.controller';
import { SyncGateway } from './sync.gateway';
import { SyncReceiveController } from './sync-receive.controller';
import { SyncStatusController } from './sync-status.controller';
import { SyncService } from './sync.service';
import { SyncWorker } from './sync.worker';

// ScheduleModule.forRoot() app.module'da bir kez register edilmiş; burada
// tekrarlamıyoruz (@Cron decorator'ları yine çalışır).
// PlatformAuthModule conflicts controller'ı için (PlatformJwtAuthGuard).
// JwtModule SyncGateway handshake'inde tenant JWT doğrulamak için.
@Module({
  imports: [PlatformAuthModule, JwtModule.register({})],
  controllers: [SyncReceiveController, SyncConflictsController, SyncStatusController],
  providers: [SyncService, SyncWorker, SyncGateway],
  exports: [SyncService, SyncGateway],
})
export class SyncModule {}
