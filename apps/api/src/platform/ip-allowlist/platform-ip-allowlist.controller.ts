import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PlatformRoute } from '../../common/decorators/platform-route.decorator';
import { CurrentPlatformAdmin } from '../auth/decorators/current-platform-admin.decorator';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';
import type { PlatformJwtPayload } from '../auth/platform-auth.types';
import { AddCidrDto, CidrIdParamDto } from './ip-allowlist.dto';
import { IpAllowlistService } from './ip-allowlist.service';

// #948 (Feature 4) — IP allowlist yönetimi. list okuma tüm rollere; add/remove
// yalnız platform_owner (service assertOwner). Guard DI'sız → circular yok.
@PlatformRoute()
@Controller('platform/ip-allowlist')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformIpAllowlistController {
  constructor(private readonly svc: IpAllowlistService) {}

  @Get()
  async list(@CurrentPlatformAdmin() admin: PlatformJwtPayload) {
    return this.svc.list({ id: admin.sub, email: admin.email, role: admin.role });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async add(
    @Body() dto: AddCidrDto,
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
    @Req() req: Request,
  ) {
    return this.svc.add(
      dto,
      { id: admin.sub, email: admin.email, role: admin.role },
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param() params: CidrIdParamDto,
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
    @Req() req: Request,
  ) {
    return this.svc.remove(
      params.id,
      { id: admin.sub, email: admin.email, role: admin.role },
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );
  }
}
