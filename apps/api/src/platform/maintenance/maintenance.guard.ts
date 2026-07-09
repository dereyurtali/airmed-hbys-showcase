import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PLATFORM_ROUTE_KEY } from '../../common/decorators/platform-route.decorator';
import { PlatformMaintenanceService } from './platform-maintenance.service';

// #1093 — F6 bakım guard (global APP_GUARD). Aktif bakım penceresinde klinik
// mutasyonlarını 503 + Retry-After ile reddeder (v1 tam blok, basit):
//   - Platform route'ları (/platform) ETKİLENMEZ.
//   - GET istekleri geçer (setup/status bakım mesajını gösterir; UI banner çizer).
//   - Klinik mutasyonu (POST/PUT/PATCH/DELETE): global pencere → herkes bloklanır
//     (login dahil, JWT yok → yalnız global); tenant penceresi → yalnız o tenant'ın
//     kimlikli mutasyonları (req.user.tenantId).
// Aktif pencere okuması 15sn in-memory cache (hot-path DB'ye vurmasın).
const CACHE_TTL_MS = 15_000;

@Injectable()
export class MaintenanceGuard implements CanActivate {
  private cache: { global: { message: string; endsAt: string } | null; at: number } | null = null;

  constructor(
    private readonly reflector: Reflector,
    private readonly maintenance: PlatformMaintenanceService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPlatform = this.reflector.getAllAndOverride<boolean>(IS_PLATFORM_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPlatform) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: { tenantId?: string } }>();
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;

    // Global pencere (cache) + varsa tenant penceresi.
    const globalWin = await this.getGlobal();
    let win = globalWin;
    if (!win && req.user?.tenantId) {
      win = await this.maintenance.activeMaintenance(req.user.tenantId);
    }
    if (!win) return true;

    const retryAfterSec = Math.max(
      1,
      Math.round((new Date(win.endsAt).getTime() - Date.now()) / 1000),
    );
    throw new HttpException(
      { statusCode: HttpStatus.SERVICE_UNAVAILABLE, message: win.message, maintenance: true },
      HttpStatus.SERVICE_UNAVAILABLE,
      { cause: { retryAfterSec } },
    );
  }

  private async getGlobal() {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.global;
    const win = await this.maintenance.activeMaintenance(null); // global-only (tenantId null)
    this.cache = { global: win, at: Date.now() };
    return win;
  }
}
