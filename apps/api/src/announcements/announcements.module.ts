import { Module } from '@nestjs/common';
import { PlatformMaintenanceModule } from '../platform/maintenance/platform-maintenance.module';
import { AnnouncementsController } from './announcements.controller';

// #1093 — Klinik duyuru okuma; PlatformMaintenanceModule'den servisi kullanır.
@Module({
  imports: [PlatformMaintenanceModule],
  controllers: [AnnouncementsController],
})
export class AnnouncementsModule {}
