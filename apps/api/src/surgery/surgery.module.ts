import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { EncounterModule } from '../encounter/encounter.module';
import { IolModule } from '../iol/iol.module';
import { MessagingModule } from '../messaging/messaging.module';
import { NotificationModule } from '../notification/notification.module';
import { PatientModule } from '../patient/patient.module';
import { PostOpModule } from '../post-op/post-op.module';
import { SafetyChecklistService } from './safety-checklist.service';
import { SurgeryService } from './surgery.service';

// B1 PR 3 — markCompleted hook PostOpService.scheduleFollowUps çağırıyor.
// D1 PR 2 — markComplication → COMPLICATION_DOCTOR_ALERT (mandatory) fire.
// S4 — PatientModule doktor-hasta auto-assignment hook için.
// S12c — BillingModule "önce öde sonra hizmet" sıkı engel için.
// S15 — Notification + Encounter: ameliyat satışa devir (handoff bildirimi + ziyaret istasyonu).
// S15-PR3 — SafetyChecklistService WHO 21-item; PR9 SurgeryDayCenterPage
// intra-op başlatma kapısı için kullanılır.
// Delta audit C-2 — IolModule registerLens'in `consumeForSurgery` çağrısı için.
@Module({
  imports: [
    PostOpModule,
    MessagingModule,
    PatientModule,
    BillingModule,
    NotificationModule,
    EncounterModule,
    IolModule,
  ],
  providers: [SurgeryService, SafetyChecklistService],
  exports: [SurgeryService, SafetyChecklistService],
})
export class SurgeryModule {}
