import { Injectable, Logger } from '@nestjs/common';
import type { DeliveryResult, IMessageProvider, RenderedMessage } from './messaging.types';

// #428 — Gerçek SMS kanalı (no-show azaltma için randevu hatırlatma + "gelmeden
// öde" + ameliyat günü talimatları). Şablonlar + zamanlama D1'de zaten var
// (MOCK kanalla); bu provider tetiklenen mesajları gerçek bir HTTP SMS
// gateway'ine iletir. RU/TG kritik — şablon dili `RenderedMessage.body`'de
// hazır gelir (provider dil-agnostiktir).
//
// Yapılandırma (env):
//   SMS_GATEWAY_URL   — gateway POST endpoint'i (örn. yerel Tacikistan sağlayıcı)
//   SMS_GATEWAY_KEY   — API anahtarı (opsiyonel, gateway'e göre)
//   SMS_GATEWAY_FROM  — gönderici adı/numarası (opsiyonel)
//
// SMS_GATEWAY_URL set DEĞİLSE provider "dormant"tır: send() FAILED döner
// (sessiz kayıp yerine net "gateway yapılandırılmamış" hatası). Bu sayede bir
// trigger'ı SMS kanalına geçirmek, gateway hazır olmadan farkına varılmadan
// mesaj yutmaz. Hazır olunca sadece env doldurulur.

@Injectable()
export class HttpSmsProvider implements IMessageProvider {
  readonly channel = 'SMS' as const;
  private readonly logger = new Logger(HttpSmsProvider.name);

  static isConfigured(): boolean {
    return !!process.env.SMS_GATEWAY_URL;
  }

  async send(recipient: string, message: RenderedMessage): Promise<DeliveryResult> {
    const url = process.env.SMS_GATEWAY_URL;
    if (!url) {
      this.logger.warn('SMS_GATEWAY_URL yapılandırılmamış — SMS gönderilemedi');
      return { externalId: '', status: 'FAILED', error: 'SMS gateway not configured' };
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(process.env.SMS_GATEWAY_KEY
            ? { authorization: `Bearer ${process.env.SMS_GATEWAY_KEY}` }
            : {}),
        },
        body: JSON.stringify({
          to: recipient,
          from: process.env.SMS_GATEWAY_FROM ?? undefined,
          text: message.body,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return {
          externalId: '',
          status: 'FAILED',
          error: `SMS gateway ${res.status}: ${detail.slice(0, 200)}`,
        };
      }
      // Gateway gövdesinden provider mesaj id'si çıkarmaya çalış (yoksa boş).
      const data = (await res.json().catch(() => ({}))) as { id?: string; messageId?: string };
      return {
        externalId: String(data.id ?? data.messageId ?? `sms-${Date.now()}`),
        status: 'SENT',
      };
    } catch (err) {
      return {
        externalId: '',
        status: 'FAILED',
        error: err instanceof Error ? err.message : 'SMS gateway request failed',
      };
    }
  }
}
