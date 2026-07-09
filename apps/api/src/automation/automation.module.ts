import { Module } from '@nestjs/common';
import { AppointmentModule } from '../appointment/appointment.module';
import { DoctorModule } from '../doctor/doctor.module';
import { NotificationModule } from '../notification/notification.module';
import { PatientModule } from '../patient/patient.module';
import { AdminPrismaService } from '../prisma/admin-prisma.service';
import { AgentOrchestratorService } from './agent-orchestrator.service';
import { AgentToolsService } from './agent-tools.service';
import { AutomationAdminService } from './automation-admin.service';
import { AutomationController } from './automation.controller';
import { AutomationIngestService, AUTOMATION_ADMIN_PRISMA } from './automation-ingest.service';
import { AutomationWorker } from './automation.worker';
import { ChatwootAdapter } from './channel-adapter';
import { SecretCryptoService } from './secret-crypto.service';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenRouterProvider } from './providers/openrouter.provider';

// EPIC #1018 — AI Hasta Asistanı modülü.
// Chatwoot webhook → ingest (BYPASSRLS admin client) → DB-kuyruk → worker →
// orkestratör (üç fazlı: oku-tx / model döngüsü tx'siz / yaz-tx) → tool'lar
// doğrudan servis katmanı (Availability/Appointment/Patient/Doctor) →
// ChatwootAdapter ile cevap. Yönetici yüzeyi tRPC automation router'ından.
@Module({
  imports: [AppointmentModule, PatientModule, DoctorModule, NotificationModule],
  controllers: [AutomationController],
  providers: [
    // #1065 — paylaşımlı AdminPrismaService (tek havuz); modül-özel client açılmaz.
    {
      provide: AUTOMATION_ADMIN_PRISMA,
      useExisting: AdminPrismaService,
    },
    AutomationIngestService,
    AutomationAdminService,
    SecretCryptoService,
    AutomationWorker,
    ChatwootAdapter,
    AgentToolsService,
    AgentOrchestratorService,
    AnthropicProvider,
    OpenRouterProvider,
  ],
  exports: [AutomationAdminService],
})
export class AutomationModule {}
