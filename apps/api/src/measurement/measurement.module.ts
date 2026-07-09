import { Module } from '@nestjs/common';
import { CommissionModule } from '../commission/commission.module';
import { MeasurementService } from './measurement.service';

// S12b — CommissionModule ölçüm başına otomatik hakediş için (müşteri görüşmesi).
@Module({
  imports: [CommissionModule],
  providers: [MeasurementService],
  exports: [MeasurementService],
})
export class MeasurementModule {}
