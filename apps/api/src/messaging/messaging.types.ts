// D1 — Mesajlaşma altyapısı tipleri.

export type MessageChannel = 'MOCK' | 'SMS' | 'WHATSAPP' | 'EMAIL';
export type MessageStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED';
export type MessageLanguage = 'tr' | 'ru' | 'tg';
export type TriggerCategory = 'RANDEVU' | 'TETKIK' | 'FATURA' | 'ONAM' | 'DIGER';

export interface RenderedMessage {
  subject: string | null;
  body: string;
}

export interface DeliveryResult {
  /** Provider tarafı ID — şu an MOCK için DB row id'sini reuse ediyoruz */
  externalId: string;
  status: 'SENT' | 'DELIVERED' | 'FAILED';
  error?: string;
}

export interface IMessageProvider {
  readonly channel: MessageChannel;
  send(recipient: string, message: RenderedMessage): Promise<DeliveryResult>;
}

export interface FireTriggerInput {
  tenantId: string;
  key: string;
  // Recipient resolve eden helper'lar context'ten phone/email çekiyor
  recipient: string;
  language?: MessageLanguage;
  context: Record<string, unknown>;
  /** Scheduled delivery (cron için): null/undefined → now */
  scheduledAt?: Date;
}
