import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.types';
import { SyncService } from './sync.service';

// A12 PR 5 — Sync status endpoint, tenant UI offline banner için.
// `outboxPending` > 0 → çevrimdışı modda kayıt birikiyor.
// `lastSyncAt` null veya > 5 dk önce → connectivity sorunu.

@Controller('sync/status')
@UseGuards(JwtAuthGuard)
export class SyncStatusController {
  constructor(private readonly sync: SyncService) {}

  @Get()
  async status(@CurrentUser() user: JwtPayload) {
    return this.sync.getStatus(user.tenantId);
  }
}
