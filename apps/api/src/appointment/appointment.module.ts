import { Module } from '@nestjs/common';
import { EncounterModule } from '../encounter/encounter.module';
import { MessagingModule } from '../messaging/messaging.module';
import { PatientModule } from '../patient/patient.module';
import { AppointmentService } from './appointment.service';
import { AvailabilityService } from './availability.service';

// D1 PR 2 — A6 randevu entegrasyonu: create → APPOINTMENT_CONFIRMATION +
// 24sa hatırlatma queue; cancel transition → APPOINTMENT_CANCELLED.
// S4 — PatientModule (PatientDoctorService) doktor-hasta auto-assignment hook.
// S15 — EncounterModule: check-in → ziyaret aç (tek yön: Appointment → Encounter).
@Module({
  imports: [MessagingModule, PatientModule, EncounterModule],
  providers: [AppointmentService, AvailabilityService],
  exports: [AppointmentService, AvailabilityService],
})
export class AppointmentModule {}
