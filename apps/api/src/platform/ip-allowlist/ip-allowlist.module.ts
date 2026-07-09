import { Module } from '@nestjs/common';
import { PlatformAuditModule } from '../audit/platform-audit.module';
import { PlatformIpAllowlistController } from './platform-ip-allowlist.controller';
import { IpAllowlistService } from './ip-allowlist.service';

// #948 (Feature 4) — guard DI'sız + strategy global → PlatformAuthModule import
// EDİLMEZ (circular önlenir). Audit için PlatformAuditModule.
@Module({
  imports: [PlatformAuditModule],
  controllers: [PlatformIpAllowlistController],
  providers: [IpAllowlistService],
})
export class IpAllowlistModule {}
