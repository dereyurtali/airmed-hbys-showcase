import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { PublicMonitorService } from './public-monitor.service';

const TEST_BYPASS = process.env.NODE_ENV === 'test';

// #1159 — Lobi bekleme ekranı PUBLIC endpoint'i. Kimlik gerekmez (@Public);
// erişim yalnız yayın anahtarı (?key=) ile. Rate-limit: 10sn poll = ~6/dk;
// 120/dk cömert ama sınırlı (birkaç ekran + retry). Yalnız GET (read-only).
@Controller('public')
export class PublicMonitorController {
  constructor(private readonly svc: PublicMonitorService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: TEST_BYPASS ? 10_000 : 120 } })
  @Get('waiting-monitor')
  waiting(@Query('key') key?: string) {
    return this.svc.getWaitingByKey(key ?? '');
  }
}
