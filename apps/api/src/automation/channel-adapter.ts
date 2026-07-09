import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// EPIC #1018 — Kanal soyutlaması. Agent çekirdeği kanaldan bağımsız; bugün
// Chatwoot, yarın başka bir inbox (adapter değişir, çekirdek değişmez).

export interface OutboundMessageRef {
  chatwootAccountId: number;
  chatwootConversationId: number;
}

export interface IChannelAdapter {
  /** Hastaya (konuşmanın kanalından) mesaj gönderir. */
  sendMessage(ref: OutboundMessageRef, content: string, botToken?: string): Promise<void>;
  /** İnsan devri: konuşmayı personel kuyruğuna açar (Chatwoot pending → open). */
  handoffToHuman(ref: OutboundMessageRef, botToken?: string): Promise<void>;
  /** Bota geri devir: konuşmayı bot kuyruğuna döndürür (Chatwoot open → pending). */
  returnToBot(ref: OutboundMessageRef, botToken?: string): Promise<void>;
}

// Chatwoot Application API. Bot token env'den (CHATWOOT_BOT_TOKEN) — DB'de
// sır tutulmaz (AgentConfig.channelSettings yalnız accountId + baseUrl taşır).
@Injectable()
export class ChatwootAdapter implements IChannelAdapter {
  private readonly logger = new Logger(ChatwootAdapter.name);

  constructor(private readonly config: ConfigService) {}

  private baseUrl(): string {
    return (
      this.config.get<string>('CHATWOOT_BASE_URL')?.replace(/\/$/, '') ?? 'https://app.chatwoot.com'
    );
  }

  // #1034 — token önceliği: çağrıdan gelen (DB, ekrandan) > env.
  private token(override?: string): string {
    const token = override ?? this.config.get<string>('CHATWOOT_BOT_TOKEN');
    if (!token) throw new Error('Chatwoot bot token is not configured');
    return token;
  }

  async sendMessage(ref: OutboundMessageRef, content: string, botToken?: string): Promise<void> {
    await this.post(
      `/api/v1/accounts/${ref.chatwootAccountId}/conversations/${ref.chatwootConversationId}/messages`,
      { content, message_type: 'outgoing' },
      botToken,
    );
  }

  async handoffToHuman(ref: OutboundMessageRef, botToken?: string): Promise<void> {
    await this.post(
      `/api/v1/accounts/${ref.chatwootAccountId}/conversations/${ref.chatwootConversationId}/toggle_status`,
      { status: 'open' },
      botToken,
    );
  }

  async returnToBot(ref: OutboundMessageRef, botToken?: string): Promise<void> {
    await this.post(
      `/api/v1/accounts/${ref.chatwootAccountId}/conversations/${ref.chatwootConversationId}/toggle_status`,
      { status: 'pending' },
      botToken,
    );
  }

  private async post(path: string, body: unknown, botToken?: string): Promise<void> {
    const res = await fetch(`${this.baseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', api_access_token: this.token(botToken) },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Chatwoot API ${path} failed: ${res.status} ${text.slice(0, 300)}`);
      throw new Error(`Chatwoot API error ${res.status}`);
    }
  }
}
