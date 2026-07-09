import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
  CreateTenantDto,
  SuspendTenantDto,
  TenantIdParamDto,
  TenantListQueryDto,
  UpdateTenantDto,
} from './tenants.dto';
import { PlatformTenantsService } from './tenants.service';

// F3 Tenants yönetimi — platform admin REST endpoint'leri.
//
// Tüm endpoint'ler `/platform/tenants/*` altında. JWT guard her endpoint'te;
// @Public() YOK. Yetki kontrolü servis seviyesinde (assertWriter rol check).

@PlatformRoute()
@Controller('platform/tenants')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformTenantsController {
  constructor(private readonly tenants: PlatformTenantsService) {}

  @Get()
  async list(@Query() query: TenantListQueryDto) {
    return this.tenants.list(query);
  }

  @Get(':id')
  async findOne(@Param() params: TenantIdParamDto) {
    return this.tenants.findById(params.id);
  }

  @Get(':id/stats')
  async stats(@Param() params: TenantIdParamDto) {
    return this.tenants.stats(params.id);
  }

  // F7 — Admin UI'da tenant detay sayfasında kullanıcı listesi + her satırda
  // "Impersonate" butonu için. Sadece aktif (deleted_at IS NULL) kullanıcılar.
  @Get(':id/users')
  async users(@Param() params: TenantIdParamDto) {
    return this.tenants.listUsers(params.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateTenantDto,
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
    @Req() req: Request,
  ) {
    return this.tenants.create(
      dto,
      { id: admin.sub, email: admin.email, role: admin.role },
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );
  }

  @Patch(':id')
  async update(
    @Param() params: TenantIdParamDto,
    @Body() dto: UpdateTenantDto,
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
    @Req() req: Request,
  ) {
    return this.tenants.update(
      params.id,
      dto,
      { id: admin.sub, email: admin.email, role: admin.role },
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  async suspend(
    @Param() params: TenantIdParamDto,
    @Body() dto: SuspendTenantDto,
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
    @Req() req: Request,
  ) {
    return this.tenants.suspend(
      params.id,
      dto,
      { id: admin.sub, email: admin.email, role: admin.role },
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  async reactivate(
    @Param() params: TenantIdParamDto,
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
    @Req() req: Request,
  ) {
    return this.tenants.reactivate(
      params.id,
      { id: admin.sub, email: admin.email, role: admin.role },
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );
  }
}
