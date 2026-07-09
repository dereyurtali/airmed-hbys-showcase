import { Module } from '@nestjs/common';
import { PlatformAuthModule } from '../auth/platform-auth.module';
import { PlatformHealthController } from './health.controller';
import { PlatformHealthService } from './health.service';

@Module({
  imports: [PlatformAuthModule],
  controllers: [PlatformHealthController],
  providers: [PlatformHealthService],
})
export class PlatformHealthModule {}
