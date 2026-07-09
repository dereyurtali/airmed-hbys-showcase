// #1089 — AI asistan rollup DTO'ları (PlatformAiService ile birebir).
export interface AiSummary {
  activeTenants: number;
  conversations7d: number;
  messages7d: number;
  handoffRate: number;
  errors7d: number;
  tokens7d: number;
}
export interface AiTenantRow {
  tenantId: string;
  conversations7d: number;
  handoffs7d: number;
  errors7d: number;
  inputTokens7d: number;
  outputTokens7d: number;
}
export interface AiErrorRow {
  id: string;
  tenantId: string;
  summary: string;
  createdAt: string;
}
