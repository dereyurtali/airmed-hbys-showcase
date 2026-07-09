import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PlatformRoute } from '../../common/decorators/platform-route.decorator';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';
import { PlatformSecurityService } from './platform-security.service';

// #1090 — Güvenlik olayları REST (salt-okuma; tüm platform rolleri).
@PlatformRoute()
@Controller('platform/security')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformSecurityController {
  constructor(private readonly security: PlatformSecurityService) {}

  @Get('summary')
  summary() {
    return this.security.summary();
  }

  @Get('login-attempts')
  loginAttempts(
    @Query('email') email?: string,
    @Query('ip') ip?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.security.loginAttempts({ email, ip, cursor });
  }

  @Get('locked-users')
  lockedUsers() {
    return this.security.lockedUsers();
  }
}
