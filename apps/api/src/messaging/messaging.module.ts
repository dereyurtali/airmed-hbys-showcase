import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { MessagingAdminService } from './messaging.admin.service';
import { MessagingService } from './messaging.service';
import { MessagingWorker } from './messaging.worker';
import { MockMessageProvider } from './mock-message.provider';
import { HttpSmsProvider } from './http-sms.provider';
import { PatientThreadService } from './patient-thread.service';

// D1 — Messaging module. Provider abstraction + MockMessageProvider (pilot
// default) + trigger service + worker. Production Twilio/WhatsApp PR D1/2'de
// veya pilot deployment'ta gerçek provider register edilir.
// S15-PR19 — PatientThreadService: hasta-bağlı bağlamsal mesajlaşma.
@Module({
  imports: [TenantModule],
  providers: [
    MockMessageProvider,
    HttpSmsProvider,
    MessagingService,
    MessagingWorker,
    MessagingAdminService,
    PatientThreadService,
  ],
  exports: [MessagingService, MessagingAdminService, PatientThreadService],
})
export class MessagingModule {}
