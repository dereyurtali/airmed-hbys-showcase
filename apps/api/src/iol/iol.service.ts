import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@airmed/db';
import { MessagingService } from '../messaging/messaging.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import {
  IolLotCreateInput,
  IolLotListQuery,
  IolLotUpdateInput,
  IolModelCreateInput,
  IolModelListQuery,
  IolModelUpdateInput,
  IolMovementCreateInput,
} from './iol.schemas';

// C1 IOL Inventory servisi.
//
// Yetki kuralı:
// - Read (list / findById): tüm klinik personeli
// - Write (create / update / softDelete / movement): yalnızca yonetici +
//   yonetici_asistani (klinik müdür kademesi)
// - `consume` movement'ı bu servisten dışarı çıkmıyor — B1 surgery entegrasyonu
//   sonraki PR'da consumeOnSurgery() method'unu ekleyecek.
//
// Stok mantığı: IolLot.quantity = sum(movements.quantity). Her movement create
// transactional olarak quantity'yi günceller; quantity < 0 olamaz (consume
// dahil edileceğinde de kontrol gerekir).

interface Actor {
  id: string;
  roles: readonly string[];
}

@Injectable()
export class IolService {
  private readonly logger = new Logger(IolService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly messaging: MessagingService,
  ) {}

  // -------------------- Models --------------------

  async listModels({ includeInactive, search }: IolModelListQuery) {
    const where: Prisma.IolModelWhereInput = {
      deletedAt: null,
      ...(includeInactive ? {} : { isActive: true }),
      ...(search
        ? {
            OR: [
              { brand: { contains: search, mode: 'insensitive' as const } },
              { model: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    return this.prisma.scoped.iolModel.findMany({
      where,
      orderBy: [{ brand: 'asc' }, { model: 'asc' }],
      include: {
        _count: { select: { lots: { where: { deletedAt: null } } } },
      },
    });
  }

  async findModelById(id: string) {
    const m = await this.prisma.scoped.iolModel.findFirst({
      where: { id, deletedAt: null },
    });
    if (!m) throw new NotFoundException('IOL model not found');
    return m;
  }

  async createModel(input: IolModelCreateInput, actor: Actor) {
    this.assertManager(actor);
    const tenantId = this.tenantContext.requireTenantId();
    try {
      return await this.prisma.scoped.iolModel.create({
        data: {
          tenantId,
          brand: input.brand.trim(),
          model: input.model.trim(),
          description: input.description ?? null,
          lensType: input.lensType,
          minQty: input.minQty,
        },
      });
    } catch (err) {
      this.rethrowUniqueAsConflict(err, 'A model with this brand+name already exists');
    }
  }

  async updateModel(id: string, input: IolModelUpdateInput, actor: Actor) {
    this.assertManager(actor);
    await this.findModelById(id);
    try {
      return await this.prisma.scoped.iolModel.update({
        where: { id },
        data: {
          ...(input.brand !== undefined ? { brand: input.brand.trim() } : {}),
          ...(input.model !== undefined ? { model: input.model.trim() } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.lensType !== undefined ? { lensType: input.lensType } : {}),
          ...(input.minQty !== undefined ? { minQty: input.minQty } : {}),
        },
      });
    } catch (err) {
      this.rethrowUniqueAsConflict(err, 'A model with this brand+name already exists');
    }
  }

  async softDeleteModel(id: string, actor: Actor) {
    this.assertManager(actor);
    const model = await this.findModelById(id);

    // Stoklu lot varsa silme reddet — önce lot'lar temizlenmeli.
    const activeLots = await this.prisma.scoped.iolLot.count({
      where: { modelId: model.id, deletedAt: null },
    });
    if (activeLots > 0) {
      throw new ConflictException('Cannot delete model with active lots; archive lots first');
    }

    await this.prisma.scoped.iolModel.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  // -------------------- Lots --------------------

  async listLots({
    modelId,
    expiringWithinDays,
    lowStockThreshold,
    includeEmpty,
  }: IolLotListQuery) {
    const where: Prisma.IolLotWhereInput = {
      deletedAt: null,
      ...(modelId ? { modelId } : {}),
      ...(expiringWithinDays
        ? { expiresAt: { lte: addDays(new Date(), expiringWithinDays) } }
        : {}),
      ...(lowStockThreshold !== undefined ? { quantity: { lte: lowStockThreshold } } : {}),
      ...(includeEmpty ? {} : { quantity: { gt: 0 } }),
    };
    return this.prisma.scoped.iolLot.findMany({
      where,
      orderBy: [{ expiresAt: 'asc' }],
      include: {
        model: { select: { id: true, brand: true, model: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  async findLotById(id: string) {
    const lot = await this.prisma.scoped.iolLot.findFirst({
      where: { id, deletedAt: null },
      include: {
        model: { select: { id: true, brand: true, model: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!lot) throw new NotFoundException('IOL lot not found');
    return lot;
  }

  async createLot(input: IolLotCreateInput, actor: Actor) {
    this.assertManager(actor);
    const tenantId = this.tenantContext.requireTenantId();
    await this.findModelById(input.modelId);

    // prisma.scoped is itself the per-request tenant tx (TenantInterceptor)
    // so sequential ops here share atomicity with the surrounding request.
    try {
      const lot = await this.prisma.scoped.iolLot.create({
        data: {
          tenantId,
          modelId: input.modelId,
          lotNumber: input.lotNumber.trim(),
          power: input.power,
          // PR21 — 3-state: yeni lotlar tamamen available olarak girer.
          quantity: input.initialQuantity,
          availableQty: input.initialQuantity,
          reservedQty: 0,
          consumedQty: 0,
          expiresAt: new Date(input.expiresAt),
          supplier: input.supplier ?? null,
          notes: input.notes ?? null,
          createdById: actor.id,
        },
      });

      if (input.initialQuantity > 0) {
        await this.prisma.scoped.iolStockMovement.create({
          data: {
            tenantId,
            lotId: lot.id,
            type: 'receive',
            quantity: input.initialQuantity,
            notes: 'Initial stock',
            createdById: actor.id,
          },
        });
      }
      // D1 entegrasyonu — LENS_ARRIVAL_NOTICE iç bildirim (stok personeline).
      // Best-effort; messaging düşse lot/movement transaction'ı bozulmaz.
      await this.fireLensArrivalNotice(tenantId, lot);
      return lot;
    } catch (err) {
      this.rethrowUniqueAsConflict(
        err,
        'A lot with this number + power already exists for this model',
      );
    }
  }

  private async fireLensArrivalNotice(
    tenantId: string,
    lot: { id: string; modelId: string; lotNumber: string; quantity: number },
  ): Promise<void> {
    const model = await this.prisma.scoped.iolModel.findFirst({
      where: { id: lot.modelId },
      select: { brand: true, model: true },
    });
    const lensModel = model ? `${model.brand} ${model.model}` : 'IOL';
    try {
      await this.messaging.fire({
        tenantId,
        key: 'LENS_ARRIVAL_NOTICE',
        recipient: 'internal:stock',
        context: {
          lensModel,
          quantity: lot.quantity,
          lotNumber: lot.lotNumber,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`LENS_ARRIVAL_NOTICE fire failed for lot ${lot.id}: ${msg}`);
    }
  }

  async updateLot(id: string, input: IolLotUpdateInput, actor: Actor) {
    this.assertManager(actor);
    await this.findLotById(id);
    try {
      return await this.prisma.scoped.iolLot.update({
        where: { id },
        data: {
          ...(input.lotNumber !== undefined ? { lotNumber: input.lotNumber.trim() } : {}),
          ...(input.power !== undefined ? { power: input.power } : {}),
          ...(input.expiresAt !== undefined ? { expiresAt: new Date(input.expiresAt) } : {}),
          ...(input.supplier !== undefined ? { supplier: input.supplier } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      });
    } catch (err) {
      this.rethrowUniqueAsConflict(
        err,
        'A lot with this number + power already exists for this model',
      );
    }
  }

  async softDeleteLot(id: string, actor: Actor) {
    this.assertManager(actor);
    const lot = await this.findLotById(id);
    if (lot.quantity > 0) {
      throw new ConflictException('Cannot archive lot with non-zero quantity');
    }
    await this.prisma.scoped.iolLot.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // -------------------- Movements --------------------

  async createMovement(input: IolMovementCreateInput, actor: Actor) {
    this.assertManager(actor);
    const tenantId = this.tenantContext.requireTenantId();
    const lot = await this.findLotById(input.lotId);

    // Movement.quantity convention:
    // - receive / return: positive (giriş)
    // - expire: negative (düşürme)
    // - adjust: serbest (+/-)
    const delta = this.normalizeMovementQuantity(input.type, input.quantity);
    const newQuantity = lot.quantity + delta;
    if (newQuantity < 0) {
      throw new BadRequestException(
        `Movement would result in negative stock (current ${lot.quantity}, delta ${delta})`,
      );
    }

    // Sequential within the per-request tenant tx (TenantInterceptor); same
    // atomicity as a nested $transaction would give.
    const mv = await this.prisma.scoped.iolStockMovement.create({
      data: {
        tenantId,
        lotId: lot.id,
        type: input.type,
        quantity: delta,
        notes: input.notes ?? null,
        createdById: actor.id,
      },
    });
    await this.prisma.scoped.iolLot.update({
      where: { id: lot.id },
      data: { quantity: newQuantity },
    });
    return mv;
  }

  // #1064 — lot hareket geçmişi zamanla sınırsız büyür; recentMovements
  // desenindeki gibi tavanlı (UI son hareketleri gösterir).
  async listMovements(lotId: string, limit = 200) {
    await this.findLotById(lotId);
    return this.prisma.scoped.iolStockMovement.findMany({
      where: { lotId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  // v0.4.1 (#691) — tenant-geneli son stok hareketleri (Mal Kabul / Stok
  // Hareketleri ekranı). Lot-bazlı listMovements'tan farkı: tüm lotlar, model +
  // lot bilgisiyle. RLS scoped → yalnız bu tenant.
  async recentMovements(limit = 100) {
    return this.prisma.scoped.iolStockMovement.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        createdBy: { select: { id: true, name: true } },
        lot: {
          select: {
            lotNumber: true,
            power: true,
            model: { select: { brand: true, model: true } },
          },
        },
      },
    });
  }

  // -------------------- helpers --------------------

  private assertManager(actor: Actor): void {
    const allowed = actor.roles.some((r) => r === 'yonetici' || r === 'yonetici_asistani');
    if (!allowed) {
      throw new ForbiddenException('Only yonetici or yonetici_asistani can manage IOL inventory');
    }
  }

  private normalizeMovementQuantity(type: string, raw: number): number {
    const abs = Math.abs(raw);
    if (type === 'receive' || type === 'return') return abs;
    if (type === 'expire') return -abs;
    // adjust: user'ın işareti korunur (raw zaten ±)
    return raw;
  }

  private rethrowUniqueAsConflict(err: unknown, message: string): never {
    const e = err as { code?: string };
    if (e?.code === 'P2002') {
      throw new ConflictException(message);
    }
    throw err as Error;
  }

  // S15-PR21 — 3-state lifecycle: reserve / release / consume.
  // Hepsi conditional UPDATE + version bump ile race-free. Movement audit
  // satırı her geçişte tutulur.

  async reserve(lotId: string, qty: number, actor: Actor): Promise<void> {
    if (qty <= 0) throw new BadRequestException('reserve qty > 0 olmalı');
    const lot = await this.prisma.scoped.iolLot.findFirst({
      where: { id: lotId, deletedAt: null },
      select: { availableQty: true, version: true, tenantId: true },
    });
    if (!lot) throw new NotFoundException('Lot bulunamadı');
    if (lot.availableQty < qty) {
      throw new BadRequestException(
        `Yetersiz stok: available=${lot.availableQty}, requested=${qty}`,
      );
    }
    const updated = await this.prisma.scoped.iolLot.updateMany({
      where: { id: lotId, version: lot.version, availableQty: { gte: qty } },
      data: {
        availableQty: { decrement: qty },
        reservedQty: { increment: qty },
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw new ConflictException('Stok rezervasyonu race: tekrar deneyin.');
    }
    await this.prisma.scoped.iolStockMovement.create({
      data: {
        tenantId: lot.tenantId,
        lotId,
        type: 'adjust',
        quantity: -qty,
        notes: 'Reserved (PR21)',
        createdById: actor.id,
      },
    });
  }

  async release(lotId: string, qty: number, actor: Actor): Promise<void> {
    if (qty <= 0) throw new BadRequestException('release qty > 0 olmalı');
    const lot = await this.prisma.scoped.iolLot.findFirst({
      where: { id: lotId, deletedAt: null },
      select: { reservedQty: true, version: true, tenantId: true },
    });
    if (!lot) throw new NotFoundException('Lot bulunamadı');
    if (lot.reservedQty < qty) {
      throw new BadRequestException(
        `Rezervasyon yetersiz: reserved=${lot.reservedQty}, requested=${qty}`,
      );
    }
    const updated = await this.prisma.scoped.iolLot.updateMany({
      where: { id: lotId, version: lot.version, reservedQty: { gte: qty } },
      data: {
        reservedQty: { decrement: qty },
        availableQty: { increment: qty },
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw new ConflictException('Stok release race: tekrar deneyin.');
    }
    await this.prisma.scoped.iolStockMovement.create({
      data: {
        tenantId: lot.tenantId,
        lotId,
        type: 'adjust',
        quantity: qty,
        notes: 'Released (PR21)',
        createdById: actor.id,
      },
    });
  }

  async consume(lotId: string, qty: number, surgeryId: string | null, actor: Actor): Promise<void> {
    if (qty <= 0) throw new BadRequestException('consume qty > 0 olmalı');
    const lot = await this.prisma.scoped.iolLot.findFirst({
      where: { id: lotId, deletedAt: null },
      select: { reservedQty: true, version: true, tenantId: true },
    });
    if (!lot) throw new NotFoundException('Lot bulunamadı');
    if (lot.reservedQty < qty) {
      throw new BadRequestException(
        `Rezerve stok yetersiz: reserved=${lot.reservedQty}, requested=${qty}`,
      );
    }
    const updated = await this.prisma.scoped.iolLot.updateMany({
      where: { id: lotId, version: lot.version, reservedQty: { gte: qty } },
      data: {
        reservedQty: { decrement: qty },
        consumedQty: { increment: qty },
        quantity: { decrement: qty },
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw new ConflictException('Stok consume race: tekrar deneyin.');
    }
    await this.prisma.scoped.iolStockMovement.create({
      data: {
        tenantId: lot.tenantId,
        lotId,
        type: 'consume',
        quantity: -qty,
        surgeryId,
        notes: `Consumed (PR21) surgery=${surgeryId ?? '-'}`,
        createdById: actor.id,
      },
    });
  }

  /**
   * Delta audit C-2 — Surgery'nin lens tüketimi 3-state lifecycle'a hizalanır.
   *
   * Modlar:
   * - `reservedFirst`: pre-op'ta rezerve edilmiş lens — `consume()` çağrılır.
   * - `availableNow`: pre-op rezervasyonu yok ama available stok var — atomic
   *   olarak available'dan consumed'e geçirilir (rezerve adımı pas geçilir).
   * - `override`: kasıtlı negatif stok (eski lot, off-stock vb.) — yalnız
   *   `consumedQty` + legacy `quantity` decrement. lensIsOverride=true akışı.
   *
   * Movement notes alanı moda göre etiketlenir; forecast servisi consumedQty
   * üzerinden raporlama yapar.
   */
  async consumeForSurgery(
    lotId: string,
    surgeryId: string,
    isOverride: boolean,
    actor: Actor,
    overrideReason?: string,
  ): Promise<void> {
    const lot = await this.prisma.scoped.iolLot.findFirst({
      where: { id: lotId, deletedAt: null },
      select: { availableQty: true, reservedQty: true, version: true, tenantId: true },
    });
    if (!lot) throw new NotFoundException('Lot bulunamadı');

    if (isOverride) {
      // Override: stok yetersizliğine bakılmaz; consumedQty + legacy quantity --
      // (audit gerekçe override notlarında). availableQty/reservedQty değişmez.
      const updated = await this.prisma.scoped.iolLot.updateMany({
        where: { id: lotId, version: lot.version },
        data: {
          consumedQty: { increment: 1 },
          quantity: { decrement: 1 },
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConflictException('Stok override race: tekrar deneyin.');
      }
      await this.prisma.scoped.iolStockMovement.create({
        data: {
          tenantId: lot.tenantId,
          lotId,
          type: 'consume',
          quantity: -1,
          surgeryId,
          notes: `Override surgery=${surgeryId}: ${overrideReason ?? '-'}`,
          createdById: actor.id,
        },
      });
      return;
    }

    if (lot.reservedQty >= 1) {
      // Pre-op rezerve edilmiş → reserved → consumed transition.
      await this.consume(lotId, 1, surgeryId, actor);
      return;
    }

    // Rezervasyon yok ama available stok var → available → consumed direct.
    if (lot.availableQty < 1) {
      throw new BadRequestException(
        'Lot stoğu yetersiz — pre-op rezervasyonu olmayan lens için available stok gerek (isOverride=true ile zorla geçilebilir)',
      );
    }
    const updated = await this.prisma.scoped.iolLot.updateMany({
      where: { id: lotId, version: lot.version, availableQty: { gte: 1 } },
      data: {
        availableQty: { decrement: 1 },
        consumedQty: { increment: 1 },
        quantity: { decrement: 1 },
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw new ConflictException('Stok consume race: tekrar deneyin.');
    }
    await this.prisma.scoped.iolStockMovement.create({
      data: {
        tenantId: lot.tenantId,
        lotId,
        type: 'consume',
        quantity: -1,
        surgeryId,
        notes: `Direct consume (no pre-op reservation) surgery=${surgeryId}`,
        createdById: actor.id,
      },
    });
  }
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}
