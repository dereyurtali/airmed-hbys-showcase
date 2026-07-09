import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PlatformRoute } from '../../common/decorators/platform-route.decorator';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';
import { PlatformMetricsService } from './platform-metrics.service';
import { PlatformDbStatsService } from './platform-db-stats.service';

// #1085 — Platform metrik okuma REST (tRPC DEĞİL — platform kanonu). Tüm
// platform rolleri read-only (guard PlatformJwtAuthGuard + PlatformRoute
// fail-safe #970). Örnekleme + prune servisin @Interval'ında.
@PlatformRoute()
@Controller('platform/metrics')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformMetricsController {
  constructor(
    private readonly metrics: PlatformMetricsService,
    // #1087 — DB derin analiz (istek-anında raw SQL).
    private readonly dbStats: PlatformDbStatsService,
  ) {}

  // #1087 — İZLEME › Veritabanı ekranı verisi.
  @Get('db/tables')
  dbTables() {
    return this.dbStats.tables();
  }

  @Get('db/indexes')
  dbIndexes() {
    return this.dbStats.unusedIndexes();
  }

  @Get('db/slow-queries')
  dbSlowQueries() {
    return this.dbStats.slowQueries();
  }

  @Get('db/partitions')
  dbPartitions() {
    return this.dbStats.partitions();
  }

  @Get('latest')
  latest() {
    return this.metrics.latest();
  }

  @Get('range')
  range(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('stepMinutes') stepMinutes?: string,
  ) {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(to) : new Date();
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('Geçersiz from/to tarihi');
    }
    if (fromDate >= toDate) throw new BadRequestException('from < to olmalı');
    const step = Math.max(5, Math.min(1440, Number(stepMinutes) || 5));
    return this.metrics.range(fromDate, toDate, step);
  }
}
