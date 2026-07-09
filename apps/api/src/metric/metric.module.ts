import { Module } from '@nestjs/common';
import { MetricService } from './metric.service';

@Module({
  providers: [MetricService],
  exports: [MetricService],
})
export class MetricModule {}
