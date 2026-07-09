import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { BLOCK_IMPERSONATION_KEY } from '../decorators/block-impersonation.decorator';
import type { JwtPayload } from '../auth.types';

/**
 * F4 — `@BlockImpersonation()` ile işaretli handler'larda JWT'deki `imp`
 * claim'i kontrol eder ve impersonation token'ları 403 ile reddeder.
 *
 * Guard JwtAuthGuard'dan SONRA çalışmalı (req.user dolu olmalı) — global
 * olarak app.module'da APP_GUARD ile register ediyoruz. JwtAuthGuard zaten
 * APP_GUARD listesinde önce; bu guard sırayı koruyup user'ı okuyabiliyor.
 */
@Injectable()
export class ImpersonationBlockGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const block = this.reflector.getAllAndOverride<boolean>(BLOCK_IMPERSONATION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!block) return true;
    const req = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    if (req.user?.imp) {
      throw new ForbiddenException(
        'Bu işlem impersonation oturumunda yapılamaz. Lütfen kendi hesabınızla giriş yapın.',
      );
    }
    return true;
  }
}
