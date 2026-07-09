import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

// S15-PR25 — Surgical Kit availability tracker. Her kit için komponent listesi
// + IOL modelleri için lot bazında available toplam → kit bazında availability
// hesaplanır. Min available komponent = kit availability.
// #372 — CRUD (oluştur/düzenle/sil + komponent ekle/çıkar) eklendi; eskiden
// seed-only idi (oluştur/düzenle UI yoktu).

// Komponent: ya iolModelId (stok-takipli) ya da componentName (ad-hoc) — Zod refine.
const kitComponentInputSchema = z
  .object({
    iolModelId: z.string().uuid().optional().nullable(),
    componentName: z.string().trim().max(150).optional().nullable(),
    quantity: z.coerce.number().int().min(1).default(1),
    isRequired: z.boolean().default(true),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .refine((c) => !!c.iolModelId || !!c.componentName?.trim(), {
    message: 'Komponent için iolModelId veya componentName gerekli',
  });

export const surgicalKitCreateSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(150),
  surgeryType: z.string().trim().min(1).max(60),
  notes: z.string().trim().max(500).optional().nullable(),
  components: z.array(kitComponentInputSchema).default([]),
});

export const surgicalKitUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(150).optional(),
  surgeryType: z.string().trim().min(1).max(60).optional(),
  notes: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
  // Verilirse komponent listesi tümüyle değiştirilir (replace semantiği).
  components: z.array(kitComponentInputSchema).optional(),
});

export const surgicalKitIdSchema = z.object({ id: z.string().uuid() });

export type SurgicalKitCreateInput = z.infer<typeof surgicalKitCreateSchema>;
export type SurgicalKitUpdateInput = z.infer<typeof surgicalKitUpdateSchema>;

interface KitActor {
  id: string;
  roles: readonly string[];
}

export interface KitAvailability {
  kitId: string;
  code: string;
  name: string;
  surgeryType: string;
  components: Array<{
    componentName: string | null;
    iolModelName: string | null;
    iolModelId: string | null;
    requiredQty: number;
    // Delta audit C-19: null = ad-hoc komponent (stok takibi yok).
    availableAcrossLots: number | null;
    isRequired: boolean;
    isSatisfied: boolean; // available >= required
  }>;
  // Delta audit C-19: null = sınırsız (yalnız ad-hoc komponentli kit).
  kitsBuildable: number | null;
  isFullyAvailable: boolean;
}

@Injectable()
export class SurgicalKitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async listKits() {
    return this.prisma.scoped.surgicalKit.findMany({
      where: { deletedAt: null, isActive: true },
      include: {
        components: {
          include: { iolModel: { select: { id: true, brand: true, model: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getAvailability(): Promise<KitAvailability[]> {
    const kits = await this.prisma.scoped.surgicalKit.findMany({
      where: { deletedAt: null, isActive: true },
      include: {
        components: {
          include: { iolModel: { select: { id: true, brand: true, model: true } } },
        },
      },
    });

    // IOL modelleri için lot bazında available toplam
    const allIolModelIds = Array.from(
      new Set(
        kits.flatMap((k) => k.components.filter((c) => c.iolModelId).map((c) => c.iolModelId!)),
      ),
    );
    const lotAggByModel = new Map<string, number>();
    if (allIolModelIds.length > 0) {
      const lots = await this.prisma.scoped.iolLot.findMany({
        where: { modelId: { in: allIolModelIds }, deletedAt: null },
        select: { modelId: true, availableQty: true },
      });
      for (const lot of lots) {
        lotAggByModel.set(lot.modelId, (lotAggByModel.get(lot.modelId) ?? 0) + lot.availableQty);
      }
    }

    return kits.map((kit) => {
      const components = kit.components.map((c) => {
        const trackedAvailable = c.iolModelId ? (lotAggByModel.get(c.iolModelId) ?? 0) : null;
        const available = trackedAvailable ?? Number.POSITIVE_INFINITY;
        const isSatisfied = available >= c.quantity;
        return {
          componentName: c.componentName,
          iolModelName: c.iolModel ? `${c.iolModel.brand} ${c.iolModel.model}` : null,
          iolModelId: c.iolModelId,
          requiredQty: c.quantity,
          // Delta audit C-19: magic `-1` yerine null — ad-hoc komponent (iolModelId
          // null) için stok takip edilmiyor; client tarafı `null` görünce "—" basar.
          availableAcrossLots: trackedAvailable,
          isRequired: c.isRequired,
          isSatisfied,
        };
      });

      const iolReq = components.filter((c) => c.iolModelId && c.availableAcrossLots !== null);
      const buildable =
        iolReq.length === 0
          ? Number.POSITIVE_INFINITY
          : Math.min(
              ...iolReq.map((c) => Math.floor((c.availableAcrossLots ?? 0) / c.requiredQty)),
            );

      // Delta audit C-19: magic `9999` yerine null — sınırsız anlamına gelir
      // (yalnız ad-hoc bileşenli kit). Client null görünce "—" veya "∞" basar.
      const kitsBuildable = buildable === Number.POSITIVE_INFINITY ? null : Math.max(0, buildable);
      return {
        kitId: kit.id,
        code: kit.code,
        name: kit.name,
        surgeryType: kit.surgeryType,
        components,
        kitsBuildable,
        isFullyAvailable: components.filter((c) => c.isRequired).every((c) => c.isSatisfied),
      };
    });
  }

  // -------------------- #372 CRUD (yönetici/asistan) --------------------

  async createKit(input: SurgicalKitCreateInput, actor: KitActor) {
    this.assertManager(actor);
    const tenantId = this.tenantContext.requireTenantId();
    try {
      return await this.prisma.scoped.surgicalKit.create({
        data: {
          tenantId,
          code: input.code,
          name: input.name,
          surgeryType: input.surgeryType,
          notes: input.notes ?? null,
          components: { create: input.components.map((c) => this.componentData(tenantId, c)) },
        },
        include: { components: true },
      });
    } catch (err) {
      this.rethrowUniqueAsConflict(err, 'Bu kod ile bir kit zaten var');
    }
  }

  async updateKit(input: SurgicalKitUpdateInput, actor: KitActor) {
    this.assertManager(actor);
    const tenantId = this.tenantContext.requireTenantId();
    const kit = await this.prisma.scoped.surgicalKit.findFirst({
      where: { id: input.id, deletedAt: null },
      select: { id: true },
    });
    if (!kit) throw new NotFoundException('Kit bulunamadı');

    // Komponent listesi verildiyse replace (eskileri sil, yenileri ekle).
    if (input.components) {
      await this.prisma.scoped.surgicalKitComponent.deleteMany({ where: { kitId: input.id } });
    }
    try {
      return await this.prisma.scoped.surgicalKit.update({
        where: { id: input.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.surgeryType !== undefined ? { surgeryType: input.surgeryType } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.components
            ? {
                components: {
                  create: input.components.map((c) => this.componentData(tenantId, c)),
                },
              }
            : {}),
        },
        include: { components: true },
      });
    } catch (err) {
      this.rethrowUniqueAsConflict(err, 'Bu kod ile bir kit zaten var');
    }
  }

  async softDeleteKit(id: string, actor: KitActor) {
    this.assertManager(actor);
    const kit = await this.prisma.scoped.surgicalKit.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!kit) throw new NotFoundException('Kit bulunamadı');
    await this.prisma.scoped.surgicalKit.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  private componentData(
    tenantId: string,
    c: {
      iolModelId?: string | null;
      componentName?: string | null;
      quantity: number;
      isRequired: boolean;
      notes?: string | null;
    },
  ) {
    return {
      tenantId,
      iolModelId: c.iolModelId ?? null,
      componentName: c.componentName?.trim() || null,
      quantity: c.quantity,
      isRequired: c.isRequired,
      notes: c.notes ?? null,
    };
  }

  private assertManager(actor: KitActor): void {
    const allowed = actor.roles.some((r) => r === 'yonetici' || r === 'yonetici_asistani');
    if (!allowed) {
      throw new ForbiddenException('Cerrahi kitleri yalnız yönetici/asistan yönetebilir');
    }
  }

  private rethrowUniqueAsConflict(err: unknown, message: string): never {
    const e = err as { code?: string };
    if (e?.code === 'P2002') throw new ConflictException(message);
    throw err as Error;
  }
}
