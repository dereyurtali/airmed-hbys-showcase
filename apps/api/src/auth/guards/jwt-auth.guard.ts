import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { IS_EXTERNAL_ROUTE_KEY } from '../../api-key/decorators/external-route.decorator';
import { IS_PLATFORM_ROUTE_KEY } from '../../common/decorators/platform-route.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * True for the platform authentication boundary. main.ts excludes
 * `platform/(.*)` from the global `/api` prefix, so every platform handler is
 * mounted under `/platform/...` (never `/api/...`).
 */
export function isPlatformPath(path: string): boolean {
  return path === '/platform' || path.startsWith('/platform/');
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Platform routes authenticate via PlatformJwtAuthGuard with a separate
    // secret. Skipping the tenant 'jwt' strategy here prevents a tenant token
    // from accidentally satisfying a platform handler.
    const isPlatformRoute = this.reflector.getAllAndOverride<boolean>(IS_PLATFORM_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPlatformRoute) return true;

    // #970 — fail-safe. A `/platform/*` handler that is NOT marked
    // @PlatformRoute() is a misconfiguration (decorator forgotten on a new
    // controller). Without this guard it would fall through to the tenant
    // 'jwt' strategy below and a clinic-staff JWT would satisfy a platform
    // handler. Deny fail-closed instead — the dev sees the 403 immediately.
    const req = context.switchToHttp().getRequest<Request>();
    if (isPlatformPath(req.path)) {
      throw new ForbiddenException('Platform route misconfigured: missing @PlatformRoute()');
    }

    // External /api/external/* routes authenticate via ApiKeyGuard; JWT bypass.
    const isExternalRoute = this.reflector.getAllAndOverride<boolean>(IS_EXTERNAL_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isExternalRoute) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
