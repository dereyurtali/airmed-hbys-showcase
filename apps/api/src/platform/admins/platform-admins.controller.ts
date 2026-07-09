import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PlatformRoute } from '../../common/decorators/platform-route.decorator';
import { CurrentPlatformAdmin } from '../auth/decorators/current-platform-admin.decorator';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';
import type { PlatformJwtPayload } from '../auth/platform-auth.types';
import { AdminIdParamDto, CreateAdminDto, UpdateAdminRoleDto } from './admins.dto';
import { AdminsService } from './admins.service';

// #946 (Feature 3) — Platform admin CRUD. list okuma tüm rollere; mutasyonlar
// service-layer assertOwner (yalnız platform_owner). Guard DI'sız → modül
// PlatformAuthModule import etmez (circular önlenir).
@PlatformRoute()
@Controller('platform/admins')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformAdminsController {
  constructor(private readonly admins: AdminsService) {}

  @Get()
  async list(@CurrentPlatformAdmin() admin: PlatformJwtPayload) {
    return this.admins.list({ id: admin.sub, email: admin.email, role: admin.role });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateAdminDto,
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
    @Req() req: Request,
  ) {
    return this.admins.create(
      dto,
      { id: admin.sub, email: admin.email, role: admin.role },
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );
  }

  @Patch(':id/role')
  async updateRole(
    @Param() params: AdminIdParamDto,
    @Body() dto: UpdateAdminRoleDto,
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
    @Req() req: Request,
  ) {
    return this.admins.updateRole(
      params.id,
      dto,
      { id: admin.sub, email: admin.email, role: admin.role },
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(
    @Param() params: AdminIdParamDto,
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
    @Req() req: Request,
  ) {
    return this.admins.deactivate(
      params.id,
      { id: admin.sub, email: admin.email, role: admin.role },
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );
  }

  @Post(':id/reset-totp')
  @HttpCode(HttpStatus.OK)
  async resetTotp(
    @Param() params: AdminIdParamDto,
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
    @Req() req: Request,
  ) {
    return this.admins.resetTotp(
      params.id,
      { id: admin.sub, email: admin.email, role: admin.role },
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );
  }
}
