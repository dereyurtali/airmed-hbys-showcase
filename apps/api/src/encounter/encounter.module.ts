import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { EncounterService } from './encounter.service';

// S15 — Encounter (ziyaret akışı). BillingModule → InvoiceService.hasPaidSession
// (açılış stage'i + ödeme kapıları). AppointmentModule check-in'de bu modülü
// import edip EncounterService.open çağırır (tek yön: Appointment → Encounter).
@Module({
  imports: [BillingModule],
  providers: [EncounterService],
  exports: [EncounterService],
})
export class EncounterModule {}
