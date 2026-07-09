import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { IS_PLATFORM_ROUTE_KEY } from '../common/decorators/platform-route.decorator';
import { AuditService } from './audit.service';

const AUDITED_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly audit: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    // Platform routes audit through PlatformAuditService into platform_audit_logs.
    // The tenant audit pipeline assumes a tenantId; skipping it here keeps
    // both audit streams cleanly separated.
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

    const req = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    if (!AUDITED_METHODS.has(req.method)) return next.handle();
    if (!req.user) return next.handle();

    const action = `${req.method.toLowerCase()}:${normalizePath(req.path)}`;
    const entityType = entityTypeFromPath(req.path);

    // mergeMap (not tap) so the audit write runs awaited in the same Prisma
    // transaction the TenantInterceptor opened — otherwise the tx commits
    // before the fire-and-forget tap callback resolves and the audit row
    // either lands outside the tenant scope or is silently lost.
    return next.handle().pipe(
      mergeMap(async (body) => {
        try {
          await this.audit.record({
            action,
            entityType,
            entityId: pickEntityId(req, body),
            userId: req.user?.sub ?? null,
            tenantId: req.user?.tenantId ?? null,
            ip: req.ip ?? null,
            userAgent: req.get('user-agent') ?? null,
            payload: { method: req.method, path: req.path },
          });
        } catch (err) {
          this.logger.warn(
            `audit write failed for ${action} (user ${req.user?.sub}): ${(err as Error).message}`,
          );
        }
        return body;
      }),
      // We intentionally do NOT audit failures here — the request transaction
      // is rolled back on error, so an audit row written in the error branch
      // would never persist. Services that need failure audits call
      // AuditService.recordOutOfBand() themselves.
    );
  }
}

function normalizePath(path: string): string {
  return path.replace(/\/[0-9a-f-]{36}/gi, '/:id');
}

function entityTypeFromPath(path: string): string | null {
  const match = /\/api\/([a-z-]+)/i.exec(path);
  return match ? match[1].replace(/s$/, '') : null;
}

function pickEntityId(req: Request, body: unknown): string | null {
  const idFromParams = (req.params?.id as string | undefined) ?? null;
  if (idFromParams) return idFromParams;
  if (body && typeof body === 'object' && 'id' in body) {
    const id = (body as { id?: unknown }).id;
    if (typeof id === 'string') return id;
  }
  return null;
}
