import { Module } from '@nestjs/common';
import { PlatformAuditModule } from '../audit/platform-audit.module';
import { PlatformAuthModule } from '../auth/platform-auth.module';
import { FeatureFlagsService } from './feature-flags.service';
import { PlatformFeatureFlagsController } from './platform-feature-flags.controller';
import { TenantFeatureFlagsController } from './tenant-feature-flags.controller';

@Module({
  imports: [PlatformAuditModule, PlatformAuthModule],
  controllers: [PlatformFeatureFlagsController, TenantFeatureFlagsController],
  providers: [FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsModule {}
