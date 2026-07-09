import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import type {
  ServiceItemCreateInput,
  ServiceItemListQuery,
  ServiceItemUpdateInput,
} from './billing.schemas';

// S11b — Hizmet kataloğu CRUD.
// Yetki: yalnız yönetici (permission gate router'da).
// Bu service yalnız iş kuralları (uniqueness, decimal validation) tutar.

interface Actor {
  id: string;
}

@Injectable()
export class ServiceItemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(input: ServiceItemListQuery) {
    return this.prisma.scoped.serviceItem.findMany({
      where: {
        deletedAt: null,
        ...(input.category ? { category: input.category } : {}),
        ...(input.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findById(id: string) {
    const item = await this.prisma.scoped.serviceItem.findFirst({
      where: { id, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Service item not found');
    return item;
  }

  async create(input: ServiceItemCreateInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    this.validatePrice(input.defaultPrice);
    this.validatePreconditions(input.preconditions);
    try {
      return await this.prisma.scoped.serviceItem.create({
        data: {
          tenantId,
          code: input.code,
          name: input.name,
          nameRu: input.nameRu ?? null,
          nameTg: input.nameTg ?? null,
          category: input.category,
          defaultPrice: new Prisma.Decimal(input.defaultPrice),
          defaultCurrency: input.defaultCurrency,
          sortOrder: input.sortOrder,
          preconditions: (input.preconditions ?? {}) as Prisma.InputJsonValue,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
          createdById: actor.id,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Service item code '${input.code}' already exists`);
      }
      throw err;
    }
  }

  async update(id: string, input: ServiceItemUpdateInput) {
    await this.findById(id); // varlık + tenant scope kontrol
    if (input.defaultPrice) this.validatePrice(input.defaultPrice);
    if (input.preconditions !== undefined) this.validatePreconditions(input.preconditions);
    try {
      return await this.prisma.scoped.serviceItem.update({
        where: { id },
        data: {
          ...(input.code !== undefined && { code: input.code }),
          ...(input.name !== undefined && { name: input.name }),
          ...(input.nameRu !== undefined && { nameRu: input.nameRu }),
          ...(input.nameTg !== undefined && { nameTg: input.nameTg }),
          ...(input.category !== undefined && { category: input.category }),
          ...(input.defaultPrice !== undefined && {
            defaultPrice: new Prisma.Decimal(input.defaultPrice),
          }),
          ...(input.defaultCurrency !== undefined && { defaultCurrency: input.defaultCurrency }),
          ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
          ...(input.preconditions !== undefined && {
            preconditions: (input.preconditions ?? {}) as Prisma.InputJsonValue,
          }),
          ...(input.metadata !== undefined && {
            metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
          }),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Service item code '${input.code}' already exists`);
      }
      throw err;
    }
  }

  async softDelete(id: string) {
    await this.findById(id);
    await this.prisma.scoped.serviceItem.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  private validatePrice(price: string): void {
    const decimal = new Prisma.Decimal(price);
    if (decimal.lt(0)) {
      throw new BadRequestException('defaultPrice cannot be negative');
    }
    if (decimal.gt(new Prisma.Decimal('99999999.99'))) {
      throw new BadRequestException('defaultPrice exceeds Decimal(10,2) range');
    }
  }

  // Madde 5 — ön şartların kendi içinde tutarlı olmasını sağlar (minAge ≤ maxAge,
  // ageDiscount.minAge ≥ minAge gibi). Zod tipi zaten range/regex tuttu;
  // burada cross-field tutarlılık.
  private validatePreconditions(p: ServiceItemCreateInput['preconditions']): void {
    if (!p) return;
    if (p.minAge != null && p.maxAge != null && p.minAge > p.maxAge) {
      throw new BadRequestException('preconditions.minAge cannot exceed maxAge');
    }
    if (p.requiredServiceCodes && p.requiredServiceCodes.length > 0) {
      const dup = p.requiredServiceCodes.filter(
        (code, idx) => p.requiredServiceCodes!.indexOf(code) !== idx,
      );
      if (dup.length > 0) {
        throw new BadRequestException(
          `preconditions.requiredServiceCodes duplicated: ${dup.join(', ')}`,
        );
      }
    }
  }
}
