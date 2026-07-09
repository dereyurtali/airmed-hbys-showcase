import {
  BadRequestException,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { verifySyncSignature } from './sync-hmac';
import { SyncService } from './sync.service';
import type { SyncBatch, SyncBatchResult } from './sync.types';

// A12 — Internal sync receive endpoint.
//
// `@Public()`: JWT bypass — bu endpoint HMAC ile authenticate ediliyor
// (paylaşılan secret SYNC_HMAC_SECRET). Header'lar:
// - X-Sync-Signature: hex hmac sha256(secret, `${timestamp}.${body}`)
// - X-Sync-Timestamp: unix epoch sec (5dk pencere)
//
// **HMAC raw body** (denetim P0 2.10): Eskiden `JSON.stringify(req.body)` ile
// imza yeniden hesaplanıyordu. Re-serialize whitespace/key-ordering farkı
// nedeniyle saldırgan farklı payload ile aynı imzayı tetikleyebilirdi.
// NestFactory `{ rawBody: true }` ile req.rawBody buffer'ına erişiliyor;
// imza doğrudan raw buffer üstünden hesaplanıyor → tamper imkansız.

@Controller('internal/sync')
export class SyncReceiveController {
  constructor(private readonly sync: SyncService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Req() req: RawBodyRequest<Request>): Promise<SyncBatchResult> {
    const secret = this.sync.getHmacSecret();
    if (!secret) {
      throw new ForbiddenException('Sync HMAC secret not configured on this node');
    }

    if (!req.rawBody) {
      throw new BadRequestException('Sync receive expects raw body (NestFactory rawBody enabled)');
    }

    const signature = req.header('x-sync-signature') ?? undefined;
    const timestamp = req.header('x-sync-timestamp') ?? undefined;
    const rawBody = req.rawBody.toString('utf8');
    const verdict = verifySyncSignature(secret, rawBody, signature, timestamp);
    if (!verdict.ok) {
      throw new ForbiddenException(`Sync auth failed: ${verdict.reason}`);
    }

    const batch = req.body as SyncBatch;
    return this.sync.applyBatch(batch);
  }
}
