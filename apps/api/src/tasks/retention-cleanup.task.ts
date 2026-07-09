import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AdminPrismaService } from '../prisma/admin-prisma.service';

// #1060 — Operasyonel/teslimat tablolarının retention prune'u.
// audit_logs (#957 partition) + sync_outbox (#934) çözülmüştü; kalan 7 tablo
// sınırsız büyüyordu (en kritiği refresh_tokens: her login/refresh yeni satır,
// hiç silinmiyordu).
//
// KURAL: tıbbi/mali kayıt niteliği olan HİÇBİR tablo (invoices, examinations,
// measurements, prescriptions...) bu kapsama GİRMEZ; yalnız operasyonel/log
// tabloları silinir. `patient_thread_messages` bilinçli DIŞARIDA: hasta-bağlı
// personel iletişimi tıbbi kayıt sayılabilir — KVKK/Tacik veri-saklama kararı
// verilmeden dokunulmaz (bkz. issue #1060 notu).
//
// Desen: AuditCleanupService (#957) — gecelik cron (03:45, audit-cleanup'tan
// 30dk sonra), BYPASSRLS AdminPrismaService, bounded batch DELETE (tabloyu
// kilitlemez). Silme koşulları index'li kolonlar üzerinden (expires_at,
// read_at, status, resolved_at).

const BATCH_SIZE = 5000;

interface PruneRule {
  /** Log satırında görünen ad. */
  name: string;
  /** cutoff parametresi $1 olarak geçirilir. */
  sql: string;
  days: number;
}

// Retention başlangıç değerleri (issue #1060 önerileri; üründe revize
// edilebilir). Terminal-durum filtreleri aktif satırlara ASLA dokunmaz.
const RULES: PruneRule[] = [
  {
    name: 'refresh_tokens',
    days: 7,
    // Süresi 7+ gün önce dolmuş VEYA 7+ gün önce revoke edilmiş token'lar.
    // Aktif oturumlara dokunmaz (expires_at gelecekte + revoked_at NULL).
    sql: `DELETE FROM refresh_tokens
           WHERE id IN (
             SELECT id FROM refresh_tokens
              WHERE expires_at < $1 OR revoked_at < $1
              LIMIT ${BATCH_SIZE}
           )`,
  },
  {
    name: 'notifications(read)',
    days: 90,
    // Yalnız OKUNMUŞ eski bildirimler; okunmamışlar süresiz kalır.
    sql: `DELETE FROM notifications
           WHERE id IN (
             SELECT id FROM notifications
              WHERE read_at IS NOT NULL AND created_at < $1
              LIMIT ${BATCH_SIZE}
           )`,
  },
  {
    name: 'message_deliveries(terminal)',
    days: 60,
    sql: `DELETE FROM message_deliveries
           WHERE id IN (
             SELECT id FROM message_deliveries
              WHERE status IN ('SENT', 'DELIVERED', 'FAILED') AND created_at < $1
              LIMIT ${BATCH_SIZE}
           )`,
  },
  {
    name: 'webhook_deliveries(terminal)',
    days: 60,
    sql: `DELETE FROM webhook_deliveries
           WHERE id IN (
             SELECT id FROM webhook_deliveries
              WHERE status IN ('delivered', 'dead_letter') AND created_at < $1
              LIMIT ${BATCH_SIZE}
           )`,
  },
  {
    name: 'sync_conflicts(resolved)',
    days: 90,
    sql: `DELETE FROM sync_conflicts
           WHERE id IN (
             SELECT id FROM sync_conflicts
              WHERE resolved_at IS NOT NULL AND resolved_at < $1
              LIMIT ${BATCH_SIZE}
           )`,
  },
  {
    name: 'agent_messages',
    days: 180,
    // Chatbot mesajları — en hızlı büyüyen tablo. Hacim büyürse audit_logs'un
    // aylık RANGE partition modeline geçilir (#957).
    sql: `DELETE FROM agent_messages
           WHERE id IN (
             SELECT id FROM agent_messages
              WHERE created_at < $1
              LIMIT ${BATCH_SIZE}
           )`,
  },
  {
    name: 'recall_attempts',
    days: 365,
    sql: `DELETE FROM recall_attempts
           WHERE id IN (
             SELECT id FROM recall_attempts
              WHERE created_at < $1
              LIMIT ${BATCH_SIZE}
           )`,
  },
];

@Injectable()
export class RetentionCleanupTask {
  private readonly logger = new Logger(RetentionCleanupTask.name);

  constructor(private readonly admin: AdminPrismaService) {}

  @Cron('45 3 * * *', { name: 'retention-cleanup', timeZone: 'Asia/Dushanbe' })
  async scheduledCleanup(): Promise<void> {
    try {
      const summary = await this.pruneOnce();
      const parts = Object.entries(summary).filter(([, n]) => n > 0);
      if (parts.length > 0) {
        this.logger.log(`retention prune: ${parts.map(([k, n]) => `${k}=${n}`).join(' ')}`);
      }
    } catch (err) {
      this.logger.error(`retention cleanup failed: ${(err as Error).message}`);
    }
  }

  /** İdempotent; testte doğrudan çağrılır. Kural başına bounded batch döngüsü. */
  async pruneOnce(): Promise<Record<string, number>> {
    const summary: Record<string, number> = {};
    for (const rule of RULES) {
      const cutoff = new Date(Date.now() - rule.days * 24 * 60 * 60 * 1000);
      let total = 0;
      for (;;) {
        const n = await this.admin.$executeRawUnsafe(rule.sql, cutoff);
        total += Number(n);
        if (Number(n) < BATCH_SIZE) break;
      }
      summary[rule.name] = total;
    }
    return summary;
  }
}
