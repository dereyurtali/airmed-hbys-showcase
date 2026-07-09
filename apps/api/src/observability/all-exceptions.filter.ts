import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { captureException } from './sentry';

/**
 * Global REST exception filter. İki amaç:
 *  1. Gözlemlenebilirlik: beklenmeyen hatalar (Prisma çökmesi, programlama
 *     hatası, 5xx) artık yakalanıp loglanır + Sentry'ye gönderilir. Önceden
 *     Nest default filter bunları sessizce generic 500 olarak dönüyordu — iz yok.
 *  2. Graceful degradation: istemciye iç hata detayı/stack SIZDIRILMAZ.
 *
 * **Non-breaking:** HttpException (4xx + bilinçli 5xx) için exception'ın kendi
 * response body'si AYNEN döndürülür (Nest default davranışı) — mevcut frontend
 * hata-parse akışları (ör. duplicate 409 payload) bozulmaz. tRPC kendi hata
 * akışını yönetir (trpc.module onError + error-mapper); bu filter REST + platform
 * controller'larını kapsar.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('UnhandledException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // 5xx HttpException'lar (ör. servisin bilinçli fırlattığı) yine iz bırakmalı.
      if (status >= 500) {
        captureException(exception, { path: req.url, method: req.method, status });
      }
      res.status(status).json(exception.getResponse());
      return;
    }

    // Beklenmeyen hata: log + Sentry + generic 500 (detay sızdırma).
    const err = exception as Error;
    this.logger.error(
      `Unhandled ${req.method} ${req.url}: ${err?.message ?? String(exception)}`,
      err?.stack,
    );
    captureException(exception, { path: req.url, method: req.method });
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
