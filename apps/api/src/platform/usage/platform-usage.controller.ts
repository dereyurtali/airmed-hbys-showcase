import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PlatformRoute } from '../../common/decorators/platform-route.decorator';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';
import { PlatformUsageService } from './platform-usage.service';

// #1088 — Tenant kullanım & büyüme REST (salt-okuma; tüm platform rolleri).
@PlatformRoute()
@Controller('platform/usage')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformUsageController {
  constructor(private readonly usage: PlatformUsageService) {}

  @Get('summary')
  summary() {
    return this.usage.summary();
  }

  @Get('tenants')
  tenants() {
    return this.usage.tenants();
  }

  @Get('trend')
  trend(@Query('weeks') weeks?: string, @Query('tenantId') tenantId?: string) {
    return this.usage.trend(Number(weeks) || 12, tenantId);
  }
}
