import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { AdminPrismaService } from '../prisma/admin-prisma.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import {
  FraudAlertListQuery,
  FraudAlertUpdateStatusInput,
  FraudRuleToggleInput,
} from './fraud.schemas';

// E6 Fraud Detection servisi (v0.2 dilimi).
//
// Yetki: yonetici / yonetici_asistani.
//
// Detector akışı:
// - scanTenant(tenantId) her aktif kurala karşılık 4 ayrı SQL/Prisma sorgusu
//   çalıştırır. Eşleşmeler için FraudAlert satırı oluşturur.
// - signatureKey deterministik (örn. "night_op:audit:<auditId>") — aynı uyarı
//   tekrarlanmaz (unique constraint).
// - scanAll cron her saat tüm tenant'lar için çalışır (admin client ile).
//
// Default kurallar tenant'ta yoksa otomatik upsert edilir (ensureDefaultRules).

interface Actor {
  id: string;
  roles: readonly string[];
}

type FraudRuleKey =
  | 'night_operations'
  | 'stock_consume_without_surgery'
  | 'multi_ip_login'
  | 'frequent_patient_appointment';

interface RuleDefault {
  key: FraudRuleKey;
  name: string;
  severity: 'low' | 'medium' | 'high';
  config: Record<string, number | string>;
}

const DEFAULT_RULES: RuleDefault[] = [
  {
    key: 'night_operations',
    name: 'Gece saatinde işlem (22:00-06:00)',
    severity: 'medium',
    config: { startHour: 22, endHour: 6, timezone: 'Asia/Dushanbe', windowHours: 24 },
  },
  {
    key: 'stock_consume_without_surgery',
    name: 'Cerrahi olmadan IOL stok düşümü',
    severity: 'high',
    config: { windowHours: 24 },
  },
  {
    key: 'multi_ip_login',
    name: 'Aynı kullanıcı, 1 saat içinde farklı IP',
    severity: 'medium',
    config: { windowMinutes: 60, threshold: 2 },
  },
  {
    key: 'frequent_patient_appointment',
    name: 'Aynı hasta, 30 gün içinde 6+ randevu',
    severity: 'medium',
    config: { windowDays: 30, threshold: 6 },
  },
];

@Injectable()
export class FraudDetectionService {
  private readonly logger = new Logger(FraudDetectionService.name);

  // #1065 — paylaşımlı AdminPrismaService (tek havuz).
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly admin: AdminPrismaService,
  ) {}

  // -------------------- Public read/update endpoints --------------------

  async listAlerts(q: FraudAlertListQuery, actor: Actor) {
    this.assertAdmin(actor);
    return this.prisma.scoped.fraudAlert.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.severity ? { severity: q.severity } : {}),
        ...(q.ruleKey ? { ruleKey: q.ruleKey } : {}),
        ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
      take: q.limit,
      include: {
        rule: { select: { id: true, key: true, name: true, severity: true } },
        actorUser: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });
  }

  async findAlertById(id: string, actor: Actor) {
    this.assertAdmin(actor);
    const a = await this.prisma.scoped.fraudAlert.findFirst({
      where: { id },
      include: {
        rule: true,
        actorUser: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });
    if (!a) throw new NotFoundException('Alert not found');
    return a;
  }

  async updateAlertStatus(input: FraudAlertUpdateStatusInput, actor: Actor) {
    this.assertAdmin(actor);
    const alert = await this.findAlertById(input.id, actor);
    return this.prisma.scoped.fraudAlert.update({
      where: { id: alert.id },
      data: {
        status: input.status,
        reviewNote: input.reviewNote ?? alert.reviewNote,
        reviewedById: actor.id,
        reviewedAt: new Date(),
      },
    });
  }

  async listRules(actor: Actor) {
    this.assertAdmin(actor);
    const tenantId = this.tenantContext.requireTenantId();
    await this.ensureDefaultRules(tenantId);
    return this.prisma.scoped.fraudRule.findMany({
      orderBy: [{ severity: 'desc' }, { key: 'asc' }],
    });
  }

  async toggleRule(input: FraudRuleToggleInput, actor: Actor) {
    this.assertAdmin(actor);
    const r = await this.prisma.scoped.fraudRule.findFirst({ where: { id: input.id } });
    if (!r) throw new NotFoundException('Rule not found');
    return this.prisma.scoped.fraudRule.update({
      where: { id: input.id },
      data: { isActive: input.isActive },
    });
  }

  // On-demand manuel tarama (admin sayfasındaki "Şimdi tara" butonu).
  async scanNow(actor: Actor): Promise<{ created: number }> {
    this.assertAdmin(actor);
    const tenantId = this.tenantContext.requireTenantId();
    return this.scanTenant(tenantId);
  }

  // -------------------- Cron + per-tenant scan --------------------

  @Cron('5 * * * *', { name: 'fraud-scan', timeZone: 'Asia/Dushanbe' })
  async scanAll(): Promise<void> {
    try {
      const tenants = await this.admin.tenant.findMany({
        where: { status: 'active', deletedAt: null },
        select: { id: true },
      });
      for (const t of tenants) {
        const r = await this.scanTenantWithAdminClient(t.id);
        if (r.created > 0) {
          this.logger.log(`tenant ${t.id}: created ${r.created} alerts`);
        }
      }
    } catch (err) {
      this.logger.error(`scanAll failed: ${(err as Error).message}`);
    }
  }

  // #937 — admin (BYPASSRLS) client ile çalışır; scanTenantWithAdminClient'a
  // delege eder (yanıltıcı "RLS-aware/scoped client" yorumu düzeltildi). Manual
  // scanNow için.
  async scanTenant(tenantId: string): Promise<{ created: number }> {
    return this.scanTenantWithAdminClient(tenantId);
  }

  // Admin client ile per-tenant scan — cron + manual ortak yol.
  // Tenant filter'ı tenantId parametresi ile zorlanır.
  private async scanTenantWithAdminClient(tenantId: string): Promise<{ created: number }> {
    await this.ensureDefaultRulesWithAdmin(tenantId);
    const activeRules = await this.admin.fraudRule.findMany({
      where: { tenantId, isActive: true },
    });

    let created = 0;
    for (const rule of activeRules) {
      try {
        const inserts = await this.runRule(tenantId, rule);
        created += inserts;
      } catch (err) {
        this.logger.warn(
          `rule ${rule.key} failed for tenant ${tenantId}: ${(err as Error).message}`,
        );
      }
    }
    return { created };
  }

  private async runRule(
    tenantId: string,
    rule: { id: string; key: FraudRuleKey; severity: 'low' | 'medium' | 'high'; config: unknown },
  ): Promise<number> {
    switch (rule.key) {
      case 'night_operations':
        return this.detectNightOperations(tenantId, rule);
      case 'stock_consume_without_surgery':
        return this.detectStockConsumeWithoutSurgery(tenantId, rule);
      case 'multi_ip_login':
        return this.detectMultiIpLogin(tenantId, rule);
      case 'frequent_patient_appointment':
        return this.detectFrequentPatientAppointment(tenantId, rule);
    }
  }

  // -------------------- Detectors --------------------

  // 22:00-06:00 (Asia/Dushanbe) içinde audit_logs'ta create/update/delete.
  // windowHours geriye doğru tarama.
  private async detectNightOperations(
    tenantId: string,
    rule: { id: string; key: FraudRuleKey; severity: 'low' | 'medium' | 'high'; config: unknown },
  ): Promise<number> {
    const cfg =
      (rule.config as { windowHours?: number; startHour?: number; endHour?: number }) ?? {};
    const windowHours = cfg.windowHours ?? 24;
    const startHour = cfg.startHour ?? 22;
    const endHour = cfg.endHour ?? 6;
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    // `created_at` Prisma `DateTime` → naive `timestamp`. Önce UTC olarak işaretleyip
    // sonra Dushanbe'ye çevir; tek `AT TIME ZONE 'Asia/Dushanbe'` naive değeri
    // Dushanbe-local sanıp 5 saat geri çevirir (yanlış yön).
    // Parantez: `AND … AND HOUR>=22 OR HOUR<6` precedence'i tenant/zaman filtresini
    // atlatır — gece koşulunu tek bir OR bloğunda topluyoruz.
    const rows = await this.admin.$queryRaw<
      {
        id: string;
        user_id: string | null;
        action: string;
        entity_type: string | null;
        entity_id: string | null;
        created_at: Date;
      }[]
    >`
      SELECT id, user_id, action, entity_type, entity_id, created_at
      FROM audit_logs
      WHERE tenant_id = ${tenantId}::uuid
        AND created_at >= ${since}
        AND (
          EXTRACT(HOUR FROM (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dushanbe')) >= ${startHour}::int
          OR EXTRACT(HOUR FROM (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dushanbe')) < ${endHour}::int
        )
    `;

    let count = 0;
    for (const r of rows) {
      const sig = `night_op:audit:${r.id}`;
      const ok = await this.insertAlertIfNew(tenantId, rule.id, rule.key, rule.severity, sig, {
        actorUserId: r.user_id,
        entityType: r.entity_type,
        entityId: r.entity_id,
        details: { action: r.action, occurredAt: r.created_at.toISOString() },
      });
      if (ok) count++;
    }
    return count;
  }

  // IolStockMovement type=consume + surgeryId null → cerrahi referansı olmadan
  // sarf düşümü. windowHours içinde olanları tara.
  private async detectStockConsumeWithoutSurgery(
    tenantId: string,
    rule: { id: string; key: FraudRuleKey; severity: 'low' | 'medium' | 'high'; config: unknown },
  ): Promise<number> {
    const cfg = (rule.config as { windowHours?: number }) ?? {};
    const windowHours = cfg.windowHours ?? 24;
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const movements = await this.admin.iolStockMovement.findMany({
      where: {
        tenantId,
        type: 'consume',
        surgeryId: null,
        createdAt: { gte: since },
      },
      select: {
        id: true,
        lotId: true,
        quantity: true,
        createdById: true,
        createdAt: true,
      },
    });

    let count = 0;
    for (const m of movements) {
      const sig = `stock_no_surgery:${m.id}`;
      const ok = await this.insertAlertIfNew(tenantId, rule.id, rule.key, rule.severity, sig, {
        actorUserId: m.createdById,
        entityType: 'iol_stock_movement',
        entityId: m.id,
        details: { lotId: m.lotId, quantity: m.quantity, occurredAt: m.createdAt.toISOString() },
      });
      if (ok) count++;
    }
    return count;
  }

  // Aynı user_id için son windowMinutes içinde threshold+ farklı IP.
  private async detectMultiIpLogin(
    tenantId: string,
    rule: { id: string; key: FraudRuleKey; severity: 'low' | 'medium' | 'high'; config: unknown },
  ): Promise<number> {
    const cfg = (rule.config as { windowMinutes?: number; threshold?: number }) ?? {};
    const windowMinutes = cfg.windowMinutes ?? 60;
    const threshold = cfg.threshold ?? 2;
    const since = new Date(Date.now() - windowMinutes * 60 * 1000);

    const rows = await this.admin.$queryRaw<{ user_id: string; ip_count: bigint; ips: string[] }[]>`
      SELECT user_id, COUNT(DISTINCT ip) AS ip_count, array_agg(DISTINCT ip::text) AS ips
      FROM audit_logs
      WHERE tenant_id = ${tenantId}::uuid
        AND action = 'auth.login.success'
        AND user_id IS NOT NULL
        AND ip IS NOT NULL
        -- created_at naive timestamp (UTC duvar-saati saklanir). Dogrudan
        -- timestamptz since ile karsilastirinca Postgres naive degeri session
        -- TZ (Asia/Dushanbe) sayar; pencere kayar. UTC olarak isaretle.
        AND (created_at AT TIME ZONE 'UTC') >= ${since}
      GROUP BY user_id
      HAVING COUNT(DISTINCT ip) >= ${threshold}::int
    `;

    let count = 0;
    for (const r of rows) {
      // Bucket the window into hour slots so the same actor can trigger again
      // in a new window without dedup'ing it away.
      const bucket = Math.floor(Date.now() / (windowMinutes * 60 * 1000));
      const sig = `multi_ip:${r.user_id}:${bucket}`;
      const ok = await this.insertAlertIfNew(tenantId, rule.id, rule.key, rule.severity, sig, {
        actorUserId: r.user_id,
        entityType: 'user',
        entityId: r.user_id,
        details: {
          ipCount: Number(r.ip_count),
          ips: r.ips,
          windowMinutes,
        },
      });
      if (ok) count++;
    }
    return count;
  }

  // Aynı hasta için son windowDays içinde threshold+ randevu.
  private async detectFrequentPatientAppointment(
    tenantId: string,
    rule: { id: string; key: FraudRuleKey; severity: 'low' | 'medium' | 'high'; config: unknown },
  ): Promise<number> {
    const cfg = (rule.config as { windowDays?: number; threshold?: number }) ?? {};
    const windowDays = cfg.windowDays ?? 30;
    const threshold = cfg.threshold ?? 6;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const rows = await this.admin.$queryRaw<{ patient_id: string; cnt: bigint }[]>`
      SELECT patient_id, COUNT(*) AS cnt
      FROM appointments
      WHERE tenant_id = ${tenantId}::uuid
        AND deleted_at IS NULL
        AND starts_at >= ${since}
      GROUP BY patient_id
      HAVING COUNT(*) >= ${threshold}::int
    `;

    let count = 0;
    for (const r of rows) {
      // Pencere bazlı bucket → her windowDays döneminde tekrar alarm.
      const bucket = Math.floor(Date.now() / (windowDays * 24 * 60 * 60 * 1000));
      const sig = `freq_patient:${r.patient_id}:${bucket}`;
      const ok = await this.insertAlertIfNew(tenantId, rule.id, rule.key, rule.severity, sig, {
        actorUserId: null,
        entityType: 'patient',
        entityId: r.patient_id,
        details: { appointmentCount: Number(r.cnt), windowDays },
      });
      if (ok) count++;
    }
    return count;
  }

  // -------------------- Helpers --------------------

  private async insertAlertIfNew(
    tenantId: string,
    ruleId: string,
    ruleKey: FraudRuleKey,
    severity: 'low' | 'medium' | 'high',
    signatureKey: string,
    payload: {
      actorUserId: string | null;
      entityType: string | null;
      entityId: string | null;
      details: Record<string, unknown>;
    },
  ): Promise<boolean> {
    try {
      await this.admin.fraudAlert.create({
        data: {
          tenantId,
          ruleId,
          ruleKey,
          severity,
          signatureKey,
          actorUserId: payload.actorUserId,
          entityType: payload.entityType,
          entityId: payload.entityId,
          details: payload.details as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch (err) {
      const e = err as { code?: string };
      if (e?.code === 'P2002') return false; // dedup
      throw err as Error;
    }
  }

  private async ensureDefaultRules(tenantId: string): Promise<void> {
    return this.ensureDefaultRulesWithAdmin(tenantId);
  }

  private async ensureDefaultRulesWithAdmin(tenantId: string): Promise<void> {
    for (const def of DEFAULT_RULES) {
      await this.admin.fraudRule.upsert({
        where: { tenantId_key: { tenantId, key: def.key } },
        update: {}, // existing rules korunur (admin override edebilir)
        create: {
          tenantId,
          key: def.key,
          name: def.name,
          severity: def.severity,
          config: def.config as Prisma.InputJsonValue,
          isActive: true,
        },
      });
    }
  }

  private assertAdmin(actor: Actor): void {
    const allowed = actor.roles.some((r) => r === 'yonetici' || r === 'yonetici_asistani');
    if (!allowed) {
      throw new ForbiddenException('Fraud detection yalnızca yonetici / yonetici_asistani için');
    }
  }
}
