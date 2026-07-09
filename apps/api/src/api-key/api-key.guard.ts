import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ApiKeyAuthService, type AuthenticatedApiKey } from './api-key-auth.service';

// External rotaları için ApiKey doğrulama guard'ı. @UseGuards(ApiKeyGuard) ile
// kullanılır; @ExternalRoute() decorator'ı ayrıca eklenmelidir çünkü
// JwtAuthGuard + TenantInterceptor bypass o decorator'a bağlı.
//
// Doğrulanmış key request.apiKey'e yazılır; @CurrentApiKey() decorator
// param olarak okur. Tenant context açma sorumluluğu TenantInterceptor'da
// (external route ise req.apiKey.tenantId üzerinden).

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeyAuth: ApiKeyAuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { apiKey?: AuthenticatedApiKey }>();
    const authenticated = await this.apiKeyAuth.authenticate(req.headers.authorization);
    req.apiKey = authenticated;
    return true;
  }
}
