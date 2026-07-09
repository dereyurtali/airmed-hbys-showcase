import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { CommissionModule } from '../commission/commission.module';
import { LabThresholdService } from './lab-threshold.service';
import { LabController } from './lab.controller';
import { LabService } from './lab.service';

// S12b — CommissionModule lab başına otomatik hakediş için (müşteri görüşmesi).
// S12c — BillingModule "önce öde sonra hizmet" sıkı engel için.
// S15-PR2 — StorageService global StorageModule'dan inject edilir.
// S15-P3 — LabThresholdService klinik özel referans aralığı yönetimi.
@Module({
  imports: [CommissionModule, BillingModule],
  controllers: [LabController],
  providers: [LabService, LabThresholdService],
  exports: [LabService, LabThresholdService],
})
export class LabModule {}
