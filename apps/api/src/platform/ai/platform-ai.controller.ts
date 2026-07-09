import { Controller, Get, UseGuards } from '@nestjs/common';
import { PlatformRoute } from '../../common/decorators/platform-route.decorator';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';
import { PlatformAiService } from './platform-ai.service';

// #1089 — AI asistan platform rollup REST (salt-okuma; tüm platform rolleri).
// KVKK: hasta mesaj içeriği DÖNMEZ — yalnız sayısal metrik + hata metadata.
@PlatformRoute()
@Controller('platform/ai')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformAiController {
  constructor(private readonly ai: PlatformAiService) {}

  @Get('summary')
  summary() {
    return this.ai.summary();
  }

  @Get('tenants')
  tenants() {
    return this.ai.tenants();
  }

  @Get('errors')
  errors() {
    return this.ai.recentErrors();
  }
}
