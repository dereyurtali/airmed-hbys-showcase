import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_MAX_TOOL_ITERATIONS,
  type IModelProvider,
  type RunTurnRequest,
  type RunTurnResult,
} from '../model-provider';

// #1021 — OpenRouter sağlayıcısı (OpenAI-uyumlu chat/completions + function
// calling). Ali'nin mevcut OpenRouter hesabıyla herhangi bir model slug'ı
// (AgentConfig.model) kullanılabilir; tool-calling desteği zayıf modellerde
// randevu akışı bozulur — model seçimi yönetici sorumluluğunda.

interface OpenRouterToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
}

@Injectable()
export class OpenRouterProvider implements IModelProvider {
  readonly key = 'openrouter' as const;
  private readonly logger = new Logger(OpenRouterProvider.name);

  constructor(private readonly config: ConfigService) {}

  async runTurn(request: RunTurnRequest): Promise<RunTurnResult> {
    // #1034 — anahtar önceliği: request.apiKey (DB, ekrandan) > env.
    const apiKey = request.apiKey ?? this.config.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) throw new Error('OpenRouter API key is not configured');

    const tools = request.tools.map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
    const messages: OpenRouterMessage[] = [
      { role: 'system', content: request.systemPrompt },
      ...request.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const maxIterations = request.maxIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    // #1089 — tur boyunca token toplamı.
    let inputTokens = 0;
    let outputTokens = 0;
    for (let i = 0; i < maxIterations; i++) {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: request.model, messages, tools }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`OpenRouter API error ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = (await res.json()) as {
        choices: { message: OpenRouterMessage; finish_reason: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      inputTokens += data.usage?.prompt_tokens ?? 0;
      outputTokens += data.usage?.completion_tokens ?? 0;
      const message = data.choices[0]?.message;
      if (!message) throw new Error('OpenRouter returned no choices');

      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        const text = (message.content ?? '').trim();
        if (!text) throw new Error('Empty model response');
        return { text, usage: { inputTokens, outputTokens, model: request.model } };
      }

      messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: toolCalls });
      const runOne = async (call: (typeof toolCalls)[number]) => {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          // model bozuk JSON üretti — hata olarak geri bildir, düzeltsin
        }
        const result = await request.executeTool({ id: call.id, name: call.function.name, input });
        return {
          role: 'tool' as const,
          tool_call_id: call.id,
          content: result.isError ? `HATA: ${result.output}` : result.output,
        };
      };
      // #1070 — tümü read-only ise paralel; yazan tool varsa sıralı (anthropic
      // provider'la aynı kural, sonuç sırası korunur).
      const readOnlyNames = new Set(request.tools.filter((t) => t.readOnly).map((t) => t.name));
      if (toolCalls.length > 1 && toolCalls.every((c) => readOnlyNames.has(c.function.name))) {
        messages.push(...(await Promise.all(toolCalls.map(runOne))));
      } else {
        for (const call of toolCalls) messages.push(await runOne(call));
      }
      this.logger.debug(
        `tool iteration ${i + 1}: ${toolCalls.map((t) => t.function.name).join(', ')}`,
      );
    }
    throw new Error(`Tool loop exceeded ${maxIterations} iterations`);
  }
}
