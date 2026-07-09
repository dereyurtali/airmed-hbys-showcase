import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@airmed/db';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import {
  PoCreateInput,
  PoListQuery,
  PoReceiveInput,
  PoRejectInput,
} from './purchase-order.schemas';

interface Actor {
  id: string;
  roles: readonly string[];
}

// v0.4 #549 — Satın Alma Siparişi yaşam döngüsü + onay + mal kabul → stok.
//
// Durum makinesi:
//   draft → submit → (total ≥ eşik) pending_approval | (altında) submitted
//   pending_approval → approve (finans, oluşturan ≠ onaylayan) → approved
//                    → reject → cancelled
//   submitted | approved → receive → received  (mal kabul → stok artışı)
//   herhangi (received hariç) → cancel → cancelled
//
// Yetki (rol) router'da permissionProcedure ile; görev ayrılığı (oluşturan ≠
// onaylayan) data-bağımlı olduğu için BURADA. Eşik üstü tutar finans onayı ister.
//
// v0.4 sade: eşik TJS-eşdeğeri sabit; para-birimi normalizasyonu ileri faz.
const PO_APPROVAL_THRESHOLD = 10000;

@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(query: PoListQuery) {
    const where: Prisma.PurchaseOrderWhereInput = {
      deletedAt: null,
      ...(query.domain ? { domain: query.domain } : {}),
      ...(query.pendingApprovalOnly
        ? { status: 'pending_approval' }
        : query.status
          ? { status: query.status }
          : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    };
    return this.prisma.scoped.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { supplier: { select: { id: true, name: true } }, items: true },
    });
  }

  // #713 — PO kalemi → stok varlığı bağlama seçenekleri. PO oluşturan (stok_satinalma)
  // pharmacyRetail.listProducts'a (page:pharmacyStock) erişemez; bu query aynı
  // action:po.create yetkisiyle referanslanabilir consumable + eczane ürünlerini
  // hafif (id/name/code) döndürür. clinic domain → consumable, pharmacy → product.
  async referenceOptions() {
    const [consumables, pharmacyProducts] = await Promise.all([
      this.prisma.scoped.consumable.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.scoped.pharmacyProduct.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { consumables, pharmacyProducts };
  }

  async findById(id: string) {
    const po = await this.prisma.scoped.purchaseOrder.findFirst({
      where: { id, deletedAt: null },
      include: {
        supplier: true,
        items: true,
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });
    if (!po) throw new NotFoundException('Sipariş bulunamadı');
    return po;
  }

  async create(input: PoCreateInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    await this.requireSupplier(input.supplierId);
    const items = input.items.map((it) => ({
      tenantId,
      itemName: it.itemName,
      referenceType: it.referenceType ?? null,
      referenceId: it.referenceId ?? null,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      lineTotal: round2(it.quantity * it.unitPrice),
    }));
    const total = round2(items.reduce((s, it) => s + it.lineTotal, 0));

    return this.insertWithOrderNo((orderNo) => ({
      tenantId,
      orderNo,
      supplierId: input.supplierId,
      domain: input.domain,
      status: 'draft',
      currency: input.currency,
      totalAmount: total,
      approvalThreshold: PO_APPROVAL_THRESHOLD,
      notes: input.notes ?? null,
      createdById: actor.id,
      items: { create: items },
    }));
  }

  // draft → submitted | pending_approval (eşik üstü). Yalnız oluşturan/yetkili.
  async submit(id: string) {
    const po = await this.requirePo(id);
    if (po.status !== 'draft') {
      throw new BadRequestException('Yalnız taslak sipariş gönderilebilir');
    }
    const needsApproval =
      Number(po.totalAmount) >= Number(po.approvalThreshold ?? PO_APPROVAL_THRESHOLD);
    return this.prisma.scoped.purchaseOrder.update({
      where: { id },
      data: {
        status: needsApproval ? 'pending_approval' : 'submitted',
        submittedAt: new Date(),
      },
      include: { items: true },
    });
  }

  // pending_approval → approved. Görev ayrılığı: oluşturan onaylayamaz. Rol
  // (yonetici/finans) router'da action:po.approve ile.
  async approve(id: string, actor: Actor) {
    const po = await this.requirePo(id);
    if (po.status !== 'pending_approval') {
      throw new BadRequestException('Yalnız onay bekleyen sipariş onaylanabilir');
    }
    // #665 — görev ayrılığı FAIL-CLOSED: createdById null ise oluşturan
    // doğrulanamaz → onaya izin verme (önceki guard null'da fail-open'dı).
    if (!po.createdById || po.createdById === actor.id) {
      throw new ForbiddenException(
        'Görev ayrılığı: kendi oluşturduğunuz siparişi onaylayamazsınız (başka finans yetkilisi onaylamalı)',
      );
    }
    return this.prisma.scoped.purchaseOrder.update({
      where: { id },
      data: { status: 'approved', approvedById: actor.id, approvedAt: new Date() },
      include: { items: true },
    });
  }

  // pending_approval → cancelled (ret).
  async reject(input: PoRejectInput, actor: Actor) {
    const po = await this.requirePo(input.id);
    if (po.status !== 'pending_approval') {
      throw new BadRequestException('Yalnız onay bekleyen sipariş reddedilebilir');
    }
    // #665 — fail-closed: createdById null ise reddi de engelle (oluşturan doğrulanamaz).
    if (!po.createdById || po.createdById === actor.id) {
      throw new ForbiddenException('Görev ayrılığı: kendi siparişinizi siz reddedemezsiniz');
    }
    const notes = input.reason
      ? `${po.notes ? po.notes + '\n' : ''}[RET] ${input.reason}`
      : po.notes;
    return this.prisma.scoped.purchaseOrder.update({
      where: { id: input.id },
      data: { status: 'cancelled', cancelledAt: new Date(), notes },
      include: { items: true },
    });
  }

  // submitted | approved → received. Kalem bazlı kısmi kabul. Mal kabul → stok
  // (#713): referenceType'a göre gerçek stok girişi:
  //   - consumable      → Consumable.availableQty artışı (düz sayaç)
  //   - pharmacy_product → yeni PharmacyBatch (cost=unitPrice, sale=unitPrice
  //     default; lot/SKT eczacı sonra düzeltir) + intake stok hareketi
  // (iol_model PO_REFERENCE_TYPES'ta yok: IolLot fiziksel kutu verisi ister.)
  async receive(input: PoReceiveInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    const po = await this.requirePo(input.id);
    if (po.status !== 'submitted' && po.status !== 'approved') {
      throw new BadRequestException('Yalnız gönderilmiş/onaylı sipariş teslim alınabilir');
    }
    const items = await this.prisma.scoped.purchaseOrderItem.findMany({
      where: { purchaseOrderId: po.id },
    });
    const byId = new Map((input.items ?? []).map((r) => [r.itemId, r.receivedQty]));

    for (const item of items) {
      const receivedQty = input.items ? (byId.get(item.id) ?? 0) : item.quantity;
      if (receivedQty <= 0) continue;
      await this.prisma.scoped.purchaseOrderItem.update({
        where: { id: item.id },
        data: { receivedQty },
      });
      if (!item.referenceId) continue;
      // Mal kabul → stok artışı (idempotent değil; receive 1 kez çağrılır, durum
      // submitted/approved → received geçişiyle korunur).
      if (item.referenceType === 'consumable') {
        await this.prisma.scoped.consumable.updateMany({
          where: { id: item.referenceId, deletedAt: null },
          data: { availableQty: { increment: receivedQty } },
        });
      } else if (item.referenceType === 'pharmacy_product') {
        await this.receivePharmacyProduct(tenantId, po, item, receivedQty, actor);
      }
    }

    return this.prisma.scoped.purchaseOrder.update({
      where: { id: po.id },
      data: { status: 'received', receivedAt: new Date() },
      include: { items: true },
    });
  }

  // #713 — eczane ürünü mal kabulü: her teslimat yeni bir PharmacyBatch'tir
  // (gerçek eczane akışı: parti başına teslimat). salePrice zorunlu → maliyetle
  // başlat (eczacı kâr marjını sonra düzeltir); lot/SKT bilinmiyorsa null.
  private async receivePharmacyProduct(
    tenantId: string,
    po: { id: string; currency: 'TJS' | 'USD'; supplierId: string },
    item: { referenceId: string | null; unitPrice: Prisma.Decimal | number },
    receivedQty: number,
    actor: Actor,
  ) {
    if (!item.referenceId) return;
    const product = await this.prisma.scoped.pharmacyProduct.findFirst({
      where: { id: item.referenceId, deletedAt: null },
      select: { id: true },
    });
    if (!product) return;
    const unit = Number(item.unitPrice);
    const batch = await this.prisma.scoped.pharmacyBatch.create({
      data: {
        tenantId,
        productId: product.id,
        costPrice: unit,
        salePrice: unit,
        currency: po.currency,
        availableQty: receivedQty,
        supplierId: po.supplierId,
        receivedAt: new Date(),
      },
    });
    await this.prisma.scoped.pharmacyStockMovement.create({
      data: {
        tenantId,
        productId: product.id,
        batchId: batch.id,
        type: 'intake',
        quantityDelta: receivedQty,
        referenceType: 'purchase_order',
        referenceId: po.id,
        createdById: actor.id,
      },
    });
  }

  // draft/submitted/pending_approval/approved → cancelled. received iptal edilemez.
  async cancel(id: string) {
    const po = await this.requirePo(id);
    if (po.status === 'received') {
      throw new BadRequestException('Teslim alınmış sipariş iptal edilemez');
    }
    if (po.status === 'cancelled') return po;
    return this.prisma.scoped.purchaseOrder.update({
      where: { id },
      data: { status: 'cancelled', cancelledAt: new Date() },
      include: { items: true },
    });
  }

  // --- yardımcılar -----------------------------------------------------------

  // orderNo: PO-<yıl>-<5hane>. Race-free: count tabanlı seq + P2002 retry
  // (tenant_id+order_no unique). MRN üretimindeki self-heal deseni.
  private async insertWithOrderNo(
    build: (orderNo: string) => Prisma.PurchaseOrderUncheckedCreateInput,
  ) {
    const year = new Date().getFullYear();
    const base = await this.prisma.scoped.purchaseOrder.count({
      where: { orderNo: { startsWith: `PO-${year}-` } },
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      const orderNo = `PO-${year}-${String(base + 1 + attempt).padStart(5, '0')}`;
      try {
        return await this.prisma.scoped.purchaseOrder.create({
          data: build(orderNo),
          include: { items: true },
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002' && attempt < 4) continue;
        throw err;
      }
    }
    throw new BadRequestException('Sipariş numarası üretilemedi');
  }

  private async requirePo(id: string) {
    const po = await this.prisma.scoped.purchaseOrder.findFirst({ where: { id, deletedAt: null } });
    if (!po) throw new NotFoundException('Sipariş bulunamadı');
    return po;
  }

  private async requireSupplier(id: string) {
    const s = await this.prisma.scoped.supplier.findFirst({ where: { id, deletedAt: null } });
    if (!s) throw new NotFoundException('Tedarikçi bulunamadı');
    return s;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
