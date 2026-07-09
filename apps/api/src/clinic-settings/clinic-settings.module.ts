import { Module } from '@nestjs/common';
import { ClinicLogoController } from './clinic-logo.controller';
import { ClinicLogoService } from './clinic-logo.service';
import { ClinicSettingsService } from './clinic-settings.service';

@Module({
  controllers: [ClinicLogoController],
  providers: [ClinicSettingsService, ClinicLogoService],
  exports: [ClinicSettingsService, ClinicLogoService],
})
export class ClinicSettingsModule {}
