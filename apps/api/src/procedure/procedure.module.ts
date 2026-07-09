import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ConsumableModule } from '../consumable/consumable.module';
import { ProcedureService } from './procedure.service';

// Delta audit C-1 — BillingModule "önce öde sonra hizmet" assertPaidSession
// (procedure category) için zorunlu (examination/lab/surgery paritesi).
// #372 — ConsumableModule: prosedür sonrası sarf malzeme stok düşümü.
@Module({
  imports: [BillingModule, ConsumableModule],
  providers: [ProcedureService],
  exports: [ProcedureService],
})
export class ProcedureModule {}
