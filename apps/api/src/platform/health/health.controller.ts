import { Controller, Get, UseGuards } from '@nestjs/common';
import { PlatformRoute } from '../../common/decorators/platform-route.decorator';
import { CurrentPlatformAdmin } from '../auth/decorators/current-platform-admin.decorator';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';
import type { PlatformJwtPayload } from '../auth/platform-auth.types';
import { PlatformHealthService } from './health.service';

@PlatformRoute()
@Controller('platform/health')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformHealthController {
  constructor(private readonly health: PlatformHealthService) {}

  @Get('snapshot')
  async snapshot(@CurrentPlatformAdmin() admin: PlatformJwtPayload) {
    return this.health.snapshot({ id: admin.sub, role: admin.role });
  }
}
