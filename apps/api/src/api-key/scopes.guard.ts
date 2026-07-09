import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthenticatedApiKey } from './api-key-auth.service';
import type { ApiScope } from './api-key.schemas';
import { SCOPES_KEY } from './decorators/require-scopes.decorator';

// @RequireScopes(...) meta'sını okuyup request.apiKey.scopes ile karşılaştırır.
// AND mantığı: tüm gerekli scope'lar key'de bulunmalı. ApiKeyGuard'dan SONRA
// çalışmalı; sıralama @UseGuards(ApiKeyGuard, ScopesGuard) ile sağlanır.

@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<ApiScope[]>(SCOPES_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? [];
    if (required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<Request & { apiKey?: AuthenticatedApiKey }>();
    if (!req.apiKey) {
      // Defensive — ApiKeyGuard önce çalışmış olmalıydı.
      throw new UnauthorizedException('API key required');
    }
    const missing = required.filter((s) => !req.apiKey!.scopes.includes(s));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing required scopes: ${missing.join(', ')}`);
    }
    return true;
  }
}
