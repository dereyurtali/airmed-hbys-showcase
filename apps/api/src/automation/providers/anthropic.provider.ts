import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  DEFAULT_MAX_TOOL_ITERATIONS,
  type IModelProvider,
  type RunTurnRequest,
  type RunTurnResult,
} from '../model-provider';

// #1021 — Anthropic sağlayıcısı. Manuel agentic loop (tool runner beta yerine):
// insan-devri/hata yollarını orkestratör kontrol ettiği için iterasyon tavanı
// ve tool sonuç toplama davranışı explicit. Kurallar:
//  - adaptive thinking (sampling parametresi YOK — 4.8'de 400 döner)
//  - paralel tool_use blokları TEK user mesajında tool_result olarak döner
//  - hata veren tool is_error:true ile geri gider (model alternatif önerir)
// API key SDK'nın kendi env çözümlemesinden (ANTHROPIC_API_KEY).

@Injectable()
export class AnthropicProvider implements IModelProvider {
  readonly key = 'anthropic' as const;
  private readonly logger = new Logger(AnthropicProvider.name);
  private envClient: Anthropic | null = null;

  // #1034 — anahtar önceliği: request.apiKey (DB, ekrandan) > env. Env client
  // tekil; DB anahtarı değişebilir olduğundan çağrı başına kurulur (hafif).
  private getClient(apiKey?: string): Anthropic {
    if (apiKey) return new Anthropic({ apiKey });
    this.envClient ??= new Anthropic();
    return this.envClient;
  }

  async runTurn(request: RunTurnRequest): Promise<RunTurnResult> {
    const client = this.getClient(request.apiKey);
    const tools: Anthropic.Tool[] = request.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));
    const messages: Anthropic.MessageParam[] = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const maxIterations = request.maxIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    // #1089 — tur boyunca (tool döngüsü dahil) token toplamı.
    let inputTokens = 0;
    let outputTokens = 0;
    for (let i = 0; i < maxIterations; i++) {
      const response = await client.messages.create({
        model: request.model,
        max_tokens: 8192,
        thinking: { type: 'adaptive' },
        system: request.systemPrompt,
        tools,
        messages,
      });
      inputTokens += response.usage?.input_tokens ?? 0;
      outputTokens += response.usage?.output_tokens ?? 0;

      if (response.stop_reason === 'refusal') {
        throw new Error('Model refused to respond');
      }

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        if (!text) throw new Error(`Empty model response (stop: ${response.stop_reason})`);
        return { text, usage: { inputTokens, outputTokens, model: request.model } };
      }

      messages.push({ role: 'assistant', content: response.content });
      const runOne = async (
        use: Anthropic.ToolUseBlock,
      ): Promise<Anthropic.ToolResultBlockParam> => {
        const result = await request.executeTool({
          id: use.id,
          name: use.name,
          input: (use.input ?? {}) as Record<string, unknown>,
        });
        return {
          type: 'tool_result',
          tool_use_id: use.id,
          content: result.output,
          ...(result.isError ? { is_error: true } : {}),
        };
      };
      // #1070 — turdaki tool'ların TÜMÜ read-only ise paralel çalıştır (her
      // tool kendi kısa tenant tx'inde bağımsız); yazan tool karışıyorsa
      // sıralı-deterministik kal. Sonuç sırası her iki yolda da korunur.
      const readOnlyNames = new Set(request.tools.filter((t) => t.readOnly).map((t) => t.name));
      let results: Anthropic.ToolResultBlockParam[];
      if (toolUses.length > 1 && toolUses.every((u) => readOnlyNames.has(u.name))) {
        results = await Promise.all(toolUses.map(runOne));
      } else {
        results = [];
        for (const use of toolUses) results.push(await runOne(use));
      }
      messages.push({ role: 'user', content: results });
      this.logger.debug(`tool iteration ${i + 1}: ${toolUses.map((t) => t.name).join(', ')}`);
    }
    throw new Error(`Tool loop exceeded ${maxIterations} iterations`);
  }
}
