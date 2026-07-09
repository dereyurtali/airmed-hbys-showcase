import { Injectable, Logger } from '@nestjs/common';
import { scrubText } from '@airmed/observability';
import { AdminPrismaService } from '../../prisma/admin-prisma.service';

// #1087 — DB derin analiz servisi (İZLEME › Veritabanı). Tümü istek-anında
// read-only raw SQL (snapshot'a yazılmaz — ağır seri gerekmez). pg_catalog +
// pg_stat_* görünümleri. Sorgu metinleri asla parametre değeri taşımaz
// (pg_stat_statements normalize eder) + scrubText güvenlik ağı.

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

@Injectable()
export class PlatformDbStatsService {
  private readonly logger = new Logger(PlatformDbStatsService.name);

  constructor(private readonly admin: AdminPrismaService) {}

  /** Tablo-bazlı boyut + canlı/ölü satır + scan oranı (boyuta göre sıralı). */
  async tables(limit = 50): Promise<DbTableStat[]> {
    const rows = await this.admin.$queryRawUnsafe<
      {
        name: string;
        total_bytes: bigint;
        table_bytes: bigint;
        index_bytes: bigint;
        toast_bytes: bigint;
        live_rows: bigint;
        dead_rows: bigint;
        seq_scan: bigint;
        idx_scan: bigint;
        last_autovacuum: Date | null;
      }[]
    >(
      `SELECT
         c.relname AS name,
         pg_total_relation_size(c.oid) AS total_bytes,
         pg_table_size(c.oid) AS table_bytes,
         pg_indexes_size(c.oid) AS index_bytes,
         COALESCE(pg_total_relation_size(c.reltoastrelid), 0) AS toast_bytes,
         COALESCE(s.n_live_tup, 0) AS live_rows,
         COALESCE(s.n_dead_tup, 0) AS dead_rows,
         COALESCE(s.seq_scan, 0) AS seq_scan,
         COALESCE(s.idx_scan, 0) AS idx_scan,
         s.last_autovacuum
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
       WHERE c.relkind = 'r' AND n.nspname = 'public'
       ORDER BY pg_total_relation_size(c.oid) DESC
       LIMIT $1`,
      limit,
    );
    return rows.map((r) => {
      const live = Number(r.live_rows);
      const dead = Number(r.dead_rows);
      return {
        name: r.name,
        totalBytes: Number(r.total_bytes),
        tableBytes: Number(r.table_bytes),
        indexBytes: Number(r.index_bytes),
        toastBytes: Number(r.toast_bytes),
        liveRows: live,
        deadRows: dead,
        deadRatio: live + dead > 0 ? dead / (live + dead) : 0,
        seqScan: Number(r.seq_scan),
        idxScan: Number(r.idx_scan),
        lastAutovacuum: r.last_autovacuum ? r.last_autovacuum.toISOString() : null,
      };
    });
  }

  /** Hiç kullanılmayan index'ler (idx_scan=0) — bloat/gereksiz radar. */
  async unusedIndexes(): Promise<DbIndexStat[]> {
    const rows = await this.admin.$queryRawUnsafe<
      { table: string; index: string; size_bytes: bigint; scans: bigint }[]
    >(
      `SELECT
         relname AS table,
         indexrelname AS index,
         pg_relation_size(indexrelid) AS size_bytes,
         idx_scan AS scans
       FROM pg_stat_user_indexes
       WHERE idx_scan = 0
       ORDER BY pg_relation_size(indexrelid) DESC
       LIMIT 50`,
    );
    return rows.map((r) => ({
      table: r.table,
      index: r.index,
      sizeBytes: Number(r.size_bytes),
      scans: Number(r.scans),
    }));
  }

  /** pg_stat_statements top-20 (mean süreye göre). Extension yoksa null. */
  async slowQueries(): Promise<DbSlowQuery[] | null> {
    try {
      const rows = await this.admin.$queryRawUnsafe<
        { query: string; calls: bigint; mean_ms: number; total_ms: number }[]
      >(
        `SELECT query, calls, mean_exec_time AS mean_ms, total_exec_time AS total_ms
         FROM pg_stat_statements
         ORDER BY mean_exec_time DESC
         LIMIT 20`,
      );
      return rows.map((r) => ({
        // Parametre değeri normalize (pg_stat_statements) + scrubText güvenlik ağı.
        query: scrubText(r.query).slice(0, 300),
        calls: Number(r.calls),
        meanMs: Math.round(r.mean_ms * 100) / 100,
        totalMs: Math.round(r.total_ms),
      }));
    } catch {
      // Extension yüklü değil (staging senaryosu).
      return null;
    }
  }

  /** audit_logs aylık partition'ları + büyüyen operasyonel tablolar. */
  async partitions(): Promise<DbPartition[]> {
    const rows = await this.admin.$queryRawUnsafe<
      { name: string; size_bytes: bigint; rows: bigint }[]
    >(
      `SELECT
         c.relname AS name,
         pg_total_relation_size(c.oid) AS size_bytes,
         COALESCE(s.n_live_tup, 0) AS rows
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
       WHERE c.relkind IN ('r', 'p')
         AND n.nspname = 'public'
         AND (c.relname LIKE 'audit_logs%' OR c.relname IN ('refresh_tokens', 'notifications', 'agent_messages'))
       ORDER BY c.relname`,
    );
    return rows.map((r) => ({
      name: r.name,
      sizeBytes: Number(r.size_bytes),
      rows: Number(r.rows),
    }));
  }
}
