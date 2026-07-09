import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

// S15-P3 — Lab abnormal threshold servisi. Yönetici tenant başına lab değer
// eşiklerini yönetir. Lab sonuç giriş ekranında auto flag (low/normal/high).

export const labThresholdUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  testCode: z.string().trim().min(1).max(60),
  sex: z.enum(['any', 'male', 'female']).default('any'),
  ageMin: z.number().int().min(0).max(120).optional().nullable(),
  ageMax: z.number().int().min(0).max(120).optional().nullable(),
  lowLimit: z.string().optional().nullable(),
  highLimit: z.string().optional().nullable(),
  unit: z.string().max(30).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  isActive: z.boolean().default(true),
});
export type LabThresholdUpsertInput = z.infer<typeof labThresholdUpsertSchema>;

@Injectable()
export class LabThresholdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list() {
    return this.prisma.scoped.labAbnormalThreshold.findMany({
      where: { deletedAt: null },
      orderBy: [{ testCode: 'asc' }, { sex: 'asc' }, { ageMin: 'asc' }],
    });
  }

  async upsert(input: LabThresholdUpsertInput) {
    const tenantId = this.tenantContext.requireTenantId();
    if (
      input.lowLimit !== null &&
      input.highLimit !== null &&
      input.lowLimit !== undefined &&
      input.highLimit !== undefined &&
      new Prisma.Decimal(input.lowLimit).gte(new Prisma.Decimal(input.highLimit))
    ) {
      throw new BadRequestException('lowLimit < highLimit olmalı');
    }
    const data = {
      tenantId,
      testCode: input.testCode,
      sex: input.sex,
      ageMin: input.ageMin ?? null,
      ageMax: input.ageMax ?? null,
      lowLimit: input.lowLimit ? new Prisma.Decimal(input.lowLimit) : null,
      highLimit: input.highLimit ? new Prisma.Decimal(input.highLimit) : null,
      unit: input.unit ?? null,
      notes: input.notes ?? null,
      isActive: input.isActive,
    };

    if (input.id) {
      const existing = await this.prisma.scoped.labAbnormalThreshold.findFirst({
        where: { id: input.id, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Eşik bulunamadı');
      return this.prisma.scoped.labAbnormalThreshold.update({
        where: { id: input.id },
        data,
      });
    }
    return this.prisma.scoped.labAbnormalThreshold.create({ data });
  }

  async softDelete(id: string) {
    const existing = await this.prisma.scoped.labAbnormalThreshold.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Eşik bulunamadı');
    return this.prisma.scoped.labAbnormalThreshold.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
