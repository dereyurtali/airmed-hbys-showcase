import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import type { FieldChange as CosignFieldChange } from './cosign-diff';

// S15-PR23 — Doktorun adına hemşire tarafından yapılan işlemlerin onay
// (co-sign) servisi. Tier'lı bulk approve: low-risk entity tipleri (measurement,
// photo) bulk onaylanabilir; high-risk (prescription, surgery, refund) tek-tek.

const LOW_RISK_ENTITIES = new Set(['measurement', 'measurementOrder', 'photo', 'examination']);

const HIGH_RISK_ENTITIES = new Set([
  'prescription',
  'surgery',
  'refund',
  'discountApproval',
  'consentSigning',
  // R1 (#723) — klinik işlem (enjeksiyon/lazer) güncellemesi de yüksek risk.
  'procedure',
]);

export const cosignListSchema = z.object({
  doctorUserId: z.string().uuid().optional(),
});

export const cosignApproveSchema = z.object({
  auditLogId: z.string().uuid(),
});

export const cosignBulkApproveSchema = z.object({
  entityTypes: z.array(z.string()).min(1),
  beforeAt: z.string().datetime({ offset: true }).optional(),
});

export const cosignRejectSchema = z.object({
  auditLogId: z.string().uuid(),
  reason: z.string().min(10).max(500),
});

export type CosignApproveInput = z.infer<typeof cosignApproveSchema>;
export type CosignBulkApproveInput = z.infer<typeof cosignBulkApproveSchema>;
export type CosignRejectInput = z.infer<typeof cosignRejectSchema>;

interface Actor {
  id: string;
}

export interface CosignPatient {
  id: string;
  name: string;
  mrn: string;
}

// Reçete kalemlerinden kısa özet (ilk 3 ilaç adı, yoksa kalem sayısı).
function summarizePrescription(items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const names = items
    .map((it) =>
      it && typeof it === 'object'
        ? ((it as Record<string, unknown>).name ??
          (it as Record<string, unknown>).drug ??
          (it as Record<string, unknown>).medication ??
          (it as Record<string, unknown>).drugName)
        : null,
    )
    .filter((n): n is string => typeof n === 'string' && n.trim() !== '');
  return names.length > 0 ? names.slice(0, 3).join(', ') : `${items.length} kalem`;
}

@Injectable()
export class AuditCosignService {
  constructor(private readonly prisma: PrismaService) {}

  // Verilen doktorun adına yapılmış ve henüz cosign edilmemiş audit kayıtları.
  // #389 — her satır hasta (ad+MRN) + entity özetiyle zenginleştirilir; doktor
  // hukuken sorumlu olduğu kaydı (hangi hasta / hangi ilaç-ameliyat) görerek onaylar.
  async listPendingForDoctor(doctorUserId: string) {
    const rows = await this.prisma.scoped.auditLog.findMany({
      where: {
        onBehalfOfUserId: doctorUserId,
        cosignedAt: null,
      },
      include: {
        user: { select: { id: true, name: true } },
        nurseSession: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const context = await this.resolveEntityContext(rows);
    const mapped = rows.map((r) => {
      const ctx = r.entityId ? context.get(r.entityId) : undefined;
      // R1 (#723) — payload.diff (audit middleware'in yakaladığı alan-bazlı
      // değişiklik) + risk sınıfı (yüksek riskli klinik kayıtlar önce).
      const payload = (r.payload ?? {}) as { diff?: CosignFieldChange[] };
      const risk: 'high' | 'low' = HIGH_RISK_ENTITIES.has(r.entityType ?? '') ? 'high' : 'low';
      return {
        ...r,
        patient: ctx?.patient ?? null,
        summary: ctx?.summary ?? null,
        diff: Array.isArray(payload.diff) ? payload.diff : null,
        risk,
      };
    });
    // Yüksek riskli (cerrahi/reçete/işlem) önce; eşitlikte createdAt desc (zaten sıralı).
    return mapped.sort((a, b) => {
      if (a.risk !== b.risk) return a.risk === 'high' ? -1 : 1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
  }

  // entityType'a göre entityId → { patient, summary } çözer. Tip başına tek batch
  // sorgu + hastalar tek batch (N+1 yok). Bilinmeyen tip (refund vb.) atlanır.
  private async resolveEntityContext(
    rows: { entityType: string | null; entityId: string | null }[],
  ): Promise<Map<string, { patient: CosignPatient | null; summary: string | null }>> {
    const idsByType = new Map<string, string[]>();
    for (const r of rows) {
      if (!r.entityType || !r.entityId) continue;
      const list = idsByType.get(r.entityType) ?? [];
      list.push(r.entityId);
      idsByType.set(r.entityType, list);
    }

    const sc = this.prisma.scoped;
    const entity = new Map<string, { patientId: string; summary: string | null }>();
    const set = (id: string, patientId: string, summary: string | null) =>
      entity.set(id, { patientId, summary });

    // #1063 — tip başına sorgular bağımsız (zaten `in` ile batch'li) → paralel.
    // Aynı request tx'inde Promise.all repo emsali: admin-overview.getOverview.
    await Promise.all(
      [...idsByType.entries()].map(async ([type, ids]) => {
        if (type === 'surgery') {
          for (const e of await sc.surgery.findMany({
            where: { id: { in: ids } },
            select: { id: true, patientId: true, type: true },
          }))
            set(e.id, e.patientId, e.type);
        } else if (type === 'examination') {
          for (const e of await sc.examination.findMany({
            where: { id: { in: ids } },
            select: { id: true, patientId: true, diagnosis: true },
          }))
            set(e.id, e.patientId, e.diagnosis);
        } else if (type === 'prescription') {
          for (const e of await sc.prescription.findMany({
            where: { id: { in: ids } },
            select: { id: true, patientId: true, items: true },
          }))
            set(e.id, e.patientId, summarizePrescription(e.items));
        } else if (type === 'measurement') {
          for (const e of await sc.measurement.findMany({
            where: { id: { in: ids } },
            select: { id: true, patientId: true, type: true },
          }))
            set(e.id, e.patientId, e.type);
        } else if (type === 'measurementOrder') {
          for (const e of await sc.measurementOrder.findMany({
            where: { id: { in: ids } },
            select: { id: true, patientId: true, requestedTypes: true },
          }))
            set(e.id, e.patientId, e.requestedTypes.join(', '));
        } else if (type === 'photo') {
          for (const e of await sc.patientPhoto.findMany({
            where: { id: { in: ids } },
            select: { id: true, patientId: true },
          }))
            set(e.id, e.patientId, null);
        }
      }),
    );

    const patientIds = [...new Set([...entity.values()].map((v) => v.patientId))];
    const patients = patientIds.length
      ? await sc.patient.findMany({
          where: { id: { in: patientIds } },
          select: { id: true, firstName: true, lastName: true, mrn: true },
        })
      : [];
    const patientById = new Map<string, CosignPatient>(
      patients.map((p) => [p.id, { id: p.id, name: `${p.firstName} ${p.lastName}`, mrn: p.mrn }]),
    );

    const result = new Map<string, { patient: CosignPatient | null; summary: string | null }>();
    for (const [entityId, { patientId, summary }] of entity) {
      result.set(entityId, { patient: patientById.get(patientId) ?? null, summary });
    }
    return result;
  }

  // Tek bir audit'i onayla (her seviye için OK).
  async approve(input: CosignApproveInput, actor: Actor) {
    const row = await this.prisma.scoped.auditLog.findFirst({
      where: { id: input.auditLogId },
      // #957 — audit_logs composite PK (id, createdAt); update locator ikisini ister.
      select: {
        id: true,
        createdAt: true,
        onBehalfOfUserId: true,
        cosignedAt: true,
        entityType: true,
      },
    });
    if (!row) throw new BadRequestException('Audit log bulunamadı');
    if (row.cosignedAt) return row;
    if (row.onBehalfOfUserId !== actor.id) {
      throw new ForbiddenException('Bu kaydı yalnız adı geçen doktor onaylayabilir');
    }
    return this.prisma.scoped.auditLog.update({
      where: { id_createdAt: { id: row.id, createdAt: row.createdAt } },
      data: {
        cosignedAt: new Date(),
        cosignedById: actor.id,
      },
    });
  }

  // Tier'lı bulk approve. Yalnız LOW_RISK_ENTITIES içindekilere izin verilir;
  // request HIGH_RISK içeriyorsa reddedilir (tek-tek approve gerekli).
  async bulkApprove(input: CosignBulkApproveInput, actor: Actor) {
    const denied = input.entityTypes.filter(
      (t) => HIGH_RISK_ENTITIES.has(t) || !LOW_RISK_ENTITIES.has(t),
    );
    if (denied.length > 0) {
      throw new BadRequestException(
        `Bu entity tipleri bulk onaylanamaz (tek tek inceleyin): ${denied.join(', ')}`,
      );
    }
    const before = input.beforeAt ? new Date(input.beforeAt) : new Date();
    const result = await this.prisma.scoped.auditLog.updateMany({
      where: {
        onBehalfOfUserId: actor.id,
        cosignedAt: null,
        entityType: { in: input.entityTypes },
        createdAt: { lte: before },
      },
      data: {
        cosignedAt: new Date(),
        cosignedById: actor.id,
      },
    });
    return { approvedCount: result.count };
  }

  async reject(input: CosignRejectInput, actor: Actor) {
    // Delta audit C-3: payload alanı orijinal audit içeriğini korur; reddetme
    // sırasında orijinal payload spread ile saklanır ve `cosignRejection` alt
    // anahtarına ek bilgi yazılır. `cosignedAt` semantik olarak "karar verildi"
    // (approve OR reject), `cosignRejected` flag ayrımı sağlar.
    const row = await this.prisma.scoped.auditLog.findFirst({
      where: { id: input.auditLogId },
      // #957 — audit_logs composite PK (id, createdAt); update locator ikisini ister.
      select: {
        id: true,
        createdAt: true,
        onBehalfOfUserId: true,
        cosignedAt: true,
        payload: true,
      },
    });
    if (!row) throw new BadRequestException('Audit log bulunamadı');
    if (row.cosignedAt) {
      throw new BadRequestException('Bu kayıt zaten onaylandı; reddedilemez');
    }
    if (row.onBehalfOfUserId !== actor.id) {
      throw new ForbiddenException('Bu kaydı yalnız adı geçen doktor reddedebilir');
    }
    const previousPayload =
      row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {};
    const now = new Date();
    return this.prisma.scoped.auditLog.update({
      where: { id_createdAt: { id: row.id, createdAt: row.createdAt } },
      data: {
        cosignedAt: now,
        cosignedById: actor.id,
        cosignRejected: true,
        payload: {
          ...previousPayload,
          cosignRejection: {
            reason: input.reason,
            rejectedAt: now.toISOString(),
            rejectedById: actor.id,
          },
        },
      },
    });
  }
}

export const COSIGN_LOW_RISK_ENTITIES = Array.from(LOW_RISK_ENTITIES);
export const COSIGN_HIGH_RISK_ENTITIES = Array.from(HIGH_RISK_ENTITIES);
