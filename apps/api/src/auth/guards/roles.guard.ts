import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { JwtPayload } from '../auth.types';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { isLockedMode } from '@airmed/contracts';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    // #665 — RolesGuard ham rol okur (mode-blind). Kilitli mod (olcum kiosk) bir
    // @Roles-gated REST endpoint'ine erişmemeli (kiosk yalnız ölçüm ekranları);
    // privileged rol kiosk modunda bile bu endpoint'leri çağıramaz. Kilitli modda
    // meşru bir @Roles akışı yok → güvenli kategorik red.
    if (isLockedMode(req.user?.mode)) {
      throw new ForbiddenException('Kilitli çalışma modunda bu işleme erişilemez');
    }
    const userRoles = req.user?.roles ?? [];
    const granted = required.some((role) => userRoles.includes(role));
    if (!granted) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
