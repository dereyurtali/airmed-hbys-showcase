import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Ipv4Cidr } from '../../../common/cidr.util';
import { IS_PLATFORM_ROUTE_KEY } from '../../../common/decorators/platform-route.decorator';
import { PrismaService } from '../../../prisma/prisma.service';

const CACHE_TTL_MS = 30_000;

/**
 * Drops requests whose IP isn't in `platform_admin_ip_allowlist`. Runs only
 * for handlers/classes marked @PlatformRoute(); other routes skip out
 * entirely. The allowlist is small (~5-10 rows) and caches in-memory for 30s
 * to keep this off the hot path.
 *
 * Bypass when `DEV_PLATFORM_OPEN_IPS=true` (local dev / CI). Also tolerates
 * IPv6-mapped IPv4 addresses (`::ffff:1.2.3.4`) by normalising to IPv4.
 */
@Injectable()
export class PlatformIpAllowlistGuard implements CanActivate {
  private readonly logger = new Logger(PlatformIpAllowlistGuard.name);
  private cache: { matchers: Ipv4Cidr[]; loadedAt: number } | null = null;
  private readonly devOpen: boolean;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.devOpen = config.get<string>('DEV_PLATFORM_OPEN_IPS') === 'true';
    // #918 — 'prod'da ASLA' bugüne kadar yalnız operasyonel disipline (compose
    // satırını kopyalamamak) dayanıyordu. DEV_PLATFORM_OPEN_IPS prod compose'a
    // yanlışlıkla sızarsa IP allowlist sessizce kapanır (tek IP savunması gider).
    // Boot-time fail-fast: prod'da açık bırakılamaz → uygulama açılışta reddeder.
    if (this.devOpen && process.env.NODE_ENV === 'production') {
      throw new Error(
        'DEV_PLATFORM_OPEN_IPS=true is not allowed with NODE_ENV=production — it ' +
          'disables the platform IP allowlist. Remove it from the production environment.',
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPlatformRoute = this.reflector.getAllAndOverride<boolean>(IS_PLATFORM_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isPlatformRoute) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const ip = normaliseIp(req.ip ?? '');
    if (!ip) {
      throw new ForbiddenException('IP not allowed');
    }

    if (this.devOpen) return true;

    const matchers = await this.getMatchers();
    if (matchers.length === 0) {
      this.logger.warn(
        'platform IP allowlist empty — denying all (set DEV_PLATFORM_OPEN_IPS=true for dev)',
      );
      await this.recordIpDenied(req, ip);
      throw new ForbiddenException('IP not allowed');
    }
    const allowed = matchers.some((m) => m.contains(ip));
    if (!allowed) {
      this.logger.warn(`platform IP ${ip} blocked (not in allowlist)`);
      await this.recordIpDenied(req, ip);
      throw new ForbiddenException('IP not allowed');
    }
    return true;
  }

  // #1090 — ip_denied login denemesini kaydet (yalnız login yolunda; tüm
  // platform route'larında değil → login_attempts tablosu şişmez). Best-effort:
  // hata login akışını bloklamaz. Güvenlik Olayları ekranı bunu gösterir.
  private async recordIpDenied(req: Request, ip: string): Promise<void> {
    if (!req.path?.includes('/platform/auth/login')) return;
    const email =
      typeof (req.body as { email?: unknown })?.email === 'string'
        ? (req.body as { email: string }).email.slice(0, 255)
        : '(unknown)';
    try {
      await this.prisma.platformAdminLoginAttempt.create({
        data: { email, ipAddress: ip, success: false, failureReason: 'ip_denied' },
      });
    } catch (err) {
      this.logger.warn(`ip_denied attempt record failed: ${(err as Error).message}`);
    }
  }

  private async getMatchers(): Promise<Ipv4Cidr[]> {
    if (this.cache && Date.now() - this.cache.loadedAt < CACHE_TTL_MS) {
      return this.cache.matchers;
    }
    const rows = await this.prisma.platformAdminIpAllowlist.findMany({ where: { isActive: true } });
    const matchers: Ipv4Cidr[] = [];
    for (const row of rows) {
      try {
        matchers.push(new Ipv4Cidr(row.cidr));
      } catch (err) {
        this.logger.warn(`invalid CIDR in allowlist (id=${row.id}): ${(err as Error).message}`);
      }
    }
    this.cache = { matchers, loadedAt: Date.now() };
    return matchers;
  }
}

function normaliseIp(ip: string): string {
  if (!ip) return '';
  // Express sets req.ip with the express trust-proxy resolution; behind nginx
  // we still see ::ffff:<ipv4> for legacy clients. Strip the prefix.
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}
