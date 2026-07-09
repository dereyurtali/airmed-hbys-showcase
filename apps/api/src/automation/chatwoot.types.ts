import type { AgentChannel } from '@airmed/db';

// EPIC #1018 — Chatwoot Agent Bot webhook payload'ının kullandığımız alt kümesi.
// Kaynak: Chatwoot webhook events (message_created, conversation_status_changed).
// Alan adları Chatwoot'un gönderdiği snake_case ile birebir.

export interface ChatwootWebhookPayload {
  event: 'message_created' | 'message_updated' | 'conversation_status_changed' | string;
  // message_created alanları (event'e göre değişir)
  id?: number;
  content?: string | null;
  message_type?: 'incoming' | 'outgoing' | 'template' | string;
  private?: boolean;
  account?: { id: number; name?: string };
  // Hesap-webhook'unda (Settings→Integrations→Webhooks) bazı olaylarda hesap
  // kimliği kökte gelir (#1036).
  account_id?: number;
  conversation?: {
    id: number;
    channel?: string; // "Channel::Whatsapp" | "Channel::TelegramBot" | "Channel::WebWidget" | ...
    status?: 'open' | 'pending' | 'resolved' | 'snoozed' | string;
    meta?: {
      sender?: { id?: number; name?: string | null; phone_number?: string | null };
    };
  };
  sender?: { id?: number; name?: string | null; phone_number?: string | null; type?: string };
  // conversation_status_changed event'inde konuşma alanları köke gelir
  status?: string;
}

// Chatwoot channel string'i → AgentChannel enum. Instagram, Chatwoot'ta
// FacebookPage kanalı altında gelir; v1'de facebook olarak loglanır
// (ayrıştırma additional_attributes ile #1021+ konusu).
export function mapChatwootChannel(channel: string | undefined): AgentChannel {
  const c = (channel ?? '').toLowerCase();
  if (c.includes('whatsapp')) return 'whatsapp';
  if (c.includes('telegram')) return 'telegram';
  if (c.includes('instagram')) return 'instagram';
  if (c.includes('facebook')) return 'facebook';
  if (c.includes('webwidget') || c.includes('web_widget')) return 'webchat';
  return 'other';
}
