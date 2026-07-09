// #1091 — Hibrit senkron izleme DTO'ları (PlatformSyncService ile birebir).
export interface SyncSummary {
  pendingOutbox: number;
  deadLetter: number;
  synced24h: number;
  openConflicts: number;
}
export interface DeadLetterRow {
  id: string;
  tenantId: string | null;
  entityType: string;
  operation: string;
  retryCount: number;
  failedAt: string | null;
  lastError: string | null;
}
export interface ConflictRow {
  id: string;
  tenantId: string | null;
  entityType: string;
  conflictType: string;
  occurredAt: string;
  createdAt: string;
}
