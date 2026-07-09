import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PlatformRoute } from '../../common/decorators/platform-route.decorator';
import { CurrentPlatformAdmin } from '../auth/decorators/current-platform-admin.decorator';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';
import type { PlatformJwtPayload } from '../auth/platform-auth.types';
import {
  CreateFlagDto,
  FlagKeyParamDto,
  FlagTenantParamDto,
  SetOverrideDto,
  UpdateFlagDto,
} from './feature-flags.dto';
import { FeatureFlagsService } from './feature-flags.service';

@PlatformRoute()
@Controller('platform/feature-flags')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformFeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get()
  async list(@CurrentPlatformAdmin() admin: PlatformJwtPayload) {
    return this.flags.listDefinitionsWithStats({
      id: admin.sub,
      email: admin.email,
      role: admin.role,
    });
  }

  @Get(':key/overrides')
  async listOverrides(
    @Param() params: FlagKeyParamDto,
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
  ) {
    return this.flags.listOverrides(params.key, {
      id: admin.sub,
      email: admin.email,
      role: admin.role,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateFlagDto,
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
    @Req() req: Request,
  ) {
    return this.flags.createDefinition(
      dto,
      { id: admin.sub, email: admin.email, role: admin.role },
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );
  }

  @Patch(':key')
  async update(
    @Param() params: FlagKeyParamDto,
    @Body() dto: UpdateFlagDto,
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
    @Req() req: Request,
  ) {
    return this.flags.updateDefinition(
      params.key,
      dto,
      { id: admin.sub, email: admin.email, role: admin.role },
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );
  }

  @Put(':key/tenant/:tenantId')
  async setOverride(
    @Param() params: FlagTenantParamDto,
    @Body() dto: SetOverrideDto,
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
    @Req() req: Request,
  ) {
    return this.flags.setOverride(
      params.key,
      params.tenantId,
      dto,
      { id: admin.sub, email: admin.email, role: admin.role },
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );
  }

  @Delete(':key/tenant/:tenantId')
  @HttpCode(HttpStatus.OK)
  async clearOverride(
    @Param() params: FlagTenantParamDto,
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
    @Req() req: Request,
  ) {
    return this.flags.clearOverride(
      params.key,
      params.tenantId,
      { id: admin.sub, email: admin.email, role: admin.role },
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );
  }
}
