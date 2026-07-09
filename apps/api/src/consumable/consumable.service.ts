import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@airmed/db';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import {
  ConsumableAdjustInput,
  ConsumableCreateInput,
  ConsumableListQuery,
  ConsumableUpdateInput,
  ConsumableUsage,
} from './consumable.schemas';

// #372 — Consumable (genel sarf/ilaç) CRUD + stok düzeltme + tüketim düşümü.
// Eskiden model salt-okunur (admin-overview stok paneli) + seed'di; CRUD/UI yoktu
// ve prosedür/ameliyat tamamlanınca düşüm yapılmıyordu.
//
// Yetki: read tüm personel; write (create/update/softDelete/adjust) yönetici +
// yonetici_asistani (IolService.assertManager ile aynı kademe).

interface Actor {
  id: string;
  roles: readonly string[];
}

@Injectable()
export class ConsumableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list({ includeInactive, category, search }: ConsumableListQuery) {
    const where: Prisma.ConsumableWhereInput = {
      deletedAt: null,
      ...(includeInactive ? {} : { isActive: true }),
      ...(category ? { category } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { code: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    return this.prisma.scoped.consumable.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async create(input: ConsumableCreateInput, actor: Actor) {
    this.assertManager(actor);
    const tenantId = this.tenantContext.requireTenantId();
    try {
      return await this.prisma.scoped.consumable.create({
        data: {
          tenantId,
          name: input.name,
          code: input.code ?? null,
          category: input.category,
          unit: input.unit ?? null,
          availableQty: input.availableQty,
          reservedQty: 0,
          minQty: input.minQty,
        },
      });
    } catch (err) {
      this.rethrowUniqueAsConflict(err, 'Bu isimde bir sarf malzeme zaten var');
    }
  }

  async update(id: string, input: ConsumableUpdateInput, actor: Actor) {
    this.assertManager(actor);
    await this.requireConsumable(id);
    try {
      return await this.prisma.scoped.consumable.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.unit !== undefined ? { unit: input.unit } : {}),
          ...(input.minQty !== undefined ? { minQty: input.minQty } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
    } catch (err) {
      this.rethrowUniqueAsConflict(err, 'Bu isimde bir sarf malzeme zaten var');
    }
  }

  async softDelete(id: string, actor: Actor) {
    this.assertManager(actor);
    await this.requireConsumable(id);
    await this.prisma.scoped.consumable.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  // Manuel stok düzeltme (mal kabul / sayım / fire). delta +/-; sonuç < 0 olamaz.
  async adjust(input: ConsumableAdjustInput, actor: Actor) {
    this.assertManager(actor);
    const c = await this.requireConsumable(input.id);
    const next = c.availableQty + input.delta;
    if (next < 0) {
      throw new BadRequestException(
        `Stok negatife düşemez (mevcut ${c.availableQty}, delta ${input.delta})`,
      );
    }
    return this.prisma.scoped.consumable.update({
      where: { id: input.id },
      data: { availableQty: next },
    });
  }

  // #372 — Prosedür/ameliyat sonrası sarf düşümü. Best-effort: yetersiz stok
  // override edilir (negatife düşürmez, 0'da durur) ama uyarı fırlatmaz —
  // klinik akışı bloklamamak için (stok sayımı ayrı düzeltir). Bulunmayan/silinmiş
  // consumable sessizce atlanır. Toplu, idempotent değil (çağıran 1 kez çağırır).
  async consumeMany(usages: ConsumableUsage[]): Promise<void> {
    for (const u of usages) {
      const c = await this.prisma.scoped.consumable.findFirst({
        where: { id: u.consumableId, deletedAt: null },
        select: { id: true, availableQty: true },
      });
      if (!c) continue;
      const next = Math.max(0, c.availableQty - u.qty);
      await this.prisma.scoped.consumable.update({
        where: { id: c.id },
        data: { availableQty: next },
      });
    }
  }

  private async requireConsumable(id: string) {
    const c = await this.prisma.scoped.consumable.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw new NotFoundException('Sarf malzeme bulunamadı');
    return c;
  }

  private assertManager(actor: Actor): void {
    const allowed = actor.roles.some((r) => r === 'yonetici' || r === 'yonetici_asistani');
    if (!allowed) {
      throw new ForbiddenException('Sarf malzeme stoğunu yalnız yönetici/asistan yönetebilir');
    }
  }

  private rethrowUniqueAsConflict(err: unknown, message: string): never {
    const e = err as { code?: string };
    if (e?.code === 'P2002') throw new ConflictException(message);
    throw err as Error;
  }
}
