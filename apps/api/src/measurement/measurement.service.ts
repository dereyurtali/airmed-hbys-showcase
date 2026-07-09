import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@airmed/db';
import { CommissionService } from '../commission/commission.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import {
  MeasurementCreateInput,
  MeasurementListQuery,
  MeasurementUpdateInput,
} from './measurement.schemas';

// A9 ölçüm servisi.
//
// Yetki kuralı (update/softDelete) — A7 ile aynı kontrat:
// - "yonetici" rolü: her zaman düzenler
// - Diğer roller: yalnızca aynı gün (24 saatlik pencere) ve yalnızca kendi
//   ölçümünü düzenler
// - measuredById nullable; null ise (sistem/import) sadece yonetici değişir
// - Soft-delete: aynı kural
//
// measuredBy User'a referans (Measurement.measuredById → User.id). Hemşire de
// ölçüm girebilir; sahiplik measuredById ile takip edilir.

interface Actor {
  id: string;
  roles: readonly string[];
}

const SAME_DAY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 saat

@Injectable()
export class MeasurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    // S12b — müşteri görüşmesi sonrası: ölçüm başına otomatik hakediş
    private readonly commission: CommissionService,
  ) {}

  // #1063 — `opts.measurementOrderId` yalnız iç çağrı (fulfill) için: kayıt
  // create'te bağlanır, eskiden gereken ikinci UPDATE kalktı. Zod şemasına
  // bilerek EKLENMEDİ (client kendi order bağını dayatamaz).
  async create(
    input: MeasurementCreateInput,
    actor: Actor,
    opts?: { measurementOrderId?: string },
  ) {
    const tenantId = this.tenantContext.requireTenantId();
    await this.assertPatient(input.patientId);

    const created = await this.prisma.scoped.measurement.create({
      data: {
        tenantId,
        patientId: input.patientId,
        type: input.type,
        eyeSide: input.eyeSide,
        measuredAt: new Date(input.measuredAt),
        measuredById: actor.id,
        values: (input.values ?? {}) as Prisma.InputJsonValue,
        notes: input.notes ?? null,
        ...(opts?.measurementOrderId ? { measurementOrderId: opts.measurementOrderId } : {}),
      },
    });

    // S12b — Hakediş eşleme: actor doktor profilinde varsa hesaplanır.
    // Delta audit C-9: patient primary doctor fallback'i kaldırıldı; yanlış
    // hakediş üretiyordu (ölçümü resepsiyon/hemşire giriyor olabilir, başka
    // doktorun hesabına hakediş yazılması yanlıştır).
    const doctorProfile = await this.findDoctorForCommission(actor.id);
    if (doctorProfile) {
      const baseAmount = await this.lookupMeasurementBaseAmount();
      await this.commission.tryAutoCalculate({
        sourceType: 'measurement',
        sourceId: created.id,
        doctorId: doctorProfile.id,
        baseAmount,
      });
    }

    return created;
  }

  private async findDoctorForCommission(actorUserId: string): Promise<{ id: string } | null> {
    const ownDoctor = await this.prisma.scoped.doctor.findFirst({
      where: { userId: actorUserId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    return ownDoctor ?? null;
  }

  private async lookupMeasurementBaseAmount(): Promise<string> {
    const item = await this.prisma.scoped.serviceItem.findFirst({
      where: { category: 'measurement', isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { defaultPrice: 'desc' }],
      select: { defaultPrice: true },
    });
    return item?.defaultPrice.toString() ?? '0';
  }

  async list({ patientId, type, dateFrom, dateTo, page, pageSize }: MeasurementListQuery) {
    const where: Prisma.MeasurementWhereInput = {
      deletedAt: null,
      ...(patientId ? { patientId } : {}),
      ...(type ? { type } : {}),
      ...(dateFrom || dateTo
        ? {
            measuredAt: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lt: new Date(dateTo) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.scoped.measurement.findMany({
        where,
        orderBy: { measuredAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scoped.measurement.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  // Hasta tarihçesi: tüm tipler tek sorguda; frontend tip-bazlı gruplar.
  async listByPatient(patientId: string) {
    return this.prisma.scoped.measurement.findMany({
      where: { patientId, deletedAt: null },
      orderBy: { measuredAt: 'desc' },
      include: {
        measuredBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async findById(id: string) {
    const m = await this.prisma.scoped.measurement.findFirst({
      where: { id, deletedAt: null },
      include: {
        patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
        measuredBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!m) throw new NotFoundException('Measurement not found');
    return m;
  }

  async update(id: string, input: MeasurementUpdateInput, actor: Actor) {
    const current = await this.findById(id);
    this.assertEditAllowed(current.measuredAt, current.measuredById, actor);

    const data: Prisma.MeasurementUpdateInput = {};
    if (input.eyeSide !== undefined) data.eyeSide = input.eyeSide;
    if (input.measuredAt !== undefined) data.measuredAt = new Date(input.measuredAt);
    if (input.values !== undefined) data.values = input.values as Prisma.InputJsonValue;
    if (input.notes !== undefined) data.notes = input.notes;

    return this.prisma.scoped.measurement.update({ where: { id }, data });
  }

  async softDelete(id: string, actor: Actor) {
    const current = await this.findById(id);
    this.assertEditAllowed(current.measuredAt, current.measuredById, actor);
    await this.prisma.scoped.measurement.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private assertEditAllowed(measuredAt: Date, ownerUserId: string | null, actor: Actor): void {
    const isAdmin = actor.roles.includes('yonetici');
    if (isAdmin) return;

    if (ownerUserId === null) {
      throw new ForbiddenException('Only yonetici can edit system-recorded measurements');
    }
    const isOwner = actor.id === ownerUserId;
    if (!isOwner) {
      throw new ForbiddenException('Only the recording user or yonetici can edit this measurement');
    }

    const ageMs = Date.now() - new Date(measuredAt).getTime();
    if (ageMs > SAME_DAY_WINDOW_MS) {
      throw new BadRequestException('Same-day edit window expired');
    }
  }

  private async assertPatient(patientId: string): Promise<void> {
    const patient = await this.prisma.scoped.patient.findFirst({
      where: { id: patientId, deletedAt: null },
    });
    if (!patient) throw new NotFoundException('Patient not found');
  }
}
