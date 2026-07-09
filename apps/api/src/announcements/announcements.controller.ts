import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { PlatformMaintenanceService } from '../platform/maintenance/platform-maintenance.service';

// #1093 — Klinik-tarafı aktif duyuru okuma (tenant JWT). Web login sonrası
// dismissible banner bunu çeker. Global JwtAuthGuard zaten korur (public değil).
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly maintenance: PlatformMaintenanceService) {}

  @Get('active')
  active(@CurrentUser() user: JwtPayload) {
    return this.maintenance.activeAnnouncements(user.tenantId);
  }
}
