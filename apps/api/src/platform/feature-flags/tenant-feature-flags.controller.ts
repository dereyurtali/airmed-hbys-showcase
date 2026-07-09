import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../../auth/auth.types';
import { FeatureFlagsService } from './feature-flags.service';

// Tenant-side endpoint: Klinik kullanıcısı kendi tenant'ının flag durumunu
// alır. /api/* prefix'i altında, JwtAuthGuard ile.

@Controller('feature-flags')
@UseGuards(JwtAuthGuard)
export class TenantFeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return this.flags.listForTenant(user.tenantId);
  }
}
