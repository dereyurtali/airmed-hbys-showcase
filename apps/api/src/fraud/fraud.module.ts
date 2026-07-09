import { Module } from '@nestjs/common';
import { FraudDetectionService } from './fraud.service';

@Module({
  providers: [FraudDetectionService],
  exports: [FraudDetectionService],
})
export class FraudModule {}
