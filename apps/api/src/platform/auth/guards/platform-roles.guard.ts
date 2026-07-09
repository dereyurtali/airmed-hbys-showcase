import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformRole } from '@airmed/db';
import type { Request } from 'express';
import { PLATFORM_ROLES_KEY } from '../decorators/platform-roles.decorator';
import type { PlatformJwtPayload } from '../platform-auth.types';

@Injectable()
export class PlatformRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PlatformRole[]>(PLATFORM_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: PlatformJwtPayload }>();
    if (!req.user) throw new ForbiddenException('Unauthenticated');
    if (!required.includes(req.user.role)) {
      throw new ForbiddenException('Insufficient platform role');
    }
    return true;
  }
}
