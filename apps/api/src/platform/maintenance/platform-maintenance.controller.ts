import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PlatformRoute } from '../../common/decorators/platform-route.decorator';
import { CurrentPlatformAdmin } from '../auth/decorators/current-platform-admin.decorator';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';
import type { PlatformJwtPayload } from '../auth/platform-auth.types';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { PlatformMaintenanceService } from './platform-maintenance.service';

// #1093 — F6 bakım + duyuru admin REST. Mutasyonlar platform audit'e yazılır.
@PlatformRoute()
@Controller('platform/maintenance')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformMaintenanceController {
  constructor(
    private readonly svc: PlatformMaintenanceService,
    private readonly audit: PlatformAuditService,
  ) {}

  @Get('windows')
  windows() {
    return this.svc.listMaintenance();
  }

  @Post('windows')
  async createWindow(
    @Body()
    body: {
      scope: string;
      targetTenantId?: string;
      message: string;
      startsAt: string;
      endsAt: string;
    },
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
  ) {
    const row = await this.svc.createMaintenance({ ...body, createdById: admin.sub });
    await this.audit.record({
      adminId: admin.sub,
      email: admin.email,
      action: 'platform.maintenance.scheduled',
      entityType: 'maintenance_window',
      entityId: row.id,
    });
    return row;
  }

  @Post('windows/:id/cancel')
  async cancelWindow(@Param('id') id: string, @CurrentPlatformAdmin() admin: PlatformJwtPayload) {
    const row = await this.svc.cancelMaintenance(id);
    await this.audit.record({
      adminId: admin.sub,
      email: admin.email,
      action: 'platform.maintenance.cancelled',
      entityType: 'maintenance_window',
      entityId: id,
    });
    return row;
  }

  @Get('announcements')
  announcements() {
    return this.svc.listAnnouncements();
  }

  @Post('announcements')
  async createAnnouncement(
    @Body()
    body: {
      title: string;
      body: string;
      severity: string;
      scope: string;
      targetTenantIds?: string[];
      publishAt: string;
      expiresAt: string;
    },
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
  ) {
    const row = await this.svc.createAnnouncement({ ...body, createdById: admin.sub });
    await this.audit.record({
      adminId: admin.sub,
      email: admin.email,
      action: 'platform.announcement.published',
      entityType: 'platform_announcement',
      entityId: row.id,
    });
    return row;
  }

  @Post('announcements/:id/archive')
  async archiveAnnouncement(
    @Param('id') id: string,
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
  ) {
    const row = await this.svc.archiveAnnouncement(id);
    await this.audit.record({
      adminId: admin.sub,
      email: admin.email,
      action: 'platform.announcement.archived',
      entityType: 'platform_announcement',
      entityId: id,
    });
    return row;
  }
}
