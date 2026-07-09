import { Module } from '@nestjs/common';
import { PlatformAuthModule } from '../auth/platform-auth.module';
import { PlatformUsageController } from './platform-usage.controller';
import { PlatformUsageService } from './platform-usage.service';

@Module({
  imports: [PlatformAuthModule],
  controllers: [PlatformUsageController],
  providers: [PlatformUsageService],
})
export class PlatformUsageModule {}
