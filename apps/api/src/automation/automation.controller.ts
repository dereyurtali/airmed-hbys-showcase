import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import type { PrismaClient } from '@airmed/db';
import { Public } from '../auth/decorators/public.decorator';
import { AutomationIngestService, AUTOMATION_ADMIN_PRISMA } from './automation-ingest.service';
import { SecretCryptoService } from './secret-crypto.service';
import type { ChatwootWebhookPayload } from './chatwoot.types';

// EPIC #1018 — Chatwoot Agent Bot webhook alıcısı. JWT'siz (@Public) ama
// secret zorunlu: Chatwoot'taki webhook URL'i ?token=<secret> taşır.
// #1034 — Secret artık DB'de (ekrandan yönetilir, şifreli); env
// AUTOMATION_WEBHOOK_SECRET fallback olarak korunur. Hiçbiri yoksa istek
// İŞLENMEZ (fail-safe 503, #918 felsefesi). Karşılaştırma sabit-zamanlı.

@Controller('automation')
export class AutomationController {
  private readonly logger = new Logger(AutomationController.name);

  constructor(
    private readonly ingest: AutomationIngestService,
    private readonly config: ConfigService,
    private readonly crypto: SecretCryptoService,
    @Inject(AUTOMATION_ADMIN_PRISMA) private readonly admin: PrismaClient,
  ) {}

  @Public()
  @Post('webhook/chatwoot')
  @HttpCode(200)
  async chatwootWebhook(
    @Query('token') token: string | undefined,
    @Body() payload: ChatwootWebhookPayload,
  ): Promise<{ ok: true }> {
    await this.verifyToken(token);
    try {
      const result = await this.ingest.ingest(payload ?? {});
      if (result.outcome !== 'ignored') {
        this.logger.log(`chatwoot webhook: ${result.outcome} (${payload?.event})`);
      }
    } catch (err) {
      // Chatwoot 2xx dışında retry eder; kalıcı hatada retry fırtınası olmasın
      // diye hata loglanır ama 200 dönülür (mesaj kaybı dedupe'la telafi
      // edilemezse #1021 orkestratörü konuşma geçmişini Chatwoot'tan tazeler).
      this.logger.error(`chatwoot webhook ingest failed: ${(err as Error).message}`);
    }
    return { ok: true };
  }

  private async verifyToken(token: string | undefined): Promise<void> {
    // DB'deki (ekrandan üretilen) secret'lar birincil; env fallback.
    const rows = await this.admin.agentConfig.findMany({
      where: { webhookSecretEnc: { not: null } },
      select: { webhookSecretEnc: true },
    });
    const envSecret = this.config.get<string>('AUTOMATION_WEBHOOK_SECRET');
    if (rows.length === 0 && !envSecret) {
      throw new ServiceUnavailableException('Automation webhook is not configured');
    }
    if (token) {
      for (const row of rows) {
        if (safeEqual(token, this.crypto.decrypt(row.webhookSecretEnc as string))) return;
      }
      if (envSecret && safeEqual(token, envSecret)) return;
    }
    throw new UnauthorizedException('Invalid webhook token');
  }
}

// Uzunluk farkını da gizlemek için iki tarafı hash'leyip karşılaştır.
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
