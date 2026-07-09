import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PlatformRoute } from '../../common/decorators/platform-route.decorator';
import { CurrentPlatformAdmin } from '../auth/decorators/current-platform-admin.decorator';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';
import type { PlatformJwtPayload } from '../auth/platform-auth.types';
import {
  ImpersonationHistoryQueryDto,
  ImpersonationIdParamDto,
  StartImpersonationDto,
} from './impersonation.dto';
import { ImpersonationService } from './impersonation.service';

// F4 — Tenant impersonation endpoint'leri.
// Tüm route'lar `/platform/impersonate/*` altında, platform JWT guard zorunlu.
// Üç platform rolü de start/stop yapabilir; forceStop sadece platform_owner.

@PlatformRoute()
@Controller('platform/impersonate')
@UseGuards(PlatformJwtAuthGuard)
export class ImpersonationController {
  constructor(private readonly impersonation: ImpersonationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async start(
    @Body() dto: StartImpersonationDto,
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
    @Req() req: Request,
  ) {
    return this.impersonation.start({
      targetUserId: dto.targetUserId,
      reason: dto.reason,
      durationMin: dto.durationMin,
      admin,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
  }

  @Post('stop')
  @HttpCode(HttpStatus.OK)
  async stop(@CurrentPlatformAdmin() admin: PlatformJwtPayload, @Req() req: Request) {
    return this.impersonation.stopOwnActive(admin, req.ip ?? null);
  }

  @Post(':id/force-stop')
  @HttpCode(HttpStatus.OK)
  async forceStop(
    @Param() params: ImpersonationIdParamDto,
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
    @Req() req: Request,
  ) {
    return this.impersonation.forceStop(params.id, admin, req.ip ?? null);
  }

  @Get('active')
  async listActive(@CurrentPlatformAdmin() admin: PlatformJwtPayload) {
    return this.impersonation.listActive(admin);
  }

  @Get('history')
  async listHistory(
    @Query() query: ImpersonationHistoryQueryDto,
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
  ) {
    return this.impersonation.listHistory(admin, query);
  }
}
