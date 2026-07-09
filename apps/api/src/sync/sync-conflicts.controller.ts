import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsIn } from 'class-validator';
import { PlatformRoute } from '../common/decorators/platform-route.decorator';
import { CurrentPlatformAdmin } from '../platform/auth/decorators/current-platform-admin.decorator';
import { PlatformJwtAuthGuard } from '../platform/auth/guards/platform-jwt-auth.guard';
import type { PlatformJwtPayload } from '../platform/auth/platform-auth.types';
import { SyncService } from './sync.service';

class ResolveConflictDto {
  @IsIn(['local_kept', 'remote_applied'])
  resolution!: 'local_kept' | 'remote_applied';
}

// A12 PR 3 — Conflict queue admin endpoint'leri.
//
// `/platform/sync/conflicts` altında. PlatformJwtAuthGuard zorunlu.
// Tüm platform admin'leri listeleyebilir; resolve aksiyonu da aynı role
// gerektirmiyor (DB action audit zaten resolvedById ile takipli).

@PlatformRoute()
@Controller('platform/sync/conflicts')
@UseGuards(PlatformJwtAuthGuard)
export class SyncConflictsController {
  constructor(private readonly sync: SyncService) {}

  @Get()
  async list(@Query('resolved') resolved?: string) {
    const resolvedFlag = resolved === undefined ? undefined : resolved === 'true';
    return this.sync.listConflicts({ resolved: resolvedFlag });
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(
    @Param('id', new ParseUUIDPipe({ version: undefined })) id: string,
    @Body() dto: ResolveConflictDto,
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
  ) {
    return this.sync.resolveConflict(id, dto.resolution, admin.sub);
  }
}
