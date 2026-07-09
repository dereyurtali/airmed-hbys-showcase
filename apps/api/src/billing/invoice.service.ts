import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ServiceCategory } from '@prisma/client';
import { SURGERY_BILLING_ROLES } from '@airmed/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { DiscountApprovalService } from './approval/approval.service';
import { RatesService } from './rates.service';
import type { InvoiceCreateInput, InvoiceListQuery, InvoiceUpdateInput } from './billing.schemas';

// Madde 5b — yaş bazlı auto-discount için. Surgery.service'deki ile aynı algo.
function invoiceCalcAge(birthDate: Date | null): number | null {
  if (!birthDate || !(birthDate instanceof Date) || Number.isNaN(birthDate.getTime())) {
    return null;
  }
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age -= 1;
  return age;
}

// S11b — Invoice (fatura) service.
// İş kuralları:
//   - subtotal = sum(item.lineTotal); total = subtotal - discount (>= 0)
//   - invoiceNumber: tenant scope auto-increment "YYYY-NNNN" (yıl bazlı)
//   - status başlangıç: 'open' (henüz ödeme yok)
//   - cancel: sadece henüz payment'ı olmayanlar (yoksa refund akışı)
//   - update: status='open' olanlar (henüz ödeme almayan)
//
// S12a — müşteri görüşmesi sonrası: cerrahi bağlı invoice
// (input.surgeryId set) yalnız SURGERY_BILLING_ROLES (yön + asistan +
// ameliyat_satis) tarafından oluşturulabilir/güncellenebilir. Plain
// resepsiyon → ForbiddenException.
//
// PaymentService Invoice status'ünü günceller (open → partial → paid)

interface Actor {
  id: string;
  // S12a — Cerrahi bağlama kontrolü için roller eklendi
  roles?: readonly string[];
}

// #1140 — export: InvoiceDetailPage'in render ettiği ilişkilerin yüklendiğini
// invoice-include.spec.ts yapısal olarak doğrular (select-narrowing regresyon guard).
export const INVOICE_INCLUDE = {
  items: { orderBy: { sortOrder: 'asc' } as const },
  payments: {
    where: { deletedAt: null },
    orderBy: { takenAt: 'asc' } as const,
    // InvoiceDetailPage `p.takenBy.name` + refund `r.approvedBy?.name` render eder;
    // bu ilişkiler yüklenmezse ödemeli fatura detayı runtime'da çöker (takenBy
    // guard'sız). #1140 — pre-existing: staging'e ilk gerçek ödeme girene dek görülmedi.
    include: {
      takenBy: { select: { id: true, name: true } },
      refunds: { include: { approvedBy: { select: { id: true, name: true } } } },
    },
  },
  patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
  surgery: { select: { id: true, type: true, performedAt: true } },
  procedure: { select: { id: true, type: true, performedAt: true } },
} satisfies Prisma.InvoiceInclude;

@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    // S14 — v0.1 indirim onayı port
    private readonly approvals: DiscountApprovalService,
    // #419 — fatura kesim-anı kur snapshot'ı
    private readonly rates: RatesService,
  ) {}

  // -------------------- Queries --------------------

  async list(input: InvoiceListQuery) {
    const search = input.search?.trim();
    const where: Prisma.InvoiceWhereInput = {
      deletedAt: null,
      ...(input.patientId && { patientId: input.patientId }),
      ...(input.status && { status: input.status }),
      // #401 — Fatura no / hasta adı / MRN üzerinde server-side arama (case-insensitive).
      ...(search && {
        OR: [
          { invoiceNumber: { contains: search, mode: 'insensitive' as const } },
          { patient: { firstName: { contains: search, mode: 'insensitive' as const } } },
          { patient: { lastName: { contains: search, mode: 'insensitive' as const } } },
          { patient: { mrn: { contains: search, mode: 'insensitive' as const } } },
        ],
      }),
      ...((input.fromDate || input.toDate) && {
        createdAt: {
          ...(input.fromDate && { gte: new Date(input.fromDate) }),
          ...(input.toDate && { lt: this.nextDay(input.toDate) }),
        },
      }),
    };
    const [items, total] = await Promise.all([
      this.prisma.scoped.invoice.findMany({
        where,
        include: INVOICE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.scoped.invoice.count({ where }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  }

  async findById(id: string) {
    const invoice = await this.prisma.scoped.invoice.findFirst({
      where: { id, deletedAt: null },
      include: INVOICE_INCLUDE,
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async listByPatient(patientId: string) {
    return this.prisma.scoped.invoice.findMany({
      where: { patientId, deletedAt: null },
      include: INVOICE_INCLUDE,
      orderBy: { createdAt: 'desc' },
      // #1064 — derin include'lu tarihçe tavanı (kronik hastada sınırsız büyürdü).
      take: 200,
    });
  }

  /**
   * Hasta açık bakiyesi (tüm aktif faturaların kalanlar toplamı; TJS karşılığı).
   * Hızlı dashboard için PaymentService.sumTjsEquivalentForInvoice çağrısı yerine
   * burada Prisma aggregate ile hesaplanır.
   */
  async getOpenBalance(patientId: string): Promise<{
    invoiceCount: number;
    totalTjsEquivalent: string;
    openTjsEquivalent: string;
  }> {
    const invoices = await this.prisma.scoped.invoice.findMany({
      where: {
        patientId,
        deletedAt: null,
        status: { in: ['open', 'partial'] },
      },
      select: {
        currency: true,
        total: true,
        exchangeRate: true,
        payments: {
          where: { deletedAt: null },
          select: {
            tjsEquivalent: true,
            refunds: { select: { tjsEquivalent: true } },
          },
        },
      },
    });

    let totalTjs = new Prisma.Decimal(0);
    let openTjs = new Prisma.Decimal(0);
    for (const inv of invoices) {
      // #419 — fatura tutarı kendi para biriminde; kesim-anı snapshot kuruyla
      // TJS'e indirgenir (TJS fatura: rate=1). Ödenenler zaten tjsEquivalent (TJS).
      const invoiceTjs = inv.currency === 'TJS' ? inv.total : inv.total.mul(inv.exchangeRate);
      totalTjs = totalTjs.plus(invoiceTjs);
      const paid = inv.payments.reduce((sum, p) => {
        const refunded = p.refunds.reduce(
          (rs, r) => rs.plus(r.tjsEquivalent),
          new Prisma.Decimal(0),
        );
        return sum.plus(p.tjsEquivalent).minus(refunded);
      }, new Prisma.Decimal(0));
      openTjs = openTjs.plus(invoiceTjs).minus(paid);
    }
    return {
      invoiceCount: invoices.length,
      totalTjsEquivalent: totalTjs.toFixed(2),
      openTjsEquivalent: openTjs.toFixed(2),
    };
  }

  // -------------------- Mutations --------------------

  async create(input: InvoiceCreateInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    await this.assertPatientExists(input.patientId);

    // S12a — müşteri görüşmesi: cerrahi bağlı invoice yalnız ameliyat satış + admin
    this.assertSurgeryBindingAllowed(input.surgeryId, actor);

    // Madde 5b — Yaş bazlı otomatik indirim. Items içinde ServiceItem.preconditions
    // .ageDiscount kurulu olan ve hasta yaşı eşiğin üstündeyse, o kalem(ler)in
    // toplamının verilen yüzdesi user-provided discount'a eklenir.
    const autoDiscount = await this.computeAgeBasedAutoDiscount(input.patientId, input.items);
    const effectiveDiscount = new Prisma.Decimal(input.discount).plus(autoDiscount).toFixed(2);

    const { subtotal, total } = this.computeTotals(input.items, effectiveDiscount);

    // S14 — v0.1 indirim onayı port: discount > rol self cap ise pending_approval.
    // percent = discount / subtotal * 100 (subtotal=0 ise 0; computeTotals zaten
    // discount > subtotal kontrolü yaptı). Auto discount yönetici tarafından
    // önceden onaylanmış kural sayılır — yalnız MANUEL kısım approval'a tabi.
    const discountDecimal = new Prisma.Decimal(input.discount);
    const discountPercent = subtotal.isZero()
      ? 0
      : Number(discountDecimal.div(subtotal).mul(100).toFixed(2));
    const actorForApproval = { id: actor.id, roles: actor.roles ?? [] };
    // #361 — Mutlak tavan: rol/onaydan bağımsız hard blok. Manuel indirim oranı
    // tenant tavanını (default %30) aşıyorsa yönetici dahil kimse uygulayamaz.
    const absoluteCap = await this.approvals.absoluteMaxDiscountPercent();
    if (discountPercent > absoluteCap) {
      throw new BadRequestException(
        `İndirim tavanı %${absoluteCap} — bu oran (%${discountPercent.toFixed(2)}) hiçbir koşulda uygulanamaz`,
      );
    }
    const needsApproval =
      discountPercent > 0 && !this.approvals.isWithinSelfLimit(actorForApproval, discountPercent);
    if (needsApproval && !input.discountReason) {
      throw new BadRequestException(
        `Bu indirim onay gerektiriyor (cap: %${this.approvals.selfLimitFor(actorForApproval)}); gerekçe (discountReason) zorunlu`,
      );
    }

    const invoiceNumber = await this.nextInvoiceNumber();

    // #419 — kesim-anı kur snapshot'ı (TJS=1; USD→güncel NBT kuru / legacy fallback).
    const exchangeRate = await this.rates.snapshotRateToTjs(input.currency);

    // Interceptor zaten tenant tx içinde; scoped tüm işlemler tek tx'te atomic.
    const tx = this.prisma.scoped;
    const invoice = await tx.invoice.create({
      data: {
        tenantId,
        invoiceNumber,
        patientId: input.patientId,
        currency: input.currency,
        subtotal,
        discount: discountDecimal,
        total,
        exchangeRate,
        notes: input.notes ?? null,
        surgeryId: input.surgeryId ?? null,
        procedureId: input.procedureId ?? null,
        appointmentId: input.appointmentId ?? null,
        // S14 — Onay bekliyorsa fatura kilitli; payment akışı bu state'te kapalı.
        status: needsApproval ? 'pending_approval' : 'open',
        createdById: actor.id,
      },
    });
    await tx.invoiceItem.createMany({
      data: input.items.map((item, idx) => ({
        tenantId,
        invoiceId: invoice.id,
        serviceItemId: item.serviceItemId ?? null,
        description: item.description,
        quantity: item.quantity,
        unitPrice: new Prisma.Decimal(item.unitPrice),
        lineTotal: new Prisma.Decimal(item.unitPrice).mul(item.quantity),
        sortOrder: idx,
      })),
    });

    if (needsApproval) {
      await this.approvals.request(
        {
          invoiceId: invoice.id,
          surgeryId: null,
          discountPercent: discountPercent.toFixed(2),
          discountAmount: discountDecimal.toFixed(2),
          reason: input.discountReason!,
        },
        actorForApproval,
      );
    }

    return tx.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: INVOICE_INCLUDE,
    });
  }

  async update(id: string, input: InvoiceUpdateInput, actor: Actor) {
    const invoice = await this.findById(id);
    if (invoice.status !== 'open') {
      throw new BadRequestException(
        `Invoice cannot be edited (status=${invoice.status}); cancel + new invoice instead`,
      );
    }
    if (invoice.payments.length > 0) {
      throw new BadRequestException('Invoice has payments; cannot edit');
    }
    // S12a — Mevcut surgeryId set ise yalnız SURGERY_BILLING_ROLES güncelleyebilir
    this.assertSurgeryBindingAllowed(invoice.surgeryId, actor);

    const tenantId = this.tenantContext.requireTenantId();
    const tx = this.prisma.scoped;

    // Item replacement: silip yeniden ekle (sortOrder ve serviceItemId tutmak için)
    if (input.items) {
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
      await tx.invoiceItem.createMany({
        data: input.items.map((item, idx) => ({
          tenantId,
          invoiceId: id,
          serviceItemId: item.serviceItemId ?? null,
          description: item.description,
          quantity: item.quantity,
          unitPrice: new Prisma.Decimal(item.unitPrice),
          lineTotal: new Prisma.Decimal(item.unitPrice).mul(item.quantity),
          sortOrder: idx,
        })),
      });
    }

    // Discount değişirse veya items değişirse total yeniden hesapla
    const items =
      input.items ??
      invoice.items.map((i) => ({
        unitPrice: i.unitPrice.toString(),
        quantity: i.quantity,
      }));
    const discount = input.discount ?? invoice.discount.toString();
    const { subtotal, total } = this.computeTotals(items, discount);

    // Delta audit C-7 — update() de create() ile aynı indirim onay guard'ı.
    // Resepsiyon mevcut açık faturanın discount'ını rol cap'i üstüne çekemez.
    const discountDecimal = new Prisma.Decimal(discount);
    const previousDiscount = invoice.discount;
    const discountChanged = !discountDecimal.eq(previousDiscount);
    const discountPercent = subtotal.isZero()
      ? 0
      : Number(discountDecimal.div(subtotal).mul(100).toFixed(2));
    const actorForApproval = { id: actor.id, roles: actor.roles ?? [] };
    // #361 — Mutlak tavan: değişen indirim tenant tavanını aşamaz (legacy
    // not-only edit'leri etkilememek için yalnız discountChanged'de kontrol).
    if (discountChanged) {
      const absoluteCap = await this.approvals.absoluteMaxDiscountPercent();
      if (discountPercent > absoluteCap) {
        throw new BadRequestException(
          `İndirim tavanı %${absoluteCap} — bu oran (%${discountPercent.toFixed(2)}) hiçbir koşulda uygulanamaz`,
        );
      }
    }
    const needsApproval =
      discountChanged &&
      discountPercent > 0 &&
      !this.approvals.isWithinSelfLimit(actorForApproval, discountPercent);
    if (needsApproval && !input.discountReason) {
      throw new BadRequestException(
        `Bu indirim onay gerektiriyor (cap: %${this.approvals.selfLimitFor(actorForApproval)}); gerekçe (discountReason) zorunlu`,
      );
    }

    const updated = await tx.invoice.update({
      where: { id },
      data: {
        subtotal,
        discount: discountDecimal,
        total,
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(needsApproval && { status: 'pending_approval' as const }),
      },
      include: INVOICE_INCLUDE,
    });

    if (needsApproval) {
      await this.approvals.request(
        {
          invoiceId: updated.id,
          surgeryId: null,
          discountPercent: discountPercent.toFixed(2),
          discountAmount: discountDecimal.toFixed(2),
          reason: input.discountReason!,
        },
        actorForApproval,
      );
    }

    return updated;
  }

  async cancel(id: string, reason: string, actor: Actor) {
    const invoice = await this.findById(id);
    if (invoice.status === 'cancelled') {
      throw new ConflictException('Invoice already cancelled');
    }
    if (invoice.payments.length > 0) {
      throw new BadRequestException('Invoice has payments; use refund flow first, then cancel');
    }
    return this.prisma.scoped.invoice.update({
      where: { id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledById: actor.id,
        cancelReason: reason,
      },
      include: INVOICE_INCLUDE,
    });
  }

  /**
   * PaymentService / RefundService tarafından çağrılır — invoice status'unu
   * ödenen tutara göre günceller. Tüm I/O interceptor'ın açtığı scoped tx içinde.
   */
  async recomputeStatus(invoiceId: string): Promise<'open' | 'partial' | 'paid' | 'refunded'> {
    const tx = this.prisma.scoped;
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: {
        payments: {
          where: { deletedAt: null },
          include: { refunds: true },
        },
      },
    });

    const total = invoice.total;
    // Her tahsilat → invoice.currency birimine indirgenir.
    // payment.currency == invoice.currency ise amount; değilse amount*exchangeRate
    let paid = new Prisma.Decimal(0);
    let refunded = new Prisma.Decimal(0);
    for (const p of invoice.payments) {
      const inInvoiceCurrency =
        p.currency === invoice.currency ? p.amount : p.amount.mul(p.exchangeRate);
      paid = paid.plus(inInvoiceCurrency);
      for (const r of p.refunds) {
        const refundInInv =
          r.currency === invoice.currency ? r.amount : r.amount.mul(p.exchangeRate); // refund payment'tan; aynı kur
        refunded = refunded.plus(refundInInv);
      }
    }
    const net = paid.minus(refunded);

    let nextStatus: 'open' | 'partial' | 'paid' | 'refunded';
    if (net.lte(0) && paid.gt(0)) {
      // Hepsi geri ödendi
      nextStatus = 'refunded';
    } else if (net.gte(total)) {
      nextStatus = 'paid';
    } else if (net.gt(0)) {
      nextStatus = 'partial';
    } else {
      nextStatus = 'open';
    }

    if (nextStatus !== invoice.status) {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: nextStatus },
      });
    }
    return nextStatus;
  }

  // -------------------- Helpers --------------------

  private computeTotals(
    items: ReadonlyArray<{ unitPrice: string; quantity: number }>,
    discount: string,
  ): { subtotal: Prisma.Decimal; total: Prisma.Decimal } {
    const subtotal = items.reduce(
      (sum, item) => sum.plus(new Prisma.Decimal(item.unitPrice).mul(item.quantity)),
      new Prisma.Decimal(0),
    );
    const discountDecimal = new Prisma.Decimal(discount);
    if (discountDecimal.lt(0)) {
      throw new BadRequestException('discount cannot be negative');
    }
    if (discountDecimal.gt(subtotal)) {
      throw new BadRequestException('discount exceeds subtotal');
    }
    const total = subtotal.minus(discountDecimal);
    return { subtotal, total };
  }

  /**
   * "YYYY-NNNN" formatlı tenant-bazlı sequence. #923 — invoice_counters atomik
   * UPSERT (RETURNING) ile race-free (MrnCounter deseni). Eski findFirst+parse+
   * increment serializable DEĞİLDİ → eşzamanlı iki fatura aynı numarayı üretip
   * @@unique ihlali/duplicate yapabilirdi. current_setting('app.current_tenant_id')
   * = interceptor tx'inin GUC'u (RLS policy'siyle aynı). nextInvoiceNumber ve
   * invoice.create aynı tx'te; sayaç satır kilidi eşzamanlı faturaları
   * serileştirir → duplicate imkansız.
   */
  private async nextInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const rows = await this.prisma.scoped.$queryRaw<{ last_seq: number }[]>`
      INSERT INTO "invoice_counters" ("tenant_id", "year", "last_seq")
      VALUES (current_setting('app.current_tenant_id', true)::uuid, ${year}, 1)
      ON CONFLICT ("tenant_id", "year")
      DO UPDATE SET "last_seq" = "invoice_counters"."last_seq" + 1
      RETURNING "last_seq"
    `;
    const seq = rows[0].last_seq;
    return `${year}-${String(seq).padStart(4, '0')}`;
  }

  private async assertPatientExists(patientId: string): Promise<void> {
    const patient = await this.prisma.scoped.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException('Patient not found');
  }

  // Madde 5b — items içinde ServiceItem.preconditions.ageDiscount kurulu olan
  // kalemler için hasta yaşı eşik üstündeyse otomatik discount toplamı.
  // Geriye verilen miktar (Decimal) caller'a input.discount'a eklenir.
  private async computeAgeBasedAutoDiscount(
    patientId: string,
    items: InvoiceCreateInput['items'],
  ): Promise<Prisma.Decimal> {
    const itemsWithService = items.filter((it) => !!it.serviceItemId);
    if (itemsWithService.length === 0) return new Prisma.Decimal(0);

    const patient = await this.prisma.scoped.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { birthDate: true },
    });
    if (!patient) return new Prisma.Decimal(0);
    const age = invoiceCalcAge(patient.birthDate);
    if (age == null) return new Prisma.Decimal(0);

    const serviceItems = await this.prisma.scoped.serviceItem.findMany({
      where: { id: { in: itemsWithService.map((it) => it.serviceItemId!) } },
      select: { id: true, preconditions: true },
    });
    const byId = new Map(serviceItems.map((s) => [s.id, s.preconditions]));

    let total = new Prisma.Decimal(0);
    for (const it of itemsWithService) {
      const pre = (byId.get(it.serviceItemId!) ?? {}) as {
        ageDiscount?: { minAge: number; percent: number } | null;
      };
      const ad = pre.ageDiscount;
      if (ad && typeof ad.minAge === 'number' && typeof ad.percent === 'number') {
        if (age >= ad.minAge) {
          const lineTotal = new Prisma.Decimal(it.unitPrice).mul(it.quantity);
          const discount = lineTotal.mul(ad.percent).div(100).toDecimalPlaces(2);
          total = total.plus(discount);
        }
      }
    }
    return total;
  }

  /**
   * S12c — müşteri görüşmesi karar 3: "Önce öde, sonra hizmet".
   *
   * Examination/Lab/Surgery service'ları create öncesi çağırır. Hastanın
   * AYNI GÜN + AYNI ServiceCategory tipinde en az 1 `paid` veya `partial`
   * invoice item'ı olmalı. Yoksa ForbiddenException.
   *
   * "Seans" tanımı = bugün başlangıcı (gece yarısı 00:00) sonrası oluşturulmuş
   * + invoice.status IN (paid, partial) + invoice_item.service_item.category = X
   *
   * Override yolu yok (pilot kararı). Yönetici de aynı kontrole tabi —
   * doğru akış: önce resepsiyon fatura + tahsilat, sonra doktor işlem.
   */
  async assertPaidSession(patientId: string, category: ServiceCategory): Promise<void> {
    // S15-PR5 — Break Glass bypass: aktif acil bypass varsa ödeme kuralı geçer.
    // Audit trail Encounter'da; auto-bill sonradan kapatma akışında üretilir.
    const bypass = await this.prisma.scoped.encounter.findFirst({
      where: {
        patientId,
        deletedAt: null,
        emergencyBypassActivatedAt: { not: null },
        emergencyBypassClosedAt: null,
      },
      select: { id: true },
    });
    if (bypass) return;

    const paid = await this.hasPaidSession(patientId, category);
    if (!paid) {
      throw new ForbiddenException(
        `Hasta için bu seans tahsilatı yapılmamış (kategori: ${category}). Resepsiyondan fatura + ödeme alın.`,
      );
    }
  }

  /**
   * S15 — assertPaidSession'ın fırlatmayan (boolean) varyantı. Encounter
   * istasyon kapıları "bu kategori bugün ödendi mi?" sorusunu okuma amaçlı
   * sorar (örn. check-in'de açılış stage'i belirleme). assertPaidSession bunu
   * sarmalar; tek sorgu shape'i, tek doğru kaynak.
   */
  async hasPaidSession(patientId: string, category: ServiceCategory): Promise<boolean> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const found = await this.prisma.scoped.invoice.findFirst({
      where: {
        patientId,
        deletedAt: null,
        status: { in: ['paid', 'partial'] },
        createdAt: { gte: todayStart },
        items: { some: { serviceItem: { category } } },
      },
      select: { id: true },
    });

    return found !== null;
  }

  /**
   * Delta audit C-5 — `hasPaidSession`'ın bulk varyantı. compliancePulse gibi
   * 50+ encounter için stage→category eşleme tek sorguya inerse N+1 önlenir.
   * Dönüş: `Set<string>` formatında "<patientId>::<category>" key'leri (paid).
   */
  async hasPaidSessionsBulk(
    pairs: Array<{ patientId: string; category: ServiceCategory }>,
  ): Promise<Set<string>> {
    if (pairs.length === 0) return new Set();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const patientIds = Array.from(new Set(pairs.map((p) => p.patientId)));
    const categories = Array.from(new Set(pairs.map((p) => p.category)));

    const invoices = await this.prisma.scoped.invoice.findMany({
      where: {
        patientId: { in: patientIds },
        deletedAt: null,
        status: { in: ['paid', 'partial'] },
        createdAt: { gte: todayStart },
        items: { some: { serviceItem: { category: { in: categories } } } },
      },
      select: {
        patientId: true,
        items: { select: { serviceItem: { select: { category: true } } } },
      },
    });

    const result = new Set<string>();
    for (const inv of invoices) {
      for (const item of inv.items) {
        const cat = item.serviceItem?.category;
        if (cat) result.add(`${inv.patientId}::${cat}`);
      }
    }
    return result;
  }

  /**
   * S12a — Cerrahi bağlı invoice yalnız SURGERY_BILLING_ROLES içindeki kullanıcı
   * tarafından oluşturulabilir/güncellenebilir (yönetici, asistan, ameliyat_satis).
   * Plain resepsiyon → ForbiddenException.
   *
   * Roles aktor objesinde opsiyonel; gelmezse kontrol atlanır (test ya da
   * non-HTTP context). HTTP yolundan TrpcContext daima `roles` setiyle çağırır.
   */
  private assertSurgeryBindingAllowed(surgeryId: string | null | undefined, actor: Actor): void {
    if (!surgeryId) return; // Cerrahi bağı yok → kontrol yok
    if (!actor.roles) return; // Test bypass
    const allowed = actor.roles.some((r) =>
      (SURGERY_BILLING_ROLES as readonly string[]).includes(r),
    );
    if (!allowed) {
      throw new ForbiddenException(
        'Cerrahi paket faturası yalnız Ameliyat Satış (veya yönetici/asistan) tarafından oluşturulabilir',
      );
    }
  }

  private nextDay(isoDate: string): Date {
    const d = new Date(isoDate);
    d.setDate(d.getDate() + 1);
    return d;
  }

  // S15-PR18 — "Önce öde" compliance özeti. Bugün için:
  //   - activeUnpaidEncounters: emergency_bypass dışındaki ileri stage'lerde
  //     ama o gün için paid invoice'u olmayan ziyaretler
  //   - bypassActiveCount: şu an aktif olan emergency_bypass sayısı
  //   - bypassTotalToday: bugün açılan toplam bypass sayısı (kapatılmış dahil)
  // Dashboard widget tek atışta çağırır.
  async compliancePulse(): Promise<{
    activeUnpaidEncounters: Array<{
      id: string;
      stage: string;
      stageUpdatedAt: Date;
      patient: { id: string; mrn: string; firstName: string; lastName: string };
    }>;
    bypassActiveCount: number;
    bypassTotalToday: number;
  }> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const tx = this.prisma.scoped;
    const ACTIVE_STAGES: Array<
      'in_exam' | 'in_measurement' | 'measurement_ready' | 'awaiting_surgery_sales'
    > = ['in_exam', 'in_measurement', 'measurement_ready', 'awaiting_surgery_sales'];

    const candidates = await tx.encounter.findMany({
      where: {
        stage: { in: ACTIVE_STAGES },
        deletedAt: null,
        emergencyBypassActivatedAt: null,
        stageUpdatedAt: { gte: todayStart },
      },
      include: {
        patient: {
          select: { id: true, mrn: true, firstName: true, lastName: true },
        },
      },
      orderBy: { stageUpdatedAt: 'asc' },
      take: 50,
    });

    // Stage → kategori eşlemesi: muayene → examination, ölçüm → measurement.
    // surgery_sales stage'i için kategori 'surgery'.
    const STAGE_TO_CATEGORY: Record<string, ServiceCategory | undefined> = {
      in_exam: 'examination',
      in_measurement: 'measurement',
      measurement_ready: 'measurement',
      awaiting_surgery_sales: 'surgery',
    };

    // Delta audit C-5 — N+1 hasPaidSession yerine bulk sorgu (50 encounter
    // tek sorguda kontrol).
    const pairs = candidates
      .map((enc) => ({ patientId: enc.patientId, category: STAGE_TO_CATEGORY[enc.stage] }))
      .filter(
        (p): p is { patientId: string; category: ServiceCategory } => p.category !== undefined,
      );
    const paidKeys = await this.hasPaidSessionsBulk(pairs);
    const activeUnpaidEncounters = candidates.filter((enc) => {
      const category = STAGE_TO_CATEGORY[enc.stage];
      if (!category) return false;
      return !paidKeys.has(`${enc.patientId}::${category}`);
    });

    const [bypassActiveCount, bypassTotalToday] = await Promise.all([
      tx.encounter.count({
        where: {
          deletedAt: null,
          emergencyBypassActivatedAt: { not: null },
          emergencyBypassClosedAt: null,
        },
      }),
      tx.encounter.count({
        where: {
          deletedAt: null,
          emergencyBypassActivatedAt: { gte: todayStart },
        },
      }),
    ]);

    return {
      activeUnpaidEncounters: activeUnpaidEncounters.map((e) => ({
        id: e.id,
        stage: e.stage,
        stageUpdatedAt: e.stageUpdatedAt,
        patient: e.patient!,
      })),
      bypassActiveCount,
      bypassTotalToday,
    };
  }
}
