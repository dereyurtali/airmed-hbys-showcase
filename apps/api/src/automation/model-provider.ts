// EPIC #1018 / #1021 — Model soyutlaması. Orkestratör bu arayüz üzerinden
// çalışır; AgentConfig.provider ile Anthropic / OpenRouter arasında kod
// değişmeden geçilir.
//
// Tasarım: agentic tool-use DÖNGÜSÜ provider'ın İÇİNDE (her sağlayıcının
// mesaj/tool telgraf formatı farklı — Anthropic tool_use blokları vs OpenAI
// tool_calls). Orkestratör yalnız `executeTool` callback'i verir; her tool
// çağrısı orkestratör tarafında KISA tenant-scoped transaction'da koşar
// (LLM çağrısı asla açık DB transaction'ı içinde beklenmez — 5sn tx timeout
// + bağlantı havuzu, bkz. PrismaService.runWithTenant notu).

export interface AgentToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema (object)
  // #1070 — true = yan etkisiz okuma; model tek turda birden çok read-only
  // tool döndürürse provider bunları paralel çalıştırabilir. Yazan tool'lar
  // (randevu_olustur vb.) işaretlenmez → sıralı-deterministik kalır.
  readOnly?: boolean;
}

export interface AgentToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolExecutionResult {
  output: string;
  isError?: boolean;
}

export type ToolExecutor = (call: AgentToolCall) => Promise<ToolExecutionResult>;

export interface AgentHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RunTurnRequest {
  model: string;
  systemPrompt: string;
  /** #1034 — DB'den çözülen sağlayıcı anahtarı; yoksa provider env'e düşer. */
  apiKey?: string;
  messages: AgentHistoryMessage[];
  tools: AgentToolDefinition[];
  executeTool: ToolExecutor;
  /** Tool döngüsü emniyet tavanı (default 8). */
  maxIterations?: number;
}

export interface RunTurnResult {
  /** Hastaya gönderilecek nihai metin. */
  text: string;
  /** #1089 — tur boyunca (tool döngüsü dahil) toplam token kullanımı. */
  usage?: { inputTokens: number; outputTokens: number; model: string };
}

export interface IModelProvider {
  readonly key: 'anthropic' | 'openrouter';
  runTurn(request: RunTurnRequest): Promise<RunTurnResult>;
}

export const DEFAULT_MAX_TOOL_ITERATIONS = 8;
