import { Module } from '@nestjs/common';
import { ClinicSettingsModule } from '../clinic-settings/clinic-settings.module';
import { PlatformMaintenanceModule } from '../platform/maintenance/platform-maintenance.module';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';

@Module({
  imports: [ClinicSettingsModule, PlatformMaintenanceModule],
  controllers: [SetupController],
  providers: [SetupService],
})
export class SetupModule {}
