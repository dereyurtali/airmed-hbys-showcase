import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, lastValueFrom } from 'rxjs';
import type { Request } from 'express';
import type { AuthenticatedApiKey } from '../api-key/api-key-auth.service';
import { IS_EXTERNAL_ROUTE_KEY } from '../api-key/decorators/external-route.decorator';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { IS_PLATFORM_ROUTE_KEY } from '../common/decorators/platform-route.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from './tenant-context.service';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantInterceptor.name);

  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isPlatformRoute = this.reflector.getAllAndOverride<boolean>(IS_PLATFORM_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPlatformRoute) return next.handle();

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return next.handle();

    // External /api/external/* routes: tenant gelir ApiKeyGuard'dan (req.apiKey).
    // JWT yerine API key auth çalıştığı için req.user yok.
    const isExternalRoute = this.reflector.getAllAndOverride<boolean>(IS_EXTERNAL_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isExternalRoute) {
      const req = context.switchToHttp().getRequest<Request & { apiKey?: AuthenticatedApiKey }>();
      const apiKey = req.apiKey;
      if (!apiKey?.tenantId) return next.handle();
      return from(this.runScoped(apiKey.tenantId, next));
    }

    const req = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const user = req.user;
    if (!user?.tenantId) return next.handle();

    return from(this.runScoped(user.tenantId, next));
  }

  private async runScoped(tenantId: string, next: CallHandler): Promise<unknown> {
    await this.assertTenantActive(tenantId);
    return this.prisma.runWithTenant(tenantId, async (tx) => {
      this.tenantContext.setTenantId(tenantId);
      this.tenantContext.setTransaction(tx);
      return lastValueFrom(next.handle());
    });
  }

  private async assertTenantActive(tenantId: string): Promise<void> {
    // #969 — cache'li (per-request findUnique kalkar; suspend/delete gecikmesi ≤ TTL).
    const tenant = await this.prisma.getTenantStatusCached(tenantId);
    if (!tenant || tenant.deletedAt) {
      this.logger.warn(`Tenant ${tenantId} not found or deleted`);
      throw new ForbiddenException('Tenant not available');
    }
    if (tenant.status !== 'active' || tenant.suspendedAt) {
      throw new ForbiddenException('Tenant suspended');
    }
  }
}
