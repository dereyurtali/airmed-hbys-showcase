import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { CommissionModule } from '../commission/commission.module';
import { PatientModule } from '../patient/patient.module';
import { ExaminationService } from './examination.service';

// S4  — PatientModule doktor-hasta auto-assignment hook için.
// S12b — CommissionModule muayene başına otomatik hakediş için.
// S12c — BillingModule "önce öde sonra hizmet" sıkı engel için.
@Module({
  imports: [PatientModule, CommissionModule, BillingModule],
  providers: [ExaminationService],
  exports: [ExaminationService],
})
export class ExaminationModule {}
