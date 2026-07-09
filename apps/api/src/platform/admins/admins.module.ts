import { Module } from '@nestjs/common';
import { PlatformAuditModule } from '../audit/platform-audit.module';
import { PlatformAdminsController } from './platform-admins.controller';
import { AdminsService } from './admins.service';

// #946 (Feature 3) — guard DI'sız + strategy global → PlatformAuthModule import
// EDİLMEZ (circular önlenir). Audit için PlatformAuditModule.
@Module({
  imports: [PlatformAuditModule],
  controllers: [PlatformAdminsController],
  providers: [AdminsService],
})
export class AdminsModule {}
