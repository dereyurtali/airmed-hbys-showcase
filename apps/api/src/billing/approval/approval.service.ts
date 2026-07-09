import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SURGERY_BILLING_ROLES } from '@airmed/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../tenant/tenant-context.service';
import { NotificationService } from '../../notification/notification.service';
import type { DiscountApprovalListQuery, DiscountApprovalRequestInput } from './approval.schemas';
import { canApproveDiscount, maxSelfLimitFor, readMaxApprovableDiscount } from './discount-limits';

// S14 — v0.1 indirim onayı port. Discount approval service.
//
// İş kuralları:
//   - request: kullanıcının roles'üyle hesaplanan self-cap'i aşan indirim için
//     DiscountApproval kaydı oluşturur. invoice/surgery bağlamı zorunlu.
//   - review: pending'i SELECT ... FOR UPDATE ile kilitler (race-free),
//     yalnız canApproveDiscount() = true roller işleyebilir, state machine
//     ihlali ConflictException atmaz (idempotent: aynı status'a tekrar set
//     edilirse mevcut kayıt döner).
//   - Cerrahi binding (S12a): surgeryId set ise yalnız SURGERY_BILLING_ROLES
//     (admin + ameliyat_satis) review edebilir. CLAUDE.md S12a kuralı.
//
// Invoice status değişimi (B3'te invoice.service.ts'e wire edilecek):
//   - request sonrası Invoice 'pending_approval' (henüz B3'te)
//   - approve sonrası Invoice 'open' (payment flow normal işler)
//   - reject sonrası Invoice 'cancelled'

interface Actor {
  id: string;
  roles: readonly string[];
}

export interface ApprovalRow {
  id: string;
  tenantId: string;
  invoiceId: string | null;
  surgeryId: string | null;
  requestedById: string;
  discountPercent: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  reason: string;
  status: string;
  reviewedById: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const APPROVAL_INCLUDE = {
  // Prisma ilişkileri için minimum include — UI list'lerde gerekli özet
  // alanlar. requester ve reviewer User'a relation eklemediğimiz için manuel
  // join yapacağız list metodunda.
} satisfies Prisma.DiscountApprovalInclude;

@Injectable()
export class DiscountApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly notifications: NotificationService,
  ) {}

  // -------------------- Cap helpers --------------------

  /**
   * Kullanıcının rol cap'i. UI ön-kontrol için (gerçek karar service'de).
   */
  selfLimitFor(actor: Actor): number {
    return maxSelfLimitFor(actor.roles);
  }

  /**
   * percent (0..100) kullanıcının self cap'inin altında mı? Altındaysa
   * indirim doğrudan geçer; üstünde ise request() çağrılmalı.
   */
  isWithinSelfLimit(actor: Actor, percent: number): boolean {
    if (!Number.isFinite(percent) || percent < 0) {
      throw new BadRequestException('discountPercent must be non-negative finite number');
    }
    return percent <= this.selfLimitFor(actor);
  }

  /**
   * #361 — Mutlak indirim tavanı (tenant-yapılandırılabilir, default %30).
   * Onayla bile bu oranın üstünde indirim uygulanamaz. Tenant tablosu RLS-dışı
   * olduğu için base client ile okunur.
   */
  async absoluteMaxDiscountPercent(): Promise<number> {
    const tenantId = this.tenantContext.requireTenantId();
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    return readMaxApprovableDiscount(tenant?.settings ?? null);
  }

  // -------------------- Request flow (invoice.service'den çağrılır) --------------------

  /**
   * Pending bir DiscountApproval kaydı oluşturur. Bu metod çağrıldığında
   * caller, percent > self limit olduğunu önceden doğrulamış olmalı —
   * isWithinSelfLimit ile. Servis kendi de defansif kontrol yapar.
   *
   * Aynı invoice/surgery için zaten pending kayıt varsa onu döner (idempotent).
   * Bu sayede invoice.create iki kez çağrıldığında çift kayıt oluşmaz.
   */
  async request(input: DiscountApprovalRequestInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();

    const percent = Number(input.discountPercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new BadRequestException('discountPercent must be in 0..100');
    }

    if (this.isWithinSelfLimit(actor, percent)) {
      // Defansif: caller hatalı çağırdı; sessizce null değil exception at —
      // kod buga işaret eder, env'da DiscountApproval olmadan invoice oluşturulmalı.
      throw new BadRequestException('Discount within self-limit — no approval needed');
    }

    // Idempotency: aynı invoice/surgery için pending varsa onu döner.
    if (input.invoiceId) {
      const existing = await this.prisma.scoped.discountApproval.findFirst({
        where: { invoiceId: input.invoiceId, status: 'pending' },
      });
      if (existing) return existing;
    } else if (input.surgeryId) {
      const existing = await this.prisma.scoped.discountApproval.findFirst({
        where: { surgeryId: input.surgeryId, status: 'pending' },
      });
      if (existing) return existing;
    }

    return this.prisma.scoped.discountApproval.create({
      data: {
        tenantId,
        invoiceId: input.invoiceId ?? null,
        surgeryId: input.surgeryId ?? null,
        requestedById: actor.id,
        discountPercent: new Prisma.Decimal(input.discountPercent),
        discountAmount: new Prisma.Decimal(input.discountAmount),
        reason: input.reason,
        status: 'pending',
      },
    });
  }

  // -------------------- Review flow (admin onayı) --------------------

  /**
   * Pending kaydı review eder. SELECT ... FOR UPDATE ile race-free; aynı
   * anda iki admin tıklarsa biri ikinci adım 'pending' bulamadığı için
   * idempotent davranır (eski kayıt döner).
   *
   * Surgery bağlı kayıtlar için SURGERY_BILLING_ROLES kontrolü (S12a).
   *
   * NOT: Invoice status flip işlemi B3'te invoice.service'den buradan
   * çağrılacak. Şu an sadece DiscountApproval kaydını günceller.
   */
  async review(
    id: string,
    decision: 'approved' | 'rejected',
    actor: Actor,
    note: string | null,
  ): Promise<ApprovalRow> {
    if (!canApproveDiscount(actor.roles)) {
      throw new ForbiddenException('Yetkili rol değil (indirim onayı)');
    }

    const tenantId = this.tenantContext.requireTenantId();
    // #361 — Mutlak tavan tx dışında okunur (Tenant RLS-dışı base client).
    const absoluteCap = await this.absoluteMaxDiscountPercent();

    return this.prisma.runWithTenant(tenantId, async (tx) => {
      // FOR UPDATE: aynı kayda iki istek gelirse ikincisi bloklanır, sonra
      // status değiştiği için pending bulamayıp idempotent davranır.
      const rows = await tx.$queryRaw<ApprovalRow[]>(
        Prisma.sql`SELECT id, tenant_id AS "tenantId", invoice_id AS "invoiceId",
                          surgery_id AS "surgeryId", requested_by_id AS "requestedById",
                          discount_percent AS "discountPercent",
                          discount_amount AS "discountAmount", reason, status,
                          reviewed_by_id AS "reviewedById", reviewed_at AS "reviewedAt",
                          review_note AS "reviewNote", created_at AS "createdAt",
                          updated_at AS "updatedAt"
                   FROM discount_approvals
                   WHERE id = ${id}::uuid
                     AND tenant_id = ${tenantId}::uuid
                   FOR UPDATE`,
      );

      const current = rows[0];
      if (!current) throw new NotFoundException('Onay kaydı bulunamadı');

      // Idempotency: aynı karara tekrar set edilirse mevcut kayıt döner
      if (current.status === decision) return current;

      if (current.status !== 'pending') {
        throw new BadRequestException(`Onay zaten ${current.status} — değiştirilemez`);
      }

      // #361 — Mutlak tavan kontrolü (yalnız onayda). ServiceItem.maxDiscountApprovable
      // global tavanı daha da daraltabilir: invoice kalemlerinden herhangi biri
      // daha düşük cap tanımlıyorsa o kazanır. Aşımda 403 — yönetici dahil kimse
      // onaylayamaz; fatura pending_approval'da kalır, reddedilmeli.
      if (decision === 'approved') {
        let effectiveCap = absoluteCap;
        if (current.invoiceId) {
          const lineItems = await tx.invoiceItem.findMany({
            where: { invoiceId: current.invoiceId, serviceItemId: { not: null } },
            select: { serviceItem: { select: { maxDiscountApprovable: true } } },
          });
          for (const item of lineItems) {
            if (!item.serviceItem) continue;
            const itemCap = Number(item.serviceItem.maxDiscountApprovable);
            if (Number.isFinite(itemCap) && itemCap < effectiveCap) effectiveCap = itemCap;
          }
        }
        const requestedPercent = Number(current.discountPercent);
        if (requestedPercent > effectiveCap) {
          throw new ForbiddenException(
            `İndirim mutlak tavanı aşıldı (%${requestedPercent} > %${effectiveCap}); bu indirim onaylanamaz, talebi reddedin.`,
          );
        }
      }

      // S12a — Cerrahi binding (Invoice.surgeryId set veya bu kayıt surgery'ye bağlı)
      if (current.surgeryId) {
        const allowedRoles: readonly string[] = SURGERY_BILLING_ROLES;
        const hasRole = actor.roles.some((r) => allowedRoles.includes(r));
        if (!hasRole) {
          throw new ForbiddenException(
            'Cerrahi indirim onayı yalnız yonetici/yonetici_asistani/ameliyat_satis tarafından yapılabilir',
          );
        }
      }

      const updated = await tx.discountApproval.update({
        where: { id: current.id },
        data: {
          status: decision,
          reviewedById: actor.id,
          reviewedAt: new Date(),
          reviewNote: note ?? null,
        },
      });

      // S14 — Invoice status flip: pending_approval → open (approved) / cancelled (rejected)
      // Surgery bağlama için ayrı kural yok (surgery'nin kendi state machine'i var,
      // burada müdahale etmiyoruz; surgery onayı follow-up iş).
      if (current.invoiceId) {
        if (decision === 'approved') {
          await tx.invoice.updateMany({
            where: { id: current.invoiceId, status: 'pending_approval' },
            data: { status: 'open' },
          });
        } else {
          // Reddedildi → fatura iptal. Sebep: indirim olmadan müşteri zaten
          // ödememiş olabilir; düz iptal en güvenli akış.
          await tx.invoice.updateMany({
            where: { id: current.invoiceId, status: 'pending_approval' },
            data: {
              status: 'cancelled',
              cancelledAt: new Date(),
              cancelledById: actor.id,
              cancelReason: `İndirim onayı reddedildi: ${note ?? '(gerekçe yok)'}`,
            },
          });
        }
      }

      return {
        ...updated,
        discountPercent: updated.discountPercent,
        discountAmount: updated.discountAmount,
      } as ApprovalRow;
    });
  }

  // -------------------- Queries --------------------

  async listPending(query: DiscountApprovalListQuery) {
    const where: Prisma.DiscountApprovalWhereInput = {
      ...(query.status ? { status: query.status } : { status: 'pending' }),
      ...(query.scope === 'invoice' && { invoiceId: { not: null } }),
      ...(query.scope === 'surgery' && { surgeryId: { not: null } }),
    };

    const [items, total] = await Promise.all([
      this.prisma.scoped.discountApproval.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: APPROVAL_INCLUDE,
      }),
      this.prisma.scoped.discountApproval.count({ where }),
    ]);

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async countPending(): Promise<number> {
    return this.prisma.scoped.discountApproval.count({ where: { status: 'pending' } });
  }

  async findById(id: string) {
    const row = await this.prisma.scoped.discountApproval.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Onay kaydı bulunamadı');
    return row;
  }

  // R5 (#727) — "Eskale et": yönetici asistanı bekleyen bir indirim onayını
  // onay yetkisi olan yöneticilere (yonetici + finans) bildirim ile iletir.
  // Asistan onaylayamaz (Karar 10) → eskale, kararı yetkiliye taşır. Yeni
  // şema alanı yok (re-eskale serbest); mevcut Notification altyapısı kullanılır.
  async escalate(id: string, actor: Actor, note?: string | null) {
    const approval = await this.findById(id);
    if (approval.status !== 'pending') {
      throw new BadRequestException('Yalnız bekleyen onay eskale edilebilir');
    }

    const managers = await this.prisma.scoped.user.findMany({
      where: {
        deletedAt: null,
        userRoles: { some: { role: { key: { in: ['yonetici', 'finans'] } } } },
      },
      select: { id: true },
    });
    // Asistanın kendisi yönetici rolünü de taşıyorsa kendine bildirim gönderme.
    const recipientIds = managers.map((m) => m.id).filter((uid) => uid !== actor.id);

    const percent = approval.discountPercent.toString();
    const trimmed = note?.trim();
    await this.notifications.createForUsers(recipientIds, {
      type: 'approval_escalated',
      title: 'İndirim onayı eskale edildi',
      body: trimmed
        ? `%${percent} indirim onayınızı bekliyor — ${trimmed}`
        : `%${percent} indirim onayınızı bekliyor.`,
      payload: {
        surgeryId: approval.surgeryId ?? undefined,
        invoiceId: approval.invoiceId ?? undefined,
      },
    });

    return { notified: recipientIds.length };
  }

  async findPendingByInvoice(invoiceId: string) {
    return this.prisma.scoped.discountApproval.findFirst({
      where: { invoiceId, status: 'pending' },
    });
  }

  async findPendingBySurgery(surgeryId: string) {
    return this.prisma.scoped.discountApproval.findFirst({
      where: { surgeryId, status: 'pending' },
    });
  }

  // S15-PR17 — Kârlılık simülasyonu. Yönetici onay paneli için: indirim
  // sonrası net kâr, sarf maliyet düşümü, geçmiş indirim oranı.
  //
  // Hesap:
  //   - gross = invoice.subtotal veya surgery toplam (Invoice.total)
  //   - discountAmount = approval.discountAmount
  //   - supplyCost = surgery için kullanılan IolLot lensImplant.unitCost +
  //     PreOp.suppliesUsed (varsa). Invoice ise InvoiceItem'lar üzerinden
  //     ilgili maliyet (mevcut sistemde yok, 0 varsayılır).
  //   - netRevenue = gross - discountAmount
  //   - netProfit = netRevenue - supplyCost
  //   - historicalRate: bu doktorun veya bu hizmet kategorisinin son 30 günde
  //     onaylanmış approval'ların ortalama discountPercent'i.
  async simulate(approvalId: string) {
    const row = await this.findById(approvalId);

    let gross = new Prisma.Decimal(0);
    const supplyCost = new Prisma.Decimal(0);
    let surgeryTypeForHistory: string | null = null;

    // Not: Mevcut schema'da sarf maliyet alanı (IolLot.unitCost / IolModel.unitCost)
    // yok — v0.3 stok değer takibi geldiğinde supplyCost > 0 olur. Şu an için
    // 0 varsayıldı; simülasyon panelinde "sarf maliyeti girilmedi" rozeti
    // gösterilir.
    if (row.invoiceId) {
      const invoice = await this.prisma.scoped.invoice.findFirst({
        where: { id: row.invoiceId },
        select: { total: true, subtotal: true, surgeryId: true },
      });
      gross = (invoice?.subtotal ?? invoice?.total ?? new Prisma.Decimal(0)) as Prisma.Decimal;

      if (invoice?.surgeryId) {
        const surgery = await this.prisma.scoped.surgery.findFirst({
          where: { id: invoice.surgeryId },
          select: { type: true },
        });
        surgeryTypeForHistory = surgery?.type ?? null;
      }
    } else if (row.surgeryId) {
      const surgery = await this.prisma.scoped.surgery.findFirst({
        where: { id: row.surgeryId },
        select: { type: true },
      });
      // Surgery indirim binding — invoice yok ise gross = discountAmount /
      // (discountPercent/100). PV: discountAmount = gross * percent/100 →
      // gross = discountAmount * 100 / percent.
      if (row.discountPercent.gt(0)) {
        gross = row.discountAmount.mul(100).div(row.discountPercent);
      }
      surgeryTypeForHistory = surgery?.type ?? null;
    }

    const netRevenue = gross.minus(row.discountAmount);
    const netProfit = netRevenue.minus(supplyCost);
    const marginPercent = gross.gt(0)
      ? netProfit.div(gross).mul(100).toDecimalPlaces(2)
      : new Prisma.Decimal(0);

    // Geçmiş indirim oranı: son 30 gün, aynı surgery type için ortalama
    // discountPercent (approved durumda).
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let historicalAvgPercent: number | null = null;
    if (surgeryTypeForHistory) {
      const history = await this.prisma.scoped.$queryRaw<Array<{ avg: string | null }>>(
        Prisma.sql`
          SELECT AVG(da.discount_percent)::TEXT AS avg
          FROM discount_approvals da
          JOIN surgeries s ON s.id = da.surgery_id OR s.id = (
            SELECT i.surgery_id FROM invoices i WHERE i.id = da.invoice_id
          )
          WHERE da.status = 'approved'
            AND da.created_at >= ${thirtyDaysAgo}
            AND s.type = ${surgeryTypeForHistory}
            AND da.tenant_id = ${this.tenantContext.requireTenantId()}::uuid
        `,
      );
      if (history[0]?.avg) {
        historicalAvgPercent = parseFloat(history[0].avg);
      }
    }

    return {
      gross: gross.toFixed(2),
      discountAmount: row.discountAmount.toFixed(2),
      discountPercent: row.discountPercent.toFixed(2),
      supplyCost: supplyCost.toFixed(2),
      netRevenue: netRevenue.toFixed(2),
      netProfit: netProfit.toFixed(2),
      marginPercent: marginPercent.toFixed(2),
      historicalAvgPercent,
      surgeryType: surgeryTypeForHistory,
    };
  }
}
