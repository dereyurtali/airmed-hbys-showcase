import { Controller, Get, Logger, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { type AuthenticatedApiKey } from '../api-key/api-key-auth.service';
import { ApiKeyGuard } from '../api-key/api-key.guard';
import { CurrentApiKey } from '../api-key/decorators/current-api-key.decorator';
import { ExternalRoute } from '../api-key/decorators/external-route.decorator';
import { RequireScopes } from '../api-key/decorators/require-scopes.decorator';
import { ScopesGuard } from '../api-key/scopes.guard';
import { AuditService } from '../audit/audit.service';

// A10 dış API endpoint'leri. PR2'de yalnızca /me — guard altyapısının uçtan
// uca çalıştığını doğrular ve dış sistemler için "anahtarın özelliklerini
// yansıt" işlevi sunar.
//
// PR3'te eklenecek 5 endpoint:
//   POST /api/external/patients       (scope: patient:create)
//   GET  /api/external/patients/:id   (scope: patient:read)
//   GET  /api/external/availability   (scope: availability:read)
//   POST /api/external/appointments   (scope: appointment:create)
//   DELETE /api/external/appointments/:id (scope: appointment:cancel)

@Controller('external')
@ExternalRoute()
@UseGuards(ApiKeyGuard)
export class ExternalController {
  private readonly logger = new Logger(ExternalController.name);

  constructor(private readonly audit: AuditService) {}

  @Get('me')
  @UseGuards(ScopesGuard)
  @RequireScopes() // empty = sadece geçerli auth yeter
  async me(@CurrentApiKey() apiKey: AuthenticatedApiKey, @Req() req: Request) {
    // Audit best-effort — GET istekleri global AuditInterceptor'a düşmez
    // (mutation-only), dış sistem aktivitesi için manuel kayıt.
    try {
      await this.audit.record({
        action: 'external:GET /api/external/me',
        entityType: 'apiKey',
        entityId: apiKey.id,
        tenantId: apiKey.tenantId,
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
        payload: { prefix: apiKey.prefix, scopes: apiKey.scopes },
      });
    } catch (err) {
      this.logger.warn(`audit write failed for external/me: ${(err as Error).message}`);
    }

    return {
      keyId: apiKey.id,
      prefix: apiKey.prefix,
      tenantId: apiKey.tenantId,
      scopes: apiKey.scopes,
    };
  }
}
