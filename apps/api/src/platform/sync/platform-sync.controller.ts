import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { PlatformRoute } from '../../common/decorators/platform-route.decorator';
import { CurrentPlatformAdmin } from '../auth/decorators/current-platform-admin.decorator';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';
import type { PlatformJwtPayload } from '../auth/platform-auth.types';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { PlatformSyncService } from './platform-sync.service';

// #1091 — Hibrit senkron izleme REST. Okuma tüm platform rolleri; requeue
// (durum değiştirir) audit'e yazılır.
@PlatformRoute()
@Controller('platform/sync')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformSyncController {
  constructor(
    private readonly sync: PlatformSyncService,
    private readonly audit: PlatformAuditService,
  ) {}

  @Get('summary')
  summary() {
    return this.sync.summary();
  }

  @Get('dead-letter')
  deadLetter(@Query('tenantId') tenantId?: string) {
    return this.sync.deadLetter(tenantId);
  }

  @Get('conflicts')
  conflicts(@Query('tenantId') tenantId?: string) {
    return this.sync.conflicts(tenantId);
  }

  @Post('dead-letter/:id/requeue')
  async requeue(@Param('id') id: string, @CurrentPlatformAdmin() admin: PlatformJwtPayload) {
    const res = await this.sync.requeue(id);
    await this.audit.record({
      adminId: admin.sub,
      email: admin.email,
      action: 'platform.sync.requeue',
      entityType: 'sync_outbox',
      entityId: id,
    });
    return res;
  }
}
