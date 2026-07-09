import { Module } from '@nestjs/common';
import { PlatformAuthModule } from '../auth/platform-auth.module';
import { PlatformAuditModule } from '../audit/platform-audit.module';
import { PlatformMaintenanceController } from './platform-maintenance.controller';
import { PlatformMaintenanceService } from './platform-maintenance.service';

// #1093 — Servisi export eder: klinik-tarafı (setup/status, announcements
// endpoint, bakım guard) aynı okuma yardımcılarını kullanır.
@Module({
  imports: [PlatformAuthModule, PlatformAuditModule],
  controllers: [PlatformMaintenanceController],
  providers: [PlatformMaintenanceService],
  exports: [PlatformMaintenanceService],
})
export class PlatformMaintenanceModule {}
