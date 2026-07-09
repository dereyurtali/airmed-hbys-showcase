import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { ComplicationsQuery, ScheduleFollowUpsInput, SURGERY_REF_TAG } from './post-op.schemas';

// B4 Post-op takip servisi.
//
// Yetki:
// - scheduleFollowUps: doktor (kendi ameliyatı için) + yonetici / yonetici_asistani
// - listFollowUps / recentComplications: tüm klinik personeli
//
// Mantık:
// - Yeni tablo yok. Mevcut Appointment kullanılır (type='control' — ameliyat
//   sonrası kontrol randevusu; ayrı 'post_op' tipi YOK). Post-op kontrolleri
//   normal kontrollerden notes'taki #surgery:<uuid> tag'i ile ayrılır.
// - Default intervaller: 7 / 30 / 90 gün — frontend service'e proposal listesi
//   verir, service create eder.
// - Idempotency: aynı surgeryId için zaten kontrol kaydı varsa 409.

interface Actor {
  id: string;
  roles: readonly string[];
}

export const DEFAULT_FOLLOW_UP_INTERVALS = [7, 30, 90] as const;

@Injectable()
export class PostOpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async scheduleFollowUps(input: ScheduleFollowUpsInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    const surgery = await this.findSurgery(input.surgeryId);

    // Data integrity check before auth — admin can't bypass missing data.
    if (!surgery.doctor) {
      throw new BadRequestException(
        'Surgeon has no doctor profile — assign one before scheduling follow-ups',
      );
    }
    this.assertWriter(surgery.doctor.userId, actor);

    // Aynı ameliyat için tekrar tetiklemeyi reddet — kullanıcı önce silmeli.
    const existing = await this.prisma.scoped.appointment.count({
      where: {
        deletedAt: null,
        patientId: surgery.patientId,
        type: 'control',
        notes: { contains: `${SURGERY_REF_TAG}${surgery.id}` },
      },
    });
    if (existing > 0) {
      throw new ConflictException('Post-op follow-ups already scheduled for this surgery');
    }

    const surgeryRef = `${SURGERY_REF_TAG}${surgery.id}`;
    // Sıralı oluştur (EXCLUDE GIST overlap koruması zaten Appointment tarafında).
    const created = [];
    for (const p of input.proposals) {
      const startsAt = new Date(p.startsAt);
      const endsAt = new Date(p.endsAt);
      if (endsAt <= startsAt) {
        throw new BadRequestException('endsAt must be after startsAt');
      }
      const notes = [p.notes?.trim(), surgeryRef].filter(Boolean).join('\n').slice(0, 2000);
      try {
        const appt = await this.prisma.scoped.appointment.create({
          data: {
            tenantId,
            patientId: surgery.patientId,
            doctorId: surgery.doctorId,
            type: 'control',
            status: 'scheduled',
            startsAt,
            endsAt,
            notes,
            createdById: actor.id,
          },
        });
        created.push(appt);
      } catch (err) {
        const e = err as { code?: string };
        // EXCLUDE GIST overlap → 23P01 → ConflictException
        if (e?.code === 'P2010' || e?.code === '23P01') {
          throw new ConflictException('Proposed time conflicts with another appointment');
        }
        throw err as Error;
      }
    }
    return created;
  }

  async listFollowUps(surgeryId: string) {
    const surgery = await this.findSurgery(surgeryId);
    return this.prisma.scoped.appointment.findMany({
      where: {
        deletedAt: null,
        patientId: surgery.patientId,
        type: 'control',
        notes: { contains: `${SURGERY_REF_TAG}${surgery.id}` },
      },
      orderBy: { startsAt: 'asc' },
      include: {
        doctor: { select: { id: true, name: true, specialty: true } },
      },
    });
  }

  async deleteFollowUps(surgeryId: string, actor: Actor) {
    const surgery = await this.findSurgery(surgeryId);
    this.assertWriter(surgery.doctor?.userId ?? null, actor);
    const result = await this.prisma.scoped.appointment.updateMany({
      where: {
        deletedAt: null,
        patientId: surgery.patientId,
        type: 'control',
        notes: { contains: `${SURGERY_REF_TAG}${surgery.id}` },
      },
      data: { deletedAt: new Date() },
    });
    return { deletedCount: result.count };
  }

  async recentComplications({ days }: ComplicationsQuery) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return this.prisma.scoped.surgery.findMany({
      where: {
        deletedAt: null,
        complicationFlag: true,
        performedAt: { gte: since },
      },
      orderBy: { performedAt: 'desc' },
      take: 50,
      include: {
        patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
        doctor: { select: { id: true, name: true, specialty: true } },
      },
    });
  }

  private async findSurgery(id: string) {
    const surgery = await this.prisma.scoped.surgery.findFirst({
      where: { id, deletedAt: null },
      include: {
        doctor: { select: { id: true, userId: true, deletedAt: true } },
      },
    });
    if (!surgery) throw new NotFoundException('Surgery not found');
    if (surgery.doctor?.deletedAt) {
      // Soft-deleted doctor profile → treat as missing
      return { ...surgery, doctor: null };
    }
    return surgery;
  }

  private assertWriter(surgeonUserId: string | null, actor: Actor): void {
    const isAdmin = actor.roles.some((r) => r === 'yonetici' || r === 'yonetici_asistani');
    if (isAdmin) return;
    if (surgeonUserId && actor.id === surgeonUserId) return;
    throw new ForbiddenException(
      'Only the operating surgeon or yonetici can schedule post-op follow-ups',
    );
  }

  // Default proposal generator — frontend default'larını oluşturmak için.
  // Service'in dışındaki helper'lar gibi davranır; pure function.
  static buildDefaultProposals(performedAt: Date, slotHour = 10) {
    return DEFAULT_FOLLOW_UP_INTERVALS.map((days) => {
      const start = new Date(performedAt);
      start.setDate(start.getDate() + days);
      start.setHours(slotHour, 0, 0, 0);
      const end = new Date(start);
      end.setMinutes(end.getMinutes() + 30);
      return {
        daysFromSurgery: days,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
      };
    });
  }
}
