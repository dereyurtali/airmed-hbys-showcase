import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@airmed/db';
import { IolService } from '../iol/iol.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import {
  ChecklistItemPatchInput,
  PreOpCreateInput,
  PreOpUpdateInput,
  PRE_OP_CHECKLIST_KEYS,
  PRE_OP_OPTIONAL_KEYS,
  type PreOpChecklistKey,
} from './pre-op.schemas';

// B3 Pre-op servisi.
//
// Yetki kuralı:
// - "yonetici" rolü: her zaman update + markReady + softDelete.
// - Diğer roller: cerrahi takım (cerrah Doctor profile sahibi `doctor.userId`,
//   yonetici_asistani, hemsire) PreOp'a yazabilir. Resepsiyon read-only.
// - PreOp düzenleme penceresi: surgery.performedAt set olunca 24sa
//   (Surgery servisindeki SAME_DAY_WINDOW_MS pattern'ı ile aynı). Planlama
//   aşamasında (performedAt null) serbest düzenleme.
//
// markReady gate (acceptance criteria):
//   - vitalSigns boş olamaz (en az 1 alan girilmiş olmalı)
//   - dilatationAt set olmalı
//   - lensIolLotId set ise: lot mevcut + stoklu olmalı (quantity > 0)
//   - default checklist key'lerinin TÜMÜ (PRE_OP_OPTIONAL_KEYS hariç) completed
//   - lens reserved ise "lens_reserved" otomatik completed sayılır

interface Actor {
  id: string;
  roles: readonly string[];
}

interface ChecklistItem {
  key: string;
  completed: boolean;
  completedById?: string | null;
  completedAt?: string | null;
  notes?: string | null;
}

interface VitalSignsDto {
  bloodSugar?: number;
  systolic?: number;
  diastolic?: number;
  pulse?: number;
  weightKg?: number;
  temperatureC?: number;
  oxygenSaturation?: number;
}

// Flat DTO to keep tRPC inference shallow.
export interface PreOpDto {
  id: string;
  surgeryId: string;
  tenantId: string;
  vitalSigns: VitalSignsDto;
  dilatationAt: Date | null;
  anesthesiaNotes: string | null;
  lensIolLotId: string | null;
  lensReservedAt: Date | null;
  readyForSurgery: boolean;
  readyAt: Date | null;
  readyById: string | null;
  checklistItems: ChecklistItem[];
  createdAt: Date;
  updatedAt: Date;
  lensIolLot: {
    id: string;
    lotNumber: string;
    power: string;
    quantity: number;
    expiresAt: Date;
    model: { id: string; brand: string; model: string };
  } | null;
  readyBy: { id: string; name: string } | null;
}

const SAME_DAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const PRE_OP_WRITE_ROLES = ['yonetici', 'yonetici_asistani', 'doktor', 'hemsire'] as const;

@Injectable()
export class PreOpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly iol: IolService,
  ) {}

  async create(input: PreOpCreateInput, actor: Actor): Promise<PreOpDto> {
    this.assertWriteRole(actor);
    const tenantId = this.tenantContext.requireTenantId();
    const surgery = await this.requireSurgery(input.surgeryId);
    this.assertEditWindow(surgery.performedAt);

    const existing = await this.prisma.scoped.preOp.findUnique({
      where: { surgeryId: input.surgeryId },
    });
    if (existing) {
      throw new ConflictException('Pre-op already exists for this surgery');
    }

    const checklistItems: ChecklistItem[] = PRE_OP_CHECKLIST_KEYS.map((key) => ({
      key,
      completed: false,
      completedById: null,
      completedAt: null,
      notes: null,
    }));

    const row = await this.prisma.scoped.preOp.create({
      data: {
        tenantId,
        surgeryId: input.surgeryId,
        checklistItems: checklistItems as unknown as Prisma.InputJsonValue,
      },
      include: this.defaultInclude(),
    });
    return this.toDto(row);
  }

  async findBySurgeryId(surgeryId: string): Promise<PreOpDto> {
    const preOp = await this.prisma.scoped.preOp.findFirst({
      where: { surgeryId, deletedAt: null },
      include: this.defaultInclude(),
    });
    if (!preOp) throw new NotFoundException('Pre-op not found');
    return this.toDto(preOp);
  }

  async getOrNull(surgeryId: string): Promise<PreOpDto | null> {
    const row = await this.prisma.scoped.preOp.findFirst({
      where: { surgeryId, deletedAt: null },
      include: this.defaultInclude(),
    });
    return row ? this.toDto(row) : null;
  }

  async update(surgeryId: string, input: PreOpUpdateInput, actor: Actor): Promise<PreOpDto> {
    this.assertWriteRole(actor);
    const current = await this.findBySurgeryId(surgeryId);
    const surgery = await this.requireSurgery(surgeryId);
    this.assertEditWindow(surgery.performedAt);
    if (current.readyForSurgery) {
      throw new BadRequestException('Cannot edit pre-op after it is marked ready');
    }

    const data: Prisma.PreOpUpdateInput = {};
    if (input.vitalSigns !== undefined) {
      data.vitalSigns = input.vitalSigns as Prisma.InputJsonValue;
    }
    if (input.dilatationAt !== undefined) {
      data.dilatationAt = input.dilatationAt ? new Date(input.dilatationAt) : null;
    }
    if (input.anesthesiaNotes !== undefined) {
      data.anesthesiaNotes = input.anesthesiaNotes;
    }
    // #364 — Lens seçimi 3-state stoğu çalıştırır: seçilen lot reserve edilir
    // (available→reserved), değiştirilince/temizlenince önceki rezervasyon
    // release edilir. reserve() DB connect'ten ÖNCE çağrılır → yetersiz stokta
    // tüm işlem (request-tx) geri alınır, yarım connect kalmaz.
    let releaseLotId: string | null = null;
    if (input.lensIolLotId !== undefined && input.lensIolLotId !== current.lensIolLotId) {
      if (input.lensIolLotId === null) {
        data.lensIolLot = { disconnect: true };
        data.lensReservedAt = null;
      } else {
        const lot = await this.requireStockedLot(input.lensIolLotId);
        await this.iol.reserve(lot.id, 1, actor);
        data.lensIolLot = { connect: { id: lot.id } };
        data.lensReservedAt = new Date();
      }
      releaseLotId = current.lensIolLotId;
    }
    if (releaseLotId) await this.releaseIfReserved(releaseLotId, actor);

    const row = await this.prisma.scoped.preOp.update({
      where: { id: current.id },
      data,
      include: this.defaultInclude(),
    });
    return this.toDto(row);
  }

  async patchChecklistItem(input: ChecklistItemPatchInput, actor: Actor): Promise<PreOpDto> {
    this.assertWriteRole(actor);
    const current = await this.findBySurgeryId(input.surgeryId);
    const surgery = await this.requireSurgery(input.surgeryId);
    this.assertEditWindow(surgery.performedAt);
    if (current.readyForSurgery) {
      throw new BadRequestException('Cannot edit pre-op after it is marked ready');
    }

    const items = [...current.checklistItems];
    const idx = items.findIndex((it) => it.key === input.key);
    const nowIso = new Date().toISOString();
    const patched: ChecklistItem = {
      key: input.key,
      completed: input.completed,
      completedById: input.completed ? actor.id : null,
      completedAt: input.completed ? nowIso : null,
      notes: input.notes ?? null,
    };
    if (idx === -1) {
      items.push(patched);
    } else {
      items[idx] = patched;
    }

    const row = await this.prisma.scoped.preOp.update({
      where: { id: current.id },
      data: { checklistItems: items as unknown as Prisma.InputJsonValue },
      include: this.defaultInclude(),
    });
    return this.toDto(row);
  }

  async markReady(surgeryId: string, actor: Actor): Promise<PreOpDto> {
    this.assertWriteRole(actor);
    const current = await this.findBySurgeryId(surgeryId);
    const surgery = await this.requireSurgery(surgeryId);
    this.assertEditWindow(surgery.performedAt);
    if (current.readyForSurgery) {
      return current;
    }

    this.assertReadyGate(current);

    const row = await this.prisma.scoped.preOp.update({
      where: { id: current.id },
      data: {
        readyForSurgery: true,
        readyAt: new Date(),
        readyBy: { connect: { id: actor.id } },
      },
      include: this.defaultInclude(),
    });
    return this.toDto(row);
  }

  async unmarkReady(surgeryId: string, actor: Actor): Promise<PreOpDto> {
    this.assertWriteRole(actor);
    const isAdmin = actor.roles.includes('yonetici');
    if (!isAdmin) {
      throw new ForbiddenException('Only yonetici can revert ready status');
    }
    const current = await this.findBySurgeryId(surgeryId);
    if (!current.readyForSurgery) return current;

    const row = await this.prisma.scoped.preOp.update({
      where: { id: current.id },
      data: {
        readyForSurgery: false,
        readyAt: null,
        readyBy: { disconnect: true },
      },
      include: this.defaultInclude(),
    });
    return this.toDto(row);
  }

  async softDelete(surgeryId: string, actor: Actor) {
    const isAdmin = actor.roles.includes('yonetici');
    if (!isAdmin) {
      throw new ForbiddenException('Only yonetici can delete pre-op');
    }
    const current = await this.findBySurgeryId(surgeryId);
    // #364 — Pre-op silinince ayrılmış (tüketilmemiş) lens rezervasyonu geri ver.
    if (current.lensIolLotId) await this.releaseIfReserved(current.lensIolLotId, actor);
    await this.prisma.scoped.preOp.update({
      where: { id: current.id },
      data: { deletedAt: new Date() },
    });
  }

  // #364 — Lensin rezervasyonunu yalnız gerçekten rezerve ise serbest bırak.
  // Legacy pre-op'larda (reserve() öncesi) reservedQty 0 olabilir → IolService
  // BadRequest atmasın diye önce kontrol et.
  private async releaseIfReserved(lotId: string, actor: Actor): Promise<void> {
    const lot = await this.prisma.scoped.iolLot.findFirst({
      where: { id: lotId, deletedAt: null },
      select: { reservedQty: true },
    });
    if (lot && lot.reservedQty >= 1) {
      await this.iol.release(lotId, 1, actor);
    }
  }

  private assertReadyGate(current: PreOpDto): void {
    const vitals = current.vitalSigns as Record<string, unknown>;
    const vitalCount = Object.values(vitals).filter((v) => v !== null && v !== undefined).length;
    if (vitalCount === 0) {
      throw new BadRequestException('Vital signs missing — record at least one value');
    }
    if (!current.dilatationAt) {
      throw new BadRequestException('Dilatation time not recorded');
    }

    const byKey = new Map(current.checklistItems.map((it) => [it.key, it]));
    const lensReserved = !!current.lensIolLotId;

    for (const required of PRE_OP_CHECKLIST_KEYS) {
      // lens_reserved is conditionally required: only when a lens lot is reserved.
      // PRE_OP_OPTIONAL_KEYS skips items that are never blocking on their own.
      if (required === 'lens_reserved') {
        if (!lensReserved) continue;
      } else if (PRE_OP_OPTIONAL_KEYS.includes(required as PreOpChecklistKey)) {
        continue;
      }
      const item = byKey.get(required);
      if (!item || !item.completed) {
        throw new BadRequestException(`Checklist item not completed: ${required}`);
      }
    }
  }

  private async requireSurgery(surgeryId: string) {
    const surgery = await this.prisma.scoped.surgery.findFirst({
      where: { id: surgeryId, deletedAt: null },
    });
    if (!surgery) throw new NotFoundException('Surgery not found');
    return surgery;
  }

  private async requireStockedLot(lotId: string) {
    const lot = await this.prisma.scoped.iolLot.findFirst({
      where: { id: lotId, deletedAt: null },
    });
    if (!lot) throw new NotFoundException('IOL lot not found');
    if (lot.quantity <= 0) {
      throw new BadRequestException('Selected IOL lot is out of stock');
    }
    return lot;
  }

  private assertWriteRole(actor: Actor): void {
    const allowed = actor.roles.some((r) => PRE_OP_WRITE_ROLES.includes(r as 'yonetici'));
    if (!allowed) {
      throw new ForbiddenException('Role not allowed to modify pre-op');
    }
  }

  private assertEditWindow(performedAt: Date | null): void {
    if (!performedAt) return;
    const age = Date.now() - new Date(performedAt).getTime();
    if (age > SAME_DAY_WINDOW_MS) {
      throw new BadRequestException('Same-day edit window expired');
    }
  }

  private toDto(row: {
    id: string;
    tenantId: string;
    surgeryId: string;
    vitalSigns: Prisma.JsonValue;
    dilatationAt: Date | null;
    anesthesiaNotes: string | null;
    lensIolLotId: string | null;
    lensReservedAt: Date | null;
    readyForSurgery: boolean;
    readyAt: Date | null;
    readyById: string | null;
    checklistItems: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
    lensIolLot?: {
      id: string;
      lotNumber: string;
      power: Prisma.Decimal;
      quantity: number;
      expiresAt: Date;
      model: { id: string; brand: string; model: string };
    } | null;
    readyBy?: { id: string; name: string } | null;
  }): PreOpDto {
    const v = (row.vitalSigns ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      tenantId: row.tenantId,
      surgeryId: row.surgeryId,
      vitalSigns: v as VitalSignsDto,
      dilatationAt: row.dilatationAt,
      anesthesiaNotes: row.anesthesiaNotes,
      lensIolLotId: row.lensIolLotId,
      lensReservedAt: row.lensReservedAt,
      readyForSurgery: row.readyForSurgery,
      readyAt: row.readyAt,
      readyById: row.readyById,
      checklistItems: this.parseChecklist(row.checklistItems),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lensIolLot: row.lensIolLot
        ? {
            id: row.lensIolLot.id,
            lotNumber: row.lensIolLot.lotNumber,
            power: row.lensIolLot.power.toString(),
            quantity: row.lensIolLot.quantity,
            expiresAt: row.lensIolLot.expiresAt,
            model: row.lensIolLot.model,
          }
        : null,
      readyBy: row.readyBy ?? null,
    };
  }

  private parseChecklist(raw: Prisma.JsonValue): ChecklistItem[] {
    if (!Array.isArray(raw)) return [];
    const out: ChecklistItem[] = [];
    for (const it of raw) {
      if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
      const candidate = it as Record<string, unknown>;
      if (typeof candidate.key !== 'string' || typeof candidate.completed !== 'boolean') continue;
      out.push({
        key: candidate.key,
        completed: candidate.completed,
        completedById: typeof candidate.completedById === 'string' ? candidate.completedById : null,
        completedAt: typeof candidate.completedAt === 'string' ? candidate.completedAt : null,
        notes: typeof candidate.notes === 'string' ? candidate.notes : null,
      });
    }
    return out;
  }

  private defaultInclude() {
    return PRE_OP_INCLUDE;
  }
}

const PRE_OP_INCLUDE = {
  lensIolLot: {
    select: {
      id: true,
      lotNumber: true,
      power: true,
      quantity: true,
      expiresAt: true,
      model: { select: { id: true, brand: true, model: true } },
    },
  },
  readyBy: { select: { id: true, name: true } },
} satisfies Prisma.PreOpInclude;
