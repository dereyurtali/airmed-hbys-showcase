import { Injectable, Logger } from '@nestjs/common';
import type { DeliveryResult, IMessageProvider, RenderedMessage } from './messaging.types';

// D1 — MockMessageProvider.
//
// Pilot deployment'ta default provider. Gerçek mesaj göndermez; her send
// çağrısı immediate DELIVERED döner. Log + DB kayıt tutar (delivery row
// DeliveryService tarafından zaten yazılıyor — provider sadece sonucu döner).
//
// Production'da Twilio/WhatsApp gerçek provider'ları aynı interface ile
// register edilecek (provider-registry seçimi env MESSAGE_PROVIDER).

@Injectable()
export class MockMessageProvider implements IMessageProvider {
  readonly channel = 'MOCK' as const;
  private readonly logger = new Logger(MockMessageProvider.name);

  async send(recipient: string, message: RenderedMessage): Promise<DeliveryResult> {
    this.logger.debug(`MOCK send → ${recipient}: ${message.subject ?? '(no subject)'}`);
    return {
      externalId: `mock-${Date.now()}`,
      status: 'DELIVERED',
    };
  }
}
