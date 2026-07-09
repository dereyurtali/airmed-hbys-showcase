import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { Prisma } from '@airmed/db';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

// v0.4.2 Karar 9 — POS indirim cap'i (ara-toplam yüzdesi). Aşılırsa süpervizör onayı.
const POS_DISCOUNT_CAP_PCT = 10;
const POS_SUPERVISOR_ROLES = ['yonetici', 'finans'];
import {
  BatchAdjustInput,
  BatchCreateInput,
  CashCloseInput,
  CashOpenInput,
  ProductCreateInput,
  ProductListQuery,
  ProductUpdateInput,
  ReportQuery,
  ReturnCreateInput,
  SaleCreateInput,
  SaleListQuery,
} from './pharmacy-retail.schemas';

interface Actor {
  id: string;
  roles: readonly string[];
}

// v0.4 #552 — Eczane perakende mantığı: ürün/parti katalog, POS satış (stok düş +
// tahsilat), iade (stok+kasa düzelt), gün sonu kasa + finansa teslim, satış
// raporları, reçete → satış köprüsü. KVKK: anonim walk-in satış.
//
// Yetki (rol) router'da; iş kuralları (yeterli stok, açık kasa) burada.
@Injectable()
export class PharmacyRetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ======================= ÜRÜN KATALOG =======================
  async listProducts({ search, includeInactive }: ProductListQuery) {
    const where: Prisma.PharmacyProductWhereInput = {
      deletedAt: null,
      ...(includeInactive ? {} : { isActive: true }),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { code: { contains: search, mode: 'insensitive' as const } },
              { barcode: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    return this.prisma.scoped.pharmacyProduct.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { batches: { where: { deletedAt: null }, orderBy: { expiresAt: 'asc' } } },
    });
  }

  async createProduct(input: ProductCreateInput) {
    const tenantId = this.tenantContext.requireTenantId();
    try {
      return await this.prisma.scoped.pharmacyProduct.create({
        data: {
          tenantId,
          code: input.code,
          name: input.name,
          barcode: input.barcode ?? null,
          nameRu: input.nameRu ?? null,
          nameTg: input.nameTg ?? null,
          category: input.category ?? null,
          unit: input.unit ?? null,
          requiresPrescription: input.requiresPrescription,
        },
      });
    } catch (err) {
      this.rethrowUnique(err, 'Bu kodda bir ürün zaten var');
    }
  }

  async updateProduct(id: string, input: ProductUpdateInput) {
    await this.requireProduct(id);
    try {
      return await this.prisma.scoped.pharmacyProduct.update({
        where: { id },
        data: {
          ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
          ...(input.nameRu !== undefined ? { nameRu: input.nameRu } : {}),
          ...(input.nameTg !== undefined ? { nameTg: input.nameTg } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.unit !== undefined ? { unit: input.unit } : {}),
          ...(input.requiresPrescription !== undefined
            ? { requiresPrescription: input.requiresPrescription }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
    } catch (err) {
      this.rethrowUnique(err, 'Bu kodda bir ürün zaten var');
    }
  }

  async softDeleteProduct(id: string) {
    await this.requireProduct(id);
    await this.prisma.scoped.pharmacyProduct.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { ok: true as const };
  }

  // ======================= PARTİ / MAL KABUL =======================
  async createBatch(input: BatchCreateInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    await this.requireProduct(input.productId);
    const batch = await this.prisma.scoped.pharmacyBatch.create({
      data: {
        tenantId,
        productId: input.productId,
        lotNumber: input.lotNumber ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        costPrice: input.costPrice ?? null,
        salePrice: input.salePrice,
        currency: input.currency,
        availableQty: input.quantity,
        supplierId: input.supplierId ?? null,
        receivedAt: input.quantity > 0 ? new Date() : null,
      },
    });
    if (input.quantity > 0) {
      await this.recordMovement(tenantId, input.productId, batch.id, 'intake', input.quantity, {
        referenceType: 'batch',
        referenceId: batch.id,
        createdById: actor.id,
      });
    }
    return batch;
  }

  async adjustBatch(input: BatchAdjustInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    const batch = await this.requireBatch(input.id);
    const next = batch.availableQty + input.delta;
    if (next < 0) {
      throw new BadRequestException(
        `Parti stoğu negatife düşemez (mevcut ${batch.availableQty}, delta ${input.delta})`,
      );
    }
    const updated = await this.prisma.scoped.pharmacyBatch.update({
      where: { id: input.id },
      data: { availableQty: next },
    });
    await this.recordMovement(tenantId, batch.productId, batch.id, 'adjustment', input.delta, {
      notes: input.reason ?? null,
      createdById: actor.id,
    });
    return updated;
  }

  // ======================= POS SATIŞ =======================
  /**
   * Karar 9 — POS >%{cap} indirim override'ı. Süpervizör (yönetici/finans) e-posta+şifresini
   * inline doğrular (bcrypt + rol). Geçersiz/eksik → 403. Async onay kuyruğu DEĞİL.
   */
  private async assertSupervisorOverride(
    override: { email: string; password: string } | undefined,
  ): Promise<void> {
    if (!override) {
      throw new ForbiddenException(
        `İndirim %${POS_DISCOUNT_CAP_PCT}'u aşıyor — süpervizör (yönetici/finans) onayı gerekli`,
      );
    }
    const user = await this.prisma.scoped.user.findFirst({
      where: {
        email: { equals: override.email, mode: 'insensitive' },
        deletedAt: null,
        status: 'active',
      },
      select: {
        passwordHash: true,
        userRoles: { select: { role: { select: { key: true } } } },
      },
    });
    if (!user) throw new ForbiddenException('Süpervizör doğrulanamadı');
    const valid = await bcrypt.compare(override.password, user.passwordHash);
    if (!valid) throw new ForbiddenException('Süpervizör şifresi hatalı');
    const roleKeys = user.userRoles.map((ur) => ur.role.key);
    if (!roleKeys.some((k) => POS_SUPERVISOR_ROLES.includes(k))) {
      throw new ForbiddenException('Yetkili süpervizör değil (yönetici veya finans gerekli)');
    }
  }

  async createSale(input: SaleCreateInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();

    // Satır toplamları saf input'tan türetilir — süpervizör kontrolü için
    // erken hesaplanır.
    const lines = input.items.map((it) => ({
      tenantId,
      productId: it.productId,
      batchId: it.batchId ?? null,
      itemName: it.itemName,
      // #790 — eczacının manuel eşlediği reçete kalemi (muadil/kısmi audit).
      prescriptionItemLabel: it.prescriptionItemLabel ?? null,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      lineTotal: round2(it.quantity * it.unitPrice),
    }));
    const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));

    // v0.4.2 Karar 9 — indirim ara-toplamın %10'unu aşarsa süpervizör (yönetici/finans)
    // onayı zorunlu; yoksa 403 (istemci %10 cap uygular). Mutlak tutar → yüzde.
    // #1061 — fail-fast: bcrypt'li PIN kontrolü reçete/stok sorgularından ÖNCE
    // koşar; 403 yolunda tx'te gereksiz iş yapılmaz. Not: #969 gereği tüm istek
    // tek runWithTenant tx'inde koşar — bcrypt bu tx'in tamamen dışına mimari
    // değişmeden alınamaz; buradaki kazanç tx'te tutulan işi kısaltmaktır.
    const discountPct = subtotal > 0 ? (input.discount / subtotal) * 100 : 0;
    if (discountPct > POS_DISCOUNT_CAP_PCT + 1e-6) {
      await this.assertSupervisorOverride(input.supervisorOverride);
    }

    // #711 (A) — Reçete zorunluluğu: reçeteli (requiresPrescription) ürün anonim
    // walk-in'e reçetesiz SATILAMAZ (KVKK + Tacik kontrollü madde + hasta güvenliği).
    // `requiresPrescription` üründe saklı ama satışta okunmuyordu → reçeteli ilaç
    // reçetesiz çıkabiliyordu. Satır ürünlerini yükle; biri reçeteli ise geçerli
    // (silinmemiş, ilaç tipi) prescriptionId + isAnonymous=false zorunlu.
    const productIds = [...new Set(input.items.map((i) => i.productId))];
    const products = await this.prisma.scoped.pharmacyProduct.findMany({
      where: { id: { in: productIds }, deletedAt: null },
      select: { id: true, requiresPrescription: true },
    });
    const rxFlag = new Map(products.map((p) => [p.id, p.requiresPrescription]));
    const rxRequired = input.items.filter((i) => rxFlag.get(i.productId) === true);
    if (rxRequired.length > 0) {
      if (input.isAnonymous || !input.prescriptionId) {
        const names = rxRequired.map((i) => i.itemName).join(', ');
        throw new BadRequestException(
          `Reçeteli ürün reçetesiz satılamaz: ${names}. Reçete seçin (anonim satış kapalı).`,
        );
      }
      const rx = await this.prisma.scoped.prescription.findFirst({
        where: { id: input.prescriptionId, deletedAt: null, type: 'drug' },
        select: { id: true },
      });
      if (!rx) {
        throw new BadRequestException('Geçerli bir ilaç reçetesi bulunamadı');
      }
    }

    // Stok ön-kontrol (dostça hata mesajı). Kesin oversell guard'ı aşağıdaki
    // koşullu decrement'tir (#711 B). #1063 — kalem başına ayrı sorgu yerine
    // tek fetch + Map lookup (satış tx'inde round-trip azaltma).
    const batchIds = [...new Set(input.items.flatMap((i) => (i.batchId ? [i.batchId] : [])))];
    if (batchIds.length > 0) {
      const batches = await this.prisma.scoped.pharmacyBatch.findMany({
        where: { id: { in: batchIds }, deletedAt: null },
        select: { id: true, availableQty: true },
      });
      const byId = new Map(batches.map((b) => [b.id, b.availableQty]));
      for (const item of input.items) {
        if (!item.batchId) continue;
        const available = byId.get(item.batchId);
        if (available === undefined) throw new NotFoundException('Parti bulunamadı');
        if (available < item.quantity) {
          throw new BadRequestException(
            `Yetersiz stok: ${item.itemName} (mevcut ${available}, istenen ${item.quantity})`,
          );
        }
      }
    }

    const total = round2(Math.max(0, subtotal - input.discount));
    const openCashId = await this.currentOpenCashId();

    const sale = await this.insertWithNo('S', (saleNo) => ({
      tenantId,
      saleNo,
      status: 'completed',
      isAnonymous: input.isAnonymous,
      patientId: input.isAnonymous ? null : (input.patientId ?? null),
      prescriptionId: input.prescriptionId ?? null,
      subtotal,
      discount: input.discount,
      totalAmount: total,
      currency: input.currency,
      paymentMethod: input.paymentMethod,
      cashClosureId: openCashId,
      soldById: actor.id,
      items: { create: lines },
    }));

    // #711 (B) — Stok düş: KOŞULLU updateMany (oversell yarışına karşı). İstek
    // tek transaction'da koşsa bile düz `decrement` READ COMMITTED'da iki eşzamanlı
    // satışta availableQty'i negatife düşürebilir (ön-kontrol bayat snapshot'tan).
    // `availableQty >= qty` guard'ı + version artışı = IolLot 3-state deseni; 0 satır
    // eşleşirse stok yarışta tükendi → 409 (transaction rollback satışı geri alır).
    for (const item of input.items) {
      if (!item.batchId) continue;
      const res = await this.prisma.scoped.pharmacyBatch.updateMany({
        where: { id: item.batchId, deletedAt: null, availableQty: { gte: item.quantity } },
        data: { availableQty: { decrement: item.quantity }, version: { increment: 1 } },
      });
      if (res.count === 0) {
        throw new ConflictException(
          `Stok eşzamanlı tükendi: ${item.itemName}. Satışı tekrar deneyin.`,
        );
      }
      await this.recordMovement(tenantId, item.productId, item.batchId, 'sale', -item.quantity, {
        referenceType: 'sale',
        referenceId: sale.id,
        createdById: actor.id,
      });
    }
    return sale;
  }

  async listSales(query: SaleListQuery) {
    const where: Prisma.PharmacySaleWhereInput = {
      deletedAt: null,
      ...(query.cashClosureId ? { cashClosureId: query.cashClosureId } : {}),
      ...dateRange('soldAt', query.from, query.to),
    };
    return this.prisma.scoped.pharmacySale.findMany({
      where,
      orderBy: { soldAt: 'desc' },
      include: { items: true },
      take: 200,
    });
  }

  async findSaleById(id: string) {
    const sale = await this.prisma.scoped.pharmacySale.findFirst({
      where: { id, deletedAt: null },
      include: {
        items: true,
        returns: true,
        patient: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!sale) throw new NotFoundException('Satış bulunamadı');
    return sale;
  }

  // ======================= İADE =======================
  async createReturn(input: ReturnCreateInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    const sale = await this.prisma.scoped.pharmacySale.findFirst({
      where: { id: input.saleId, deletedAt: null },
      include: { items: true },
    });
    if (!sale) throw new NotFoundException('Satış bulunamadı');
    if (sale.status === 'voided') throw new ConflictException('İptal edilmiş satış iade edilemez');

    const saleItems = new Map(sale.items.map((i) => [i.id, i]));
    const lines = input.items.map((r) => {
      const si = saleItems.get(r.saleItemId);
      if (!si) throw new BadRequestException('İade kalemi bu satışa ait değil');
      if (r.quantity > si.quantity) {
        throw new BadRequestException(`İade adedi satıştan fazla (${si.itemName})`);
      }
      return {
        tenantId,
        saleItemId: si.id,
        productId: si.productId,
        batchId: si.batchId,
        quantity: r.quantity,
        unitPrice: si.unitPrice,
        lineTotal: round2(r.quantity * Number(si.unitPrice)),
      };
    });
    const total = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
    const openCashId = await this.currentOpenCashId();

    const ret = await this.insertWithNo('R', (returnNo) => ({
      tenantId,
      returnNo,
      saleId: sale.id,
      reason: input.reason ?? null,
      totalAmount: total,
      currency: sale.currency,
      processedById: actor.id,
      cashClosureId: openCashId,
      items: { create: lines },
    }));

    // Stok geri ekle + hareket.
    for (const l of lines) {
      if (!l.batchId || !l.productId) continue;
      await this.prisma.scoped.pharmacyBatch.update({
        where: { id: l.batchId },
        data: { availableQty: { increment: l.quantity } },
      });
      await this.recordMovement(tenantId, l.productId, l.batchId, 'return', l.quantity, {
        referenceType: 'return',
        referenceId: ret.id,
        createdById: actor.id,
      });
    }
    return ret;
  }

  async listReturns(query: SaleListQuery) {
    const where: Prisma.PharmacyReturnWhereInput = {
      ...(query.cashClosureId ? { cashClosureId: query.cashClosureId } : {}),
      ...dateRange('createdAt', query.from, query.to),
    };
    return this.prisma.scoped.pharmacyReturn.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { items: true },
      take: 200,
    });
  }

  // ======================= KASA (gün sonu) =======================
  async openCash(input: CashOpenInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    const existing = await this.currentOpenCashId();
    if (existing) throw new ConflictException('Zaten açık bir kasa var; önce kapatın');
    const today = startOfDay(new Date());
    return this.prisma.scoped.pharmacyCashClosure.create({
      data: {
        tenantId,
        businessDate: today,
        status: 'open',
        currency: input.currency,
        openingFloat: input.openingFloat,
        openedById: actor.id,
      },
    });
  }

  async closeCash(input: CashCloseInput, actor: Actor) {
    const closure = await this.requireCash(input.id);
    if (closure.status !== 'open') throw new ConflictException('Kasa zaten kapalı');

    const sales = await this.prisma.scoped.pharmacySale.findMany({
      where: { cashClosureId: closure.id, deletedAt: null, status: 'completed' },
      select: { totalAmount: true },
    });
    const returns = await this.prisma.scoped.pharmacyReturn.findMany({
      where: { cashClosureId: closure.id },
      select: { totalAmount: true },
    });
    const salesTotal = round2(sales.reduce((s, x) => s + Number(x.totalAmount), 0));
    const refundTotal = round2(returns.reduce((s, x) => s + Number(x.totalAmount), 0));
    const expected = round2(Number(closure.openingFloat) + salesTotal - refundTotal);
    const variance = round2(input.countedAmount - expected);

    return this.prisma.scoped.pharmacyCashClosure.update({
      where: { id: closure.id },
      data: {
        status: 'closed',
        salesTotal,
        refundTotal,
        expectedAmount: expected,
        countedAmount: input.countedAmount,
        variance,
        saleCount: sales.length,
        refundCount: returns.length,
        closedById: actor.id,
        closedAt: new Date(),
        notes: input.notes ?? null,
      },
    });
  }

  // Eczacı → finans teslim mutabakatı.
  async handToFinance(id: string, actor: Actor) {
    const closure = await this.requireCash(id);
    if (closure.status !== 'closed') {
      throw new ConflictException('Yalnız kapatılmış kasa finansa teslim edilebilir');
    }
    return this.prisma.scoped.pharmacyCashClosure.update({
      where: { id },
      data: {
        status: 'handed_to_finance',
        handedToFinanceAt: new Date(),
        handedToFinanceById: actor.id,
      },
    });
  }

  // #664 — 2-aşama kasa devri ikinci ayak: FİNANS mutabakatı. Görev ayrılığı:
  // kasayı finansa teslim eden (handToFinance) kişi mutabakatı YAPAMAZ (başka
  // finans yetkilisi onaylar). Sapma (variance) zaten closeCash'te kaydedildi.
  async reconcileCash(id: string, actor: Actor) {
    const closure = await this.requireCash(id);
    if (closure.status !== 'handed_to_finance') {
      throw new ConflictException('Yalnız finansa teslim edilmiş kasa mutabık edilebilir');
    }
    if (closure.reconciledAt) {
      throw new ConflictException('Kasa zaten mutabık edildi');
    }
    if (closure.handedToFinanceById && closure.handedToFinanceById === actor.id) {
      throw new ForbiddenException(
        'Görev ayrılığı: kasayı finansa teslim eden kişi mutabakatı yapamaz (başka finans yetkilisi onaylamalı)',
      );
    }
    return this.prisma.scoped.pharmacyCashClosure.update({
      where: { id },
      data: { reconciledAt: new Date(), reconciledById: actor.id },
    });
  }

  async listCash(query: SaleListQuery) {
    return this.prisma.scoped.pharmacyCashClosure.findMany({
      where: dateRange('businessDate', query.from, query.to),
      orderBy: { businessDate: 'desc' },
      take: 100,
    });
  }

  // v0.4.1 (#692) — eczane stok hareketleri (Mal Kabul / Stok Hareketleri ekranı):
  // tenant-geneli son hareketler (intake=mal kabul / sale / return / adjustment /
  // disposal / expire) ürün + parti + kullanıcı ile. RLS scoped.
  async recentMovements(limit = 100) {
    return this.prisma.scoped.pharmacyStockMovement.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        createdBy: { select: { id: true, name: true } },
        product: { select: { name: true, code: true } },
        batch: { select: { lotNumber: true } },
      },
    });
  }

  // v0.4.1 (#693) — Eczane Tedarikçileri: eczane partilerine (PharmacyBatch)
  // tedarik yapmış tedarikçiler (genel Supplier modeli) + parti/ürün sayısı.
  // Eczaneye özel ayrı supplier modeli yok; pharmacy batch üzerinden türetilir.
  async pharmacySuppliers() {
    const batches = await this.prisma.scoped.pharmacyBatch.findMany({
      where: { supplierId: { not: null } },
      select: {
        productId: true,
        supplier: {
          select: { id: true, name: true, contactPhone: true, contactEmail: true },
        },
      },
    });
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        contactPhone: string | null;
        contactEmail: string | null;
        batchCount: number;
        productIds: Set<string>;
      }
    >();
    for (const b of batches) {
      if (!b.supplier) continue;
      const cur = map.get(b.supplier.id) ?? {
        id: b.supplier.id,
        name: b.supplier.name,
        contactPhone: b.supplier.contactPhone,
        contactEmail: b.supplier.contactEmail,
        batchCount: 0,
        productIds: new Set<string>(),
      };
      cur.batchCount += 1;
      cur.productIds.add(b.productId);
      map.set(b.supplier.id, cur);
    }
    return [...map.values()]
      .map(({ productIds, ...rest }) => ({ ...rest, productCount: productIds.size }))
      .sort((a, b) => b.batchCount - a.batchCount);
  }

  async currentCash() {
    const id = await this.currentOpenCashId();
    if (!id) return null;
    return this.prisma.scoped.pharmacyCashClosure.findFirst({ where: { id } });
  }

  // ======================= RAPOR =======================
  async salesReport(query: ReportQuery) {
    const sales = await this.prisma.scoped.pharmacySale.findMany({
      where: {
        deletedAt: null,
        status: 'completed',
        ...dateRange('soldAt', query.from, query.to),
      },
      include: { items: { include: { batch: { select: { costPrice: true } } } } },
    });
    let revenue = 0;
    let cost = 0;
    const byProduct = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const sale of sales) {
      for (const it of sale.items) {
        const line = Number(it.lineTotal);
        revenue += line;
        cost += Number(it.batch?.costPrice ?? 0) * it.quantity;
        const pid = it.productId ?? it.id;
        const cur = byProduct.get(pid) ?? { name: it.itemName, qty: 0, revenue: 0 };
        cur.qty += it.quantity;
        cur.revenue += line;
        byProduct.set(pid, cur);
      }
    }
    const returns = await this.prisma.scoped.pharmacyReturn.findMany({
      where: dateRange('createdAt', query.from, query.to),
      select: { totalAmount: true },
    });
    const refundTotal = round2(returns.reduce((s, x) => s + Number(x.totalAmount), 0));
    const topProducts = [...byProduct.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
      .map((p) => ({ name: p.name, qty: p.qty, revenue: round2(p.revenue) }));

    return {
      saleCount: sales.length,
      revenue: round2(revenue),
      cost: round2(cost),
      grossProfit: round2(revenue - cost),
      refundTotal,
      refundCount: returns.length,
      netRevenue: round2(revenue - refundTotal),
      topProducts,
    };
  }

  // ======================= REÇETE KÖPRÜSÜ =======================
  // Doktorun İÇ eczaneye gönderdiği ilaç reçeteleri kuyruğa düşer; eczacı satışa çevirir.
  async listDispensablePrescriptions() {
    // #664 KVKK (need-to-know): eczane kuyruğu yalnız dispense için gerekeni görür —
    // ilaç kalemleri + minimal hasta. Doktorun serbest-metin klinik `notes`'u (≤2000
    // char, tanı/klinik bağlam taşıyabilir) ve createdById eczane rolüne SIZDIRILMAZ.
    // `include` yerine açık `select` (notes/createdById/supplierId hariç).
    //
    // #712 — `supplierId: null` ŞART: `sentAt` "sevk edildi" demek ama hedefi
    // `supplierId` ayırır. supplierId DOLU = dış tedarikçi siparişi (QR akışı,
    // sendPrescription) — iç POS kuyruğuna GİRMEMELİ. supplierId NULL = iç eczane
    // dispense (dispenseToPharmacy). Eskiden filtre yalnız sentAt'a bakıyordu →
    // dış-tedarikçi reçeteleri yanlışlıkla iç kuyruğa düşüyordu.
    return this.prisma.scoped.prescription.findMany({
      // #790 — tamamı dağıtılmış reçete kuyruktan düşer (pending + partial kalır).
      where: {
        deletedAt: null,
        type: 'drug',
        sentAt: { not: null },
        supplierId: null,
        dispenseStatus: { not: 'dispensed' },
      },
      orderBy: { sentAt: 'desc' },
      select: {
        id: true,
        type: true,
        items: true,
        sentAt: true,
        dispenseStatus: true,
        patientId: true,
        createdAt: true,
        patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
      },
      take: 100,
    });
  }

  // #790 — Eczacı reçeteyi dağıttıkça durumu işaretler. Klinik-güvenlik: dispense
  // kaydı satışta (PharmacySaleItem.prescriptionItemLabel) tutulur; bu yalnız
  // kuyruk yaşam döngüsü (kısmi = kalan kalemler sonraki ziyaret). 'pending'e
  // geri alınamaz (tek yön: pending→partial→dispensed).
  async markPrescriptionDispense(id: string, status: 'partial' | 'dispensed') {
    const rx = await this.prisma.scoped.prescription.findFirst({
      where: { id, deletedAt: null, type: 'drug' },
      select: { id: true, dispenseStatus: true },
    });
    if (!rx) throw new NotFoundException('Reçete bulunamadı');
    if (rx.dispenseStatus === 'dispensed') {
      throw new BadRequestException('Reçete zaten tamamen dağıtıldı');
    }
    return this.prisma.scoped.prescription.update({
      where: { id },
      data: { dispenseStatus: status },
      select: { id: true, dispenseStatus: true },
    });
  }

  // ======================= yardımcılar =======================
  private async currentOpenCashId(): Promise<string | null> {
    const c = await this.prisma.scoped.pharmacyCashClosure.findFirst({
      where: { status: 'open' },
      orderBy: { openedAt: 'desc' },
      select: { id: true },
    });
    return c?.id ?? null;
  }

  private async recordMovement(
    tenantId: string,
    productId: string,
    batchId: string | null,
    type: 'intake' | 'sale' | 'return' | 'adjustment' | 'disposal' | 'expire',
    quantityDelta: number,
    extra: {
      referenceType?: string | null;
      referenceId?: string | null;
      notes?: string | null;
      createdById?: string | null;
    },
  ) {
    await this.prisma.scoped.pharmacyStockMovement.create({
      data: {
        tenantId,
        productId,
        batchId,
        type,
        quantityDelta,
        referenceType: extra.referenceType ?? null,
        referenceId: extra.referenceId ?? null,
        notes: extra.notes ?? null,
        createdById: extra.createdById ?? null,
      },
    });
  }

  // saleNo/returnNo: <prefix>-<yıl>-<5hane>, race-free (count + P2002 retry).
  private async insertWithNo(
    prefix: 'S' | 'R',
    build: (
      no: string,
    ) => Prisma.PharmacySaleUncheckedCreateInput | Prisma.PharmacyReturnUncheckedCreateInput,
  ): Promise<{ id: string }> {
    const year = new Date().getFullYear();
    const counter =
      prefix === 'S' ? this.prisma.scoped.pharmacySale : this.prisma.scoped.pharmacyReturn;
    const base = await (counter as { count: (a: unknown) => Promise<number> }).count({
      where:
        prefix === 'S'
          ? { saleNo: { startsWith: `S-${year}-` } }
          : { returnNo: { startsWith: `R-${year}-` } },
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      const no = `${prefix}-${year}-${String(base + 1 + attempt).padStart(5, '0')}`;
      try {
        if (prefix === 'S') {
          return await this.prisma.scoped.pharmacySale.create({
            data: build(no) as Prisma.PharmacySaleUncheckedCreateInput,
          });
        }
        return await this.prisma.scoped.pharmacyReturn.create({
          data: build(no) as Prisma.PharmacyReturnUncheckedCreateInput,
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002' && attempt < 4) continue;
        throw err;
      }
    }
    throw new BadRequestException('Belge numarası üretilemedi');
  }

  private async requireProduct(id: string) {
    const p = await this.prisma.scoped.pharmacyProduct.findFirst({
      where: { id, deletedAt: null },
    });
    if (!p) throw new NotFoundException('Ürün bulunamadı');
    return p;
  }

  private async requireBatch(id: string) {
    const b = await this.prisma.scoped.pharmacyBatch.findFirst({ where: { id, deletedAt: null } });
    if (!b) throw new NotFoundException('Parti bulunamadı');
    return b;
  }

  private async requireCash(id: string) {
    const c = await this.prisma.scoped.pharmacyCashClosure.findFirst({ where: { id } });
    if (!c) throw new NotFoundException('Kasa kaydı bulunamadı');
    return c;
  }

  private rethrowUnique(err: unknown, message: string): never {
    if ((err as { code?: string })?.code === 'P2002') throw new ConflictException(message);
    throw err as Error;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dateRange(field: string, from?: string, to?: string): Record<string, unknown> {
  if (!from && !to) return {};
  const range: Record<string, Date> = {};
  if (from) range.gte = new Date(from);
  if (to) range.lte = new Date(to);
  return { [field]: range };
}
