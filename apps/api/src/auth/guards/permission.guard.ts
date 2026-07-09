import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { JwtPayload } from '../auth.types';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { hasPermission, type Permission } from '@airmed/contracts';

/**
 * `@RequirePermission(perm)` ile işaretli endpoint'lerde permission registry
 * üzerinden kontrol yapar. Yetki yoksa 403.
 *
 * JwtAuthGuard'tan SONRA çalışmalı (req.user dolu olmalı). Global APP_GUARD
 * listesinde RolesGuard ile aynı sıralamada (auth → roles/permission → block
 * impersonation → diğer).
 *
 * Mevcut `RolesGuard` ile aynı anda var olabilir; metadata key'leri farklı
 * (`roles` vs `requirePermission`). Bir endpoint sadece birini kullanmalı —
 * iki decorator karışıklık yaratır (ikisi de pass olmalı diye AND mantığı
 * istemiyorsanız). Migration sırasında geçici olarak hibrit kabul edilir.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const required = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const userRoles = req.user?.roles ?? [];
    // PermissionAssignment runtime: önce JWT'deki bake'li `effectivePerms`'e
    // bak; legacy token (deploy öncesi) için undefined → registry fallback.
    const effectivePerms = req.user?.effectivePerms;
    if (!hasPermission(userRoles, required, effectivePerms)) {
      throw new ForbiddenException(`${required} yetkisi yok`);
    }
    return true;
  }
}
