// A12 — Sync protocol tipleri.
// Worker LOCAL → CLOUD batch POST; receive endpoint payload'ları snake_case
// column adlarıyla doğrudan INSERT ON CONFLICT UPDATE'a aktarır.

export interface SyncEvent {
  id: string;
  source: string;
  entityType: string;
  entityId: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  tenantId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string; // ISO
}

export interface SyncBatch {
  events: SyncEvent[];
}

export interface SyncBatchResult {
  applied: number;
  failed: Array<{ eventId: string; error: string }>;
}
