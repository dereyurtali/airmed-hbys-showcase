// #1085/#1086 — Platform metrik snapshot DTO (api PlatformMetricsService ile
// birebir). REST: /platform/metrics/latest + /range.
export interface MetricsSnapshot {
  id: string;
  capturedAt: string;
  dbSizeBytes: number;
  dbConnActive: number;
  dbConnIdle: number;
  dbConnIdleInTx: number;
  dbConnTotal: number;
  slowQueryCount: number | null;
  nodeHeapUsedBytes: number;
  nodeRssBytes: number;
  nodeEventLoopLagMs: number;
  hostCpuPct: number;
  hostMemUsedBytes: number;
  hostMemTotalBytes: number;
  hostDiskUsedBytes: number;
  hostDiskTotalBytes: number;
  tenantCounts: Record<string, number>;
  activeUsers: number;
  activeSessions: number;
}

// #1087 — DB derin analiz DTO'ları (PlatformDbStatsService ile birebir).
export interface DbTableStat {
  name: string;
  totalBytes: number;
  tableBytes: number;
  indexBytes: number;
  toastBytes: number;
  liveRows: number;
  deadRows: number;
  deadRatio: number;
  seqScan: number;
  idxScan: number;
  lastAutovacuum: string | null;
}
export interface DbIndexStat {
  table: string;
  index: string;
  sizeBytes: number;
  scans: number;
}
export interface DbSlowQuery {
  query: string;
  calls: number;
  meanMs: number;
  totalMs: number;
}
export interface DbPartition {
  name: string;
  sizeBytes: number;
  rows: number;
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** Byte → okunabilir (1024 tabanı). 0/negatif → '—'. */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${UNITS[i]}`;
}

/** used/total → doluluk %. total 0 → null (bilinmiyor). */
export function usagePct(used: number, total: number): number | null {
  if (!total || total <= 0) return null;
  return Math.min(100, (used / total) * 100);
}
