import { Module } from '@nestjs/common';
import { PlatformAuthModule } from '../auth/platform-auth.module';
import { PlatformMetricsController } from './platform-metrics.controller';
import { PlatformMetricsService } from './platform-metrics.service';
import { PlatformDbStatsService } from './platform-db-stats.service';

@Module({
  imports: [PlatformAuthModule],
  controllers: [PlatformMetricsController],
  providers: [PlatformMetricsService, PlatformDbStatsService],
})
export class PlatformMetricsModule {}
