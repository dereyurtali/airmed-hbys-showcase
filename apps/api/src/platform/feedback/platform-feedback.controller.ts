import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PlatformRoute } from '../../common/decorators/platform-route.decorator';
import { CurrentPlatformAdmin } from '../auth/decorators/current-platform-admin.decorator';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';
import type { PlatformJwtPayload } from '../auth/platform-auth.types';
import {
  FeedbackIdParamDto,
  PlatformFeedbackListQueryDto,
  UpdateFeedbackDto,
} from './platform-feedback.dto';
import { PlatformFeedbackService } from './platform-feedback.service';

// `/platform/feedback` — DNA platform admin'in cross-tenant geri-bildirim gelen
// kutusu. Platform JWT zorunlu (tüm endpoint'ler); tenant scope bypass.
@PlatformRoute()
@Controller('platform/feedback')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformFeedbackController {
  constructor(private readonly feedback: PlatformFeedbackService) {}

  @Get()
  async list(@Query() query: PlatformFeedbackListQueryDto) {
    return this.feedback.list(query);
  }

  // #882 — nav rozeti için okunmamış (triyaj edilmemiş) istek sayısı.
  @Get('unread-count')
  async unreadCount() {
    return this.feedback.unreadCount();
  }

  // #951 — Triyaj: status + GitHub issue no güncelle. Writer (owner/engineer) gerekli.
  @Patch(':id')
  async update(
    @Param() params: FeedbackIdParamDto,
    @Body() dto: UpdateFeedbackDto,
    @CurrentPlatformAdmin() admin: PlatformJwtPayload,
    @Req() req: Request,
  ) {
    return this.feedback.updateStatus(
      params.id,
      dto,
      { id: admin.sub, email: admin.email, role: admin.role },
      { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );
  }
}
