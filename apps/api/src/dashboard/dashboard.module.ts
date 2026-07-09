import { Module } from '@nestjs/common';
import { AppointmentModule } from '../appointment/appointment.module';
import { AuditModule } from '../audit/audit.module';
import { EncounterModule } from '../encounter/encounter.module';
import { RecallModule } from '../recall/recall.module';
import { SurgeryModule } from '../surgery/surgery.module';
import { AdminOverviewService } from './admin-overview.service';
import { DashboardLayoutService } from './dashboard.service';
import { RoleOverviewService } from './role-overview.service';

@Module({
  // #1066 — RoleOverviewService rol Genel Bakış agregatları için mevcut servis
  // katmanını yeniden kullanır (yeni sorgu mantığı yazmaz).
  imports: [AppointmentModule, AuditModule, EncounterModule, RecallModule, SurgeryModule],
  providers: [DashboardLayoutService, AdminOverviewService, RoleOverviewService],
  exports: [DashboardLayoutService, AdminOverviewService, RoleOverviewService],
})
export class DashboardModule {}
