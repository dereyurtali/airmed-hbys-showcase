import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { EncounterModule } from '../encounter/encounter.module';
import { NotificationModule } from '../notification/notification.module';
import { SyncModule } from '../sync/sync.module';
import { MeasurementModule } from './measurement.module';
import { MeasurementOrderService } from './measurement-order.service';

// S15c — Ölçüm sipariş akışı.
// S15-PR12 — SyncModule WS 'measurement.ready' broadcast için.
@Module({
  imports: [MeasurementModule, NotificationModule, BillingModule, EncounterModule, SyncModule],
  providers: [MeasurementOrderService],
  exports: [MeasurementOrderService],
})
export class MeasurementOrderModule {}
