import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@airmed/db';
import { InvoiceService } from '../billing/invoice.service';
import { ConsumableService } from '../consumable/consumable.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import {
  ProcedureCreateInput,
  ProcedureListQuery,
  ProcedureSeriesQuery,
  ProcedureUpdateInput,
} from './procedure.schemas';

// B5 Procedure servisi.
//
// Yetki kuralı:
// - Read (list / findById / series): tüm klinik personeli
// - Write (create / update / softDelete): doktor (kendi prosedürü için
//   doctorId.userId == actor.id) + yonetici / yonetici_asistani
// - Sarf düşümü (drug stock): bu fazda freetext (drugUsed/drugDose). Gerçek
//   stok hareketi C2 generic consumable modülüne ertelendi; IolStockMovement
//   IOL'a özel kalır.
//
// Auto follow-up:
// - autoScheduleFollowUp=true (default) → 1 hafta sonra type='control'
//   Appointment yaratılır, performedAt saatinde başlar (slot çakışması
//   appointment EXCLUDE GIST tarafından bloklanır → ConflictException).
// - Çakışma çıkarsa procedure yine de kaydedilir (transaction içinde),
//   yalnızca follow-up adımı atlanır ve dönen kayıtta followUpSkipped: true
//   ile geri verilir — kullanıcı manuel ayarlayabilir.

interface Actor {
  id: string;
  roles: readonly string[];
}

const procedureInclude = {
  patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
  doctor: { select: { id: true, name: true, specialty: true, userId: true } },
  followUpAppointment: { select: { id: true, startsAt: true, endsAt: true, status: true } },
} satisfies Prisma.ProcedureInclude;

@Injectable()
export class ProcedureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly invoice: InvoiceService,
    private readonly consumables: ConsumableService,
  ) {}

  async list(q: ProcedureListQuery) {
    const where: Prisma.ProcedureWhereInput = {
      deletedAt: null,
      ...(q.patientId ? { patientId: q.patientId } : {}),
      ...(q.doctorId ? { doctorId: q.doctorId } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.fromDate || q.toDate
        ? {
            performedAt: {
              ...(q.fromDate ? { gte: new Date(q.fromDate) } : {}),
              ...(q.toDate ? { lte: new Date(q.toDate) } : {}),
            },
          }
        : {}),
    };
    return this.prisma.scoped.procedure.findMany({
      where,
      orderBy: { performedAt: 'desc' },
      take: q.limit,
      include: procedureInclude,
    });
  }

  async findById(id: string) {
    const p = await this.prisma.scoped.procedure.findFirst({
      where: { id, deletedAt: null },
      include: procedureInclude,
    });
    if (!p) throw new NotFoundException('Procedure not found');
    return p;
  }

  // Aynı hastada aynı tipte zaman çizelgesi (IVT seans takibi için).
  async series({ patientId, type }: ProcedureSeriesQuery) {
    return this.prisma.scoped.procedure.findMany({
      where: {
        deletedAt: null,
        patientId,
        ...(type ? { type } : {}),
      },
      orderBy: { performedAt: 'asc' },
      select: {
        id: true,
        type: true,
        eyeSide: true,
        drugUsed: true,
        drugDose: true,
        performedAt: true,
        status: true,
      },
    });
  }

  async create(input: ProcedureCreateInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    const doctor = await this.findDoctor(input.doctorId);
    this.assertWriter(doctor.userId, actor);

    // Patient varlığını doğrula (RLS zaten tenant'ı korur).
    const patient = await this.prisma.scoped.patient.findFirst({
      where: { id: input.patientId, deletedAt: null },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    // Delta audit C-1: S12c "önce öde sonra hizmet" kuralı — procedure (IVT,
    // YAG, IPL vb.) için examination/lab/surgery ile aynı asersiyon. Bugün
    // category=procedure paid/partial invoice olmadan procedure açılamaz.
    await this.invoice.assertPaidSession(input.patientId, 'procedure');

    if (input.appointmentId) {
      const appt = await this.prisma.scoped.appointment.findFirst({
        where: { id: input.appointmentId, deletedAt: null },
        select: { id: true },
      });
      if (!appt) throw new NotFoundException('Appointment not found');
    }

    const performedAt = new Date(input.performedAt);
    if (Number.isNaN(performedAt.getTime())) {
      throw new BadRequestException('performedAt invalid');
    }

    // Auto follow-up: type='control', 1 hafta sonra aynı saatte 30 dk.
    let followUpAppointmentId: string | null = null;
    let followUpSkipped = false;
    if (input.autoScheduleFollowUp) {
      const startsAt = new Date(performedAt);
      startsAt.setDate(startsAt.getDate() + input.followUpDaysFromNow);
      const endsAt = new Date(startsAt);
      endsAt.setMinutes(endsAt.getMinutes() + 30);

      try {
        const appt = await this.prisma.scoped.appointment.create({
          data: {
            tenantId,
            patientId: input.patientId,
            doctorId: input.doctorId,
            type: 'control',
            status: 'scheduled',
            startsAt,
            endsAt,
            notes: `B5 procedure follow-up`,
            createdById: actor.id,
          },
          select: { id: true },
        });
        followUpAppointmentId = appt.id;
      } catch (err) {
        const e = err as { code?: string };
        // EXCLUDE GIST overlap → atla, procedure'ı yine kaydet
        if (e?.code === 'P2010' || e?.code === '23P01') {
          followUpSkipped = true;
        } else {
          throw err as Error;
        }
      }
    }

    const created = await this.prisma.scoped.procedure.create({
      data: {
        tenantId,
        patientId: input.patientId,
        doctorId: input.doctorId,
        appointmentId: input.appointmentId ?? null,
        followUpAppointmentId,
        type: input.type,
        status: input.status,
        eyeSide: input.eyeSide,
        anesthesia: input.anesthesia,
        drugUsed: input.drugUsed?.trim() || null,
        drugDose: input.drugDose?.trim() || null,
        settings: input.settings as Prisma.InputJsonValue,
        findings: input.findings ?? null,
        complications: input.complications ?? null,
        notes: input.notes ?? null,
        performedAt,
        postProcedureControlDate: followUpAppointmentId
          ? new Date(
              performedAt.getFullYear(),
              performedAt.getMonth(),
              performedAt.getDate() + input.followUpDaysFromNow,
            )
          : null,
        createdById: actor.id,
      },
      include: procedureInclude,
    });

    // #372 — Kullanılan sarf malzemeleri stoktan düş (best-effort; aynı request-tx
    // içinde). Eskiden prosedür tamamlanınca düşüm yapılmıyordu (drugUsed freetext).
    if (input.consumablesUsed && input.consumablesUsed.length > 0) {
      await this.consumables.consumeMany(input.consumablesUsed);
    }

    return { ...created, followUpSkipped };
  }

  async update(id: string, input: ProcedureUpdateInput, actor: Actor) {
    const existing = await this.findById(id);
    this.assertWriter(existing.doctor?.userId ?? null, actor);
    return this.prisma.scoped.procedure.update({
      where: { id },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.drugUsed !== undefined ? { drugUsed: input.drugUsed?.trim() || null } : {}),
        ...(input.drugDose !== undefined ? { drugDose: input.drugDose?.trim() || null } : {}),
        ...(input.settings !== undefined
          ? { settings: input.settings as Prisma.InputJsonValue }
          : {}),
        ...(input.findings !== undefined ? { findings: input.findings } : {}),
        ...(input.complications !== undefined ? { complications: input.complications } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
      include: procedureInclude,
    });
  }

  async softDelete(id: string, actor: Actor) {
    const existing = await this.findById(id);
    this.assertWriter(existing.doctor?.userId ?? null, actor);
    // Bağlı follow-up appointment'ı da soft-delete et — kullanıcı manuel
    // tekrar oluşturabilir. Sequential ops paylaşıyor per-request tenant tx
    // (TenantInterceptor), nested $transaction'la aynı atomiklikte.
    await this.prisma.scoped.procedure.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    if (existing.followUpAppointment) {
      await this.prisma.scoped.appointment.update({
        where: { id: existing.followUpAppointment.id },
        data: { deletedAt: new Date() },
      });
    }
    return { ok: true as const };
  }

  private async findDoctor(id: string) {
    const d = await this.prisma.scoped.doctor.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, userId: true, isActive: true },
    });
    if (!d) throw new NotFoundException('Doctor not found');
    if (!d.isActive) throw new ConflictException('Doctor is inactive');
    return d;
  }

  private assertWriter(doctorUserId: string | null, actor: Actor): void {
    const isAdmin = actor.roles.some((r) => r === 'yonetici' || r === 'yonetici_asistani');
    if (isAdmin) return;
    if (doctorUserId && actor.id === doctorUserId) return;
    throw new ForbiddenException('Only the operating doctor or yonetici can manage this procedure');
  }
}
