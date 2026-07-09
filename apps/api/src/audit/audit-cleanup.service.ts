import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AdminPrismaService } from '../prisma/admin-prisma.service';

// A13 Audit retention — kanonik tablo "180 gün (partition)".
//
// #957 — audit_logs artık aylık RANGE partition (created_at). Retention =
// eski partition'ları tamamen DROP (drop_old_audit_partitions fonksiyonu) →
// DELETE'in disk + WAL maliyeti yok. Ayrıca gelecek aylar için partition'lar
// önden yaratılır (ensure_audit_log_partition) → write asla 'no partition'.
// DEFAULT partition (emniyet ağı) old satır barındırırsa bounded DELETE ile
// temizlenir.
//
// platform_audit_logs (cross-tenant, düşük hacim) DÜZ tablo kalır; 1 yıl
// retention basit DELETE ile (partition maliyetine değmez — kararı #957).
//
// Cron her gece 03:15 (Asia/Dushanbe) — klinik dışı saatte çalışır.
//
// Her iki tablo da RLS/BYPASSRLS gerektirir (cross-tenant) → airmed_bg
// (BYPASSRLS). #1065 — paylaşımlı AdminPrismaService (tek havuz).

const RETENTION_DAYS_DEFAULT = 180;
const PLATFORM_RETENTION_DAYS_DEFAULT = 365;
const BATCH_SIZE = 5000;

@Injectable()
export class AuditCleanupService {
  private readonly logger = new Logger(AuditCleanupService.name);

  constructor(private readonly admin: AdminPrismaService) {}

  private retentionDays(): number {
    const raw = process.env.AUDIT_LOG_RETENTION_DAYS;
    if (!raw) return RETENTION_DAYS_DEFAULT;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 30 && n <= 3650 ? n : RETENTION_DAYS_DEFAULT;
  }

  private platformRetentionDays(): number {
    const raw = process.env.PLATFORM_AUDIT_LOG_RETENTION_DAYS;
    if (!raw) return PLATFORM_RETENTION_DAYS_DEFAULT;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 90 && n <= 3650 ? n : PLATFORM_RETENTION_DAYS_DEFAULT;
  }

  @Cron('15 3 * * *', { name: 'audit-cleanup', timeZone: 'Asia/Dushanbe' })
  async scheduledCleanup(): Promise<void> {
    try {
      await this.ensureRollingPartitions();
      const { droppedPartitions, deletedDefaultRows } = await this.purgeOnce();
      const platformDeleted = await this.purgePlatformAuditOnce();
      if (droppedPartitions > 0 || deletedDefaultRows > 0 || platformDeleted > 0) {
        this.logger.log(
          `audit retention: dropped ${droppedPartitions} old partition(s) + ${deletedDefaultRows} ` +
            `default rows (clinic ${this.retentionDays()}d), deleted ${platformDeleted} platform rows ` +
            `(${this.platformRetentionDays()}d)`,
        );
      }
    } catch (err) {
      this.logger.error(`audit cleanup failed: ${(err as Error).message}`);
    }
  }

  // #957 — bu ay + gelecek 2 ay partition'larını garanti et. Cron başarısız olsa
  // bile birkaç ay tampon → write 'no partition' ile düşmez.
  async ensureRollingPartitions(): Promise<void> {
    await this.admin.$executeRawUnsafe(
      `SELECT ensure_audit_log_partition(date_trunc('month', now())::date)`,
    );
    await this.admin.$executeRawUnsafe(
      `SELECT ensure_audit_log_partition((date_trunc('month', now()) + interval '1 month')::date)`,
    );
    await this.admin.$executeRawUnsafe(
      `SELECT ensure_audit_log_partition((date_trunc('month', now()) + interval '2 months')::date)`,
    );
  }

  // #957 — audit_logs retention: eski aylık partition'ları DROP + DEFAULT
  // partition'daki (edge case) eski satırları bounded DELETE. İdempotent.
  async purgeOnce(): Promise<{ droppedPartitions: number; deletedDefaultRows: number }> {
    const days = this.retentionDays();
    const droppedResult = await this.admin.$queryRawUnsafe<{ dropped: number }[]>(
      `SELECT drop_old_audit_partitions($1) AS dropped`,
      days,
    );
    const droppedPartitions = Number(droppedResult[0]?.dropped ?? 0);

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    let deletedDefaultRows = 0;
    for (;;) {
      const n = await this.admin.$executeRawUnsafe(
        `DELETE FROM audit_logs_default
          WHERE ctid IN (
            SELECT ctid FROM audit_logs_default WHERE created_at < $1 LIMIT ${BATCH_SIZE}
          )`,
        cutoff,
      );
      deletedDefaultRows += Number(n);
      if (Number(n) < BATCH_SIZE) break;
    }
    return { droppedPartitions, deletedDefaultRows };
  }

  // #957 — platform_audit_logs (düz tablo, düşük hacim) 1 yıl DELETE retention.
  async purgePlatformAuditOnce(): Promise<number> {
    const cutoff = new Date(Date.now() - this.platformRetentionDays() * 24 * 60 * 60 * 1000);
    let total = 0;
    for (;;) {
      const n = await this.admin.$executeRawUnsafe(
        `DELETE FROM platform_audit_logs
          WHERE id IN (
            SELECT id FROM platform_audit_logs WHERE created_at < $1 LIMIT ${BATCH_SIZE}
          )`,
        cutoff,
      );
      total += Number(n);
      if (Number(n) < BATCH_SIZE) break;
    }
    return total;
  }
}
