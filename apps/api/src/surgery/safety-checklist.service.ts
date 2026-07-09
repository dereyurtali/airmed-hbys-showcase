import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import {
  emptyItemState,
  isPhaseRequiredComplete,
  itemMapKey,
  SAFETY_CHECKLIST_ITEMS,
  SAFETY_CHECKLIST_PHASES,
  type SafetyChecklistItem,
  type SafetyItemState,
} from './safety-checklist.constants';

export const safetyConfirmItemSchema = z.object({
  surgeryId: z.string().uuid(),
  itemKey: z.string().min(1).max(100),
  confirmed: z.boolean(),
  notes: z.string().max(500).optional().nullable(),
});

export const safetyMarkPhaseSchema = z.object({
  surgeryId: z.string().uuid(),
  phase: z.enum(['sign_in', 'time_out', 'sign_out']),
});

export type SafetyConfirmItemInput = z.infer<typeof safetyConfirmItemSchema>;
export type SafetyMarkPhaseInput = z.infer<typeof safetyMarkPhaseSchema>;

export interface ChecklistResponse {
  id: string;
  surgeryId: string;
  items: Record<string, SafetyItemState>;
  phaseStatus: {
    sign_in: { complete: boolean; completedAt: string | null; completedBy: string | null };
    time_out: { complete: boolean; completedAt: string | null; completedBy: string | null };
    sign_out: { complete: boolean; completedAt: string | null; completedBy: string | null };
  };
  fullyComplete: boolean;
}

const VALID_ITEM_KEYS = new Set(SAFETY_CHECKLIST_ITEMS.map(itemMapKey));

@Injectable()
export class SafetyChecklistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Surgery için checklist'i getir; yoksa boş items ile oluştur. Race-safe:
   * Prisma upsert ile concurrent create durumunda tek satır kalır
   * (unique surgery_id).
   */
  async getOrCreate(surgeryId: string): Promise<ChecklistResponse> {
    const tenantId = this.tenantContext.requireTenantId();
    const surgery = await this.prisma.scoped.surgery.findFirst({
      where: { id: surgeryId, deletedAt: null },
      select: { id: true },
    });
    if (!surgery) throw new NotFoundException('Ameliyat bulunamadı');

    const existing = await this.prisma.scoped.surgicalSafetyCheck.upsert({
      where: { surgeryId },
      create: { tenantId, surgeryId, items: {} },
      update: {},
    });
    return this.toResponse(existing);
  }

  async confirmItem(input: SafetyConfirmItemInput, actorId: string): Promise<ChecklistResponse> {
    if (!VALID_ITEM_KEYS.has(input.itemKey)) {
      throw new BadRequestException(`Geçersiz checklist item: ${input.itemKey}`);
    }
    const tenantId = this.tenantContext.requireTenantId();
    const current = await this.prisma.scoped.surgicalSafetyCheck.upsert({
      where: { surgeryId: input.surgeryId },
      create: { tenantId, surgeryId: input.surgeryId, items: {} },
      update: {},
    });

    const items = this.coerceItems(current.items);
    items[input.itemKey] = {
      confirmed: input.confirmed,
      confirmedBy: input.confirmed ? actorId : null,
      confirmedAt: input.confirmed ? new Date().toISOString() : null,
      notes: input.notes ?? null,
    };

    const updated = await this.prisma.scoped.surgicalSafetyCheck.update({
      where: { id: current.id },
      data: { items: items as object },
    });
    return this.toResponse(updated);
  }

  /**
   * Phase complete işaretle. Tüm zorunlu item'lar dolu değilse 400 atar.
   * Idempotent: zaten complete olan phase'i tekrar mark etmek timestamp'i
   * yeniler (override).
   */
  async markPhaseComplete(
    input: SafetyMarkPhaseInput,
    actorId: string,
  ): Promise<ChecklistResponse> {
    const tenantId = this.tenantContext.requireTenantId();
    const current = await this.prisma.scoped.surgicalSafetyCheck.upsert({
      where: { surgeryId: input.surgeryId },
      create: { tenantId, surgeryId: input.surgeryId, items: {} },
      update: {},
    });
    const items = this.coerceItems(current.items);
    if (!isPhaseRequiredComplete(input.phase, items)) {
      throw new BadRequestException(`Phase '${input.phase}' tamamlanamaz: zorunlu item'lar eksik`);
    }
    const now = new Date();
    const data: Record<string, unknown> = {};
    if (input.phase === 'sign_in') {
      data.signInCompletedAt = now;
      data.signInCompletedBy = actorId;
    } else if (input.phase === 'time_out') {
      data.timeOutCompletedAt = now;
      data.timeOutCompletedBy = actorId;
    } else {
      data.signOutCompletedAt = now;
      data.signOutCompletedBy = actorId;
    }
    const updated = await this.prisma.scoped.surgicalSafetyCheck.update({
      where: { id: current.id },
      data,
    });
    return this.toResponse(updated);
  }

  /** Surgery için intra-op başlatılabilir mi (PR9 SurgeryDay kapı kuralı)? */
  async canStartIntraOp(surgeryId: string): Promise<boolean> {
    const check = await this.prisma.scoped.surgicalSafetyCheck.findUnique({
      where: { surgeryId },
    });
    if (!check) return false;
    return check.signInCompletedAt !== null && check.timeOutCompletedAt !== null;
  }

  private coerceItems(raw: unknown): Record<string, SafetyItemState> {
    if (!raw || typeof raw !== 'object') return {};
    const result: Record<string, SafetyItemState> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!VALID_ITEM_KEYS.has(k)) continue;
      if (!v || typeof v !== 'object') {
        result[k] = emptyItemState();
        continue;
      }
      const obj = v as Partial<SafetyItemState>;
      result[k] = {
        confirmed: obj.confirmed === true,
        confirmedBy: typeof obj.confirmedBy === 'string' ? obj.confirmedBy : null,
        confirmedAt: typeof obj.confirmedAt === 'string' ? obj.confirmedAt : null,
        notes: typeof obj.notes === 'string' ? obj.notes : null,
      };
    }
    return result;
  }

  private toResponse(row: {
    id: string;
    surgeryId: string;
    items: unknown;
    signInCompletedAt: Date | null;
    signInCompletedBy: string | null;
    timeOutCompletedAt: Date | null;
    timeOutCompletedBy: string | null;
    signOutCompletedAt: Date | null;
    signOutCompletedBy: string | null;
  }): ChecklistResponse {
    const items = this.coerceItems(row.items);
    const phaseStatus = Object.fromEntries(
      SAFETY_CHECKLIST_PHASES.map((phase) => {
        const completedAt =
          phase === 'sign_in'
            ? row.signInCompletedAt
            : phase === 'time_out'
              ? row.timeOutCompletedAt
              : row.signOutCompletedAt;
        const completedBy =
          phase === 'sign_in'
            ? row.signInCompletedBy
            : phase === 'time_out'
              ? row.timeOutCompletedBy
              : row.signOutCompletedBy;
        return [
          phase,
          {
            complete: completedAt !== null,
            completedAt: completedAt ? completedAt.toISOString() : null,
            completedBy: completedBy,
          },
        ];
      }),
    ) as ChecklistResponse['phaseStatus'];

    return {
      id: row.id,
      surgeryId: row.surgeryId,
      items,
      phaseStatus,
      fullyComplete:
        phaseStatus.sign_in.complete &&
        phaseStatus.time_out.complete &&
        phaseStatus.sign_out.complete,
    };
  }

  // Test/UI tarafı için item kataloğunu döner; dinamik ekleme/silme yok.
  getCatalog(): readonly SafetyChecklistItem[] {
    return SAFETY_CHECKLIST_ITEMS;
  }
}
