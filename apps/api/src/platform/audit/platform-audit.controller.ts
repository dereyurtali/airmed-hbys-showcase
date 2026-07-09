import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PlatformRoute } from '../../common/decorators/platform-route.decorator';
import { CurrentPlatformAdmin } from '../auth/decorators/current-platform-admin.decorator';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';
import type { PlatformJwtPayload } from '../auth/platform-auth.types';
import { ListAuditQueryDto } from './audit-query.dto';
import { PlatformAuditService } from './platform-audit.service';

// #945 (F3, EPIC #956) — platform audit READ. platform_audit_logs zengin veri
// biriktiriyordu ama okuma yolu yoktu (write-only). "Audit Viewer" (#947) +
// dashboard "son aktiviteler" (#949) önkoşulu. Tüm platform rolleri okuyabilir
// (assertReader); mutasyon yok → audit yazılmaz.
@PlatformRoute()
@Controller('platform/audit')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformAuditController {
  constructor(private readonly audit: PlatformAuditService) {}

  @Get()
  async list(@Query() query: ListAuditQueryDto, @CurrentPlatformAdmin() admin: PlatformJwtPayload) {
    return this.audit.list(query, { id: admin.sub, email: admin.email, role: admin.role });
  }
}
