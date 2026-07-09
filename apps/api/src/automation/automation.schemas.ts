import { z } from 'zod';

// EPIC #1018 — Otomasyon yönetim yüzeyi (tRPC) input şemaları.

export const AGENT_PROVIDERS = ['anthropic', 'openrouter'] as const;

export const AGENT_CONVERSATION_STATUSES = ['bot_active', 'human_active', 'closed'] as const;

export const agentConfigUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(AGENT_PROVIDERS).optional(),
  model: z.string().min(1).max(120).optional(),
  systemPrompt: z.string().min(1).max(100_000).optional(),
  knowledgeBase: z.string().max(500_000).nullable().optional(),
  channelSettings: z
    .object({
      chatwootAccountId: z.number().int().positive(),
      chatwootBaseUrl: z.string().url().optional(),
      // #1034 — webhook URL'inin ekranda üretilmesi için public taban adres.
      webhookPublicBaseUrl: z.string().url().optional(),
    })
    .nullable()
    .optional(),
});
export type AgentConfigUpdateInput = z.infer<typeof agentConfigUpdateSchema>;

// #1034 — Sırlar (write-only): null = kayıtlı sırrı sil, undefined = dokunma.
export const agentSecretsUpdateSchema = z.object({
  chatwootBotToken: z.string().min(8).max(500).nullable().optional(),
  anthropicKey: z.string().min(8).max(500).nullable().optional(),
  openrouterKey: z.string().min(8).max(500).nullable().optional(),
});
export type AgentSecretsUpdateInput = z.infer<typeof agentSecretsUpdateSchema>;

export const agentConversationListQuerySchema = z.object({
  status: z.enum(AGENT_CONVERSATION_STATUSES).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export type AgentConversationListQuery = z.infer<typeof agentConversationListQuerySchema>;

export const agentActionListQuerySchema = z.object({
  type: z
    .enum([
      'appointment_created',
      'appointment_cancelled',
      'patient_created',
      'patient_matched',
      'handoff',
      'returned_to_bot',
      'error',
    ])
    .optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export type AgentActionListQuery = z.infer<typeof agentActionListQuerySchema>;
