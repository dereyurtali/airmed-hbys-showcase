import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AppointmentStatus } from '@airmed/db';
import { EncounterService } from '../encounter/encounter.service';
import type { InitialStation } from '../encounter/encounter.schemas';
import { MessagingService } from '../messaging/messaging.service';
import { PatientDoctorService } from '../patient/patient-doctor.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import {
  AppointmentCreateInput,
  AppointmentListQuery,
  AppointmentRangeQuery,
  AppointmentUpdateInput,
  CHECKIN_STATION_BY_TYPE,
} from './appointment.schemas';

// Status state machine. S15 — checked_in → in_progress edge artık sürülür:
// Encounter "Muayeneye başla" aksiyonu (EncounterService.advance → in_exam)
// randevuyu in_progress'e taşır. Eskiden bu edge atıldı; doktor checked_in'den
// doğrudan completed'a geçiyordu. Frontend aynası: apps/web/src/lib/appointment.constants.ts
const LEGAL_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['in_progress', 'completed', 'cancelled', 'no_show'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  no_show: [],
};

@Injectable()
export class AppointmentService {
  private readonly logger = new Logger(AppointmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly messaging: MessagingService,
    private readonly patientDoctor: PatientDoctorService,
    private readonly encounter: EncounterService,
  ) {}

  async create(input: AppointmentCreateInput) {
    const tenantId = this.tenantContext.requireTenantId();
    const tx = this.prisma.scoped;

    // #367 — Doktorsuz "genel randevu" (havuz): doctorId null ise doktor-bağlı
    // kontroller (varlık, izin/mesai, advisory lock, EXCLUDE) atlanır; randevu
    // havuza düşer, check-in'de / sonradan müsait doktora atanır.
    await this.assertPatientAndDoctorExist(input.patientId, input.doctorId ?? null);
    if (input.doctorId) {
      // #368 — Doktor izin/mesai penceresi zorlaması.
      await this.assertDoctorAvailable(
        input.doctorId,
        new Date(input.startsAt),
        new Date(input.endsAt),
      );
      await this.acquireDoctorLock(input.doctorId);
    }

    let created;
    try {
      created = await tx.appointment.create({
        data: {
          tenantId,
          patientId: input.patientId,
          doctorId: input.doctorId ?? null,
          type: input.type,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          notes: input.notes ?? null,
          source: input.source ?? null,
        },
      });
    } catch (err) {
      if (isOverlapViolation(err)) {
        throw new ConflictException(
          'Time slot already booked for this doctor — pick a different window.',
        );
      }
      throw err;
    }

    // S4 — Doktor-hasta atama (karar tutanağı §7 auto): randevu yaratıldığı
    // anda PatientDoctor upsert. Idempotent. #367 — Doktorsuz randevuda atlanır
    // (doktor check-in'de / sonradan atanınca PatientDoctor o akışta kurulur).
    if (input.doctorId) {
      await this.patientDoctor.assignAuto({
        tenantId,
        patientId: input.patientId,
        doctorId: input.doctorId,
      });
    }

    // D1 entegrasyonu: confirmation şimdi + 24sa öncesi reminder kuyrukla.
    // Best-effort — messaging düşerse randevu hâlâ geçerli.
    await this.fireConfirmationAndReminder(created);

    return created;
  }

  // #368 — Randevu doktorun izin (DoctorLeave) ve mesai (DoctorAvailability)
  // penceresine uymalı. Leave overlap → 400. Doktorun availability satırı varsa
  // randevu o gün+saat aralığında olmalı; hiç availability tanımlı değilse kontrol
  // atlanır (kısıtlama tanımlanmamış doktor serbest). VisitingWindow (tarih-bazlı)
  // tanımlıysa randevu günü en az bir pencereye düşmeli.
  private async assertDoctorAvailable(doctorId: string, startsAt: Date, endsAt: Date) {
    const leave = await this.prisma.scoped.doctorLeave.findFirst({
      where: { doctorId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
      select: { id: true },
    });
    if (leave) {
      throw new BadRequestException('Seçilen doktor o tarihte izinli — başka gün/doktor seçin.');
    }

    const hhmm = (d: Date) =>
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const dow = startsAt.getDay();
    const availability = await this.prisma.scoped.doctorAvailability.findMany({
      where: { doctorId },
      select: { dayOfWeek: true, startTime: true, endTime: true },
    });
    if (availability.length > 0) {
      const s = hhmm(startsAt);
      const e = hhmm(endsAt);
      const ok = availability.some(
        (a) => a.dayOfWeek === dow && a.startTime <= s && a.endTime >= e,
      );
      if (!ok) {
        throw new BadRequestException(
          'Seçilen saat doktorun mesai penceresi dışında — müsait bir saat seçin.',
        );
      }
    }

    const visiting = await this.prisma.scoped.visitingWindow.findMany({
      where: { doctorId },
      select: { startsAt: true, endsAt: true },
    });
    // #1047 — misafir doktor varsayılan randevuya KAPALI (ürün kararı, EPIC
    // #1052): geliş penceresi girilmemişse randevu yazılamaz. Doctor.type
    // kanonik kaynak; AvailabilityService.freeSlots aynı kuralı uygular (0 slot).
    if (visiting.length === 0) {
      const doctor = await this.prisma.scoped.doctor.findFirst({
        where: { id: doctorId },
        select: { type: true },
      });
      if (doctor?.type === 'visiting') {
        throw new BadRequestException(
          'Misafir doktorun geliş tarihi henüz tanımlı değil — önce ziyaret penceresi girilmeli.',
        );
      }
    }
    if (visiting.length > 0) {
      const inWindow = visiting.some((w) => w.startsAt <= startsAt && w.endsAt >= endsAt);
      if (!inWindow) {
        throw new BadRequestException(
          'Seçilen doktor yalnız belirli tarihlerde geliyor — ziyaret penceresi dışında randevu verilemez.',
        );
      }
    }
  }

  async list({
    doctorId,
    patientId,
    status,
    type,
    dateFrom,
    dateTo,
    page,
    pageSize,
  }: AppointmentListQuery) {
    const where: Prisma.AppointmentWhereInput = {
      deletedAt: null,
      ...(doctorId ? { doctorId } : {}),
      ...(patientId ? { patientId } : {}),
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
      ...(dateFrom || dateTo
        ? {
            startsAt: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lt: new Date(dateTo) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.scoped.appointment.findMany({
        where,
        orderBy: { startsAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scoped.appointment.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  /**
   * Calendar view — every appointment whose [startsAt, endsAt) overlaps the
   * query window. Single query, indexed by (tenantId, doctorId, startsAt) /
   * (tenantId, status, startsAt). Doctor filter is optional so the weekly
   * view can aggregate across the schedule.
   */
  async findInRange({ doctorId, dateFrom, dateTo }: AppointmentRangeQuery) {
    const start = new Date(dateFrom);
    const end = new Date(dateTo);
    // Frontend calendar grid hasta adı + doktor adını kart üzerinde gösteriyor.
    // findById ile aynı select shape'ini kullanıyoruz; uzun isim geri dönmez,
    // sadece kart için gereken alanlar.
    const appts = await this.prisma.scoped.appointment.findMany({
      where: {
        deletedAt: null,
        ...(doctorId ? { doctorId } : {}),
        startsAt: { lt: end },
        endsAt: { gt: start },
      },
      include: {
        patient: {
          select: { id: true, mrn: true, firstName: true, lastName: true, leadSource: true },
        },
        doctor: { select: { id: true, name: true, specialty: true } },
      },
      orderBy: { startsAt: 'asc' },
    });

    // #377 — Cerrahi randevu check-in'inde "ölçüm güncel mi" kontrolü. Ameliyat
    // hastasının son biyometri/keratometri ölçümü FRESH_DAYS içinde değilse
    // (ya da hiç yoksa) measurementStale=true → resepsiyon "ölçüm güncel değil"
    // gösterir, ölçüme yönlendirir. Batch (patientId in) → N+1 yok.
    const surgeryPatientIds = [
      ...new Set(appts.filter((a) => a.type === 'surgery').map((a) => a.patientId)),
    ];
    const lastMeasByPatient = new Map<string, Date>();
    if (surgeryPatientIds.length > 0) {
      const meas = await this.prisma.scoped.measurement.findMany({
        where: {
          patientId: { in: surgeryPatientIds },
          deletedAt: null,
          type: { in: ['biometry', 'keratometry'] },
        },
        orderBy: { measuredAt: 'desc' },
        select: { patientId: true, measuredAt: true },
      });
      for (const m of meas) {
        if (!lastMeasByPatient.has(m.patientId)) lastMeasByPatient.set(m.patientId, m.measuredAt);
      }
    }
    const FRESH_DAYS = 30;
    const staleBefore = Date.now() - FRESH_DAYS * 24 * 60 * 60 * 1000;
    return appts.map((a) => {
      if (a.type !== 'surgery') {
        return { ...a, measurementStale: false, lastMeasurementAt: null as Date | null };
      }
      const last = lastMeasByPatient.get(a.patientId) ?? null;
      return {
        ...a,
        measurementStale: !last || last.getTime() < staleBefore,
        lastMeasurementAt: last,
      };
    });
  }

  async findById(id: string) {
    const appointment = await this.prisma.scoped.appointment.findFirst({
      where: { id, deletedAt: null },
      include: {
        patient: {
          select: { id: true, mrn: true, firstName: true, lastName: true, leadSource: true },
        },
        doctor: { select: { id: true, name: true, specialty: true } },
      },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');
    return appointment;
  }

  /**
   * Edit time / type / notes while still scheduled. Once the patient is
   * checked in (or further along) the slot is locked — only state-machine
   * transitions can change it. If the time window moves, we reacquire the
   * advisory lock and let the EXCLUDE constraint catch a new conflict.
   */
  async update(id: string, data: AppointmentUpdateInput) {
    const current = await this.requireAppointment(id);
    if (current.status !== 'scheduled') {
      throw new BadRequestException('Only scheduled appointments can be edited');
    }

    const nextStartsAt = data.startsAt ? new Date(data.startsAt) : current.startsAt;
    const nextEndsAt = data.endsAt ? new Date(data.endsAt) : current.endsAt;
    if (nextStartsAt >= nextEndsAt) {
      throw new BadRequestException('startsAt must be before endsAt');
    }
    const timeChanged =
      nextStartsAt.getTime() !== current.startsAt.getTime() ||
      nextEndsAt.getTime() !== current.endsAt.getTime();

    if (timeChanged && current.doctorId) {
      await this.acquireDoctorLock(current.doctorId);
    }

    const update: Prisma.AppointmentUpdateInput = {};
    if (data.type !== undefined) update.type = data.type;
    if (data.startsAt !== undefined) update.startsAt = nextStartsAt;
    if (data.endsAt !== undefined) update.endsAt = nextEndsAt;
    if (data.notes !== undefined) update.notes = data.notes;

    try {
      return await this.prisma.scoped.appointment.update({ where: { id }, data: update });
    } catch (err) {
      if (isOverlapViolation(err)) {
        throw new ConflictException('Time slot conflicts with another appointment.');
      }
      throw err;
    }
  }

  cancel(id: string) {
    return this.transition(id, 'cancelled');
  }

  // S15 — check-in randevuyu checked_in yapar VE ziyaret (Encounter) açar.
  // Ziyaret açılışı best-effort: hasta zaten check-in olmuştur, ziyaret kaydı
  // düşse de randevu durumu geçerlidir. İlk istasyon randevu tipine göre seçilir
  // (CHECKIN_STATION_BY_TYPE); resepsiyon `initialStation` ile override edebilir.
  async checkIn(id: string, actorUserId?: string, initialStation?: InitialStation) {
    const updated = await this.transition(id, 'checked_in');
    try {
      await this.encounter.open(
        {
          patientId: updated.patientId,
          appointmentId: updated.id,
          doctorId: updated.doctorId,
          // Randevu tipine göre ilk istasyon: muayene/kontrol → ölçüm, girişimsel
          // (ameliyat/enjeksiyon/lazer) → doktor. Resepsiyon ölçüm-default tipleri
          // check-in'de doktora override edebilir (initialStation). /patients/new
          // saf kayıttır (encounter açmaz); walk-in dahil akış buradan ilerler.
          initialStation: initialStation ?? CHECKIN_STATION_BY_TYPE[updated.type],
        },
        actorUserId,
      );
    } catch (err) {
      this.logger.warn(`Encounter open failed for appointment ${id}: ${asMsg(err)}`);
    }
    return updated;
  }

  markDone(id: string) {
    return this.transition(id, 'completed');
  }

  markNoShow(id: string) {
    return this.transition(id, 'no_show');
  }

  private async transition(id: string, target: AppointmentStatus) {
    const current = await this.requireAppointment(id);
    if (!LEGAL_TRANSITIONS[current.status].includes(target)) {
      throw new BadRequestException(`Illegal transition: ${current.status} → ${target}`);
    }
    const updated = await this.prisma.scoped.appointment.update({
      where: { id },
      data: { status: target },
    });
    if (target === 'cancelled') {
      await this.fireCancellation(updated);
    }
    return updated;
  }

  // ---------- Messaging hooks (D1 PR 2) ----------

  private async fireConfirmationAndReminder(appointment: {
    id: string;
    tenantId: string;
    patientId: string;
    // #367 — Doktorsuz randevuda da onay/hatırlatma gider (doktor adı bilinmez).
    doctorId: string | null;
    startsAt: Date;
  }): Promise<void> {
    const ctx = await this.resolveMessagingContext(appointment.patientId, appointment.doctorId);
    if (!ctx) return;

    const appointmentDate = formatTrDate(appointment.startsAt);
    const appointmentTime = formatTrTime(appointment.startsAt);
    const remindAt = new Date(appointment.startsAt.getTime() - 24 * 60 * 60 * 1000);

    try {
      await this.messaging.fire({
        tenantId: appointment.tenantId,
        key: 'APPOINTMENT_CONFIRMATION',
        recipient: ctx.patientPhone,
        context: { patientName: ctx.patientName, appointmentDate, doctorName: ctx.doctorName },
      });
    } catch (err) {
      this.logger.warn(`APPOINTMENT_CONFIRMATION fire failed for ${appointment.id}: ${asMsg(err)}`);
    }

    if (remindAt.getTime() > Date.now()) {
      try {
        await this.messaging.fire({
          tenantId: appointment.tenantId,
          key: 'APPOINTMENT_REMINDER_24H',
          recipient: ctx.patientPhone,
          context: { patientName: ctx.patientName, appointmentTime, doctorName: ctx.doctorName },
          scheduledAt: remindAt,
        });
      } catch (err) {
        this.logger.warn(
          `APPOINTMENT_REMINDER_24H queue failed for ${appointment.id}: ${asMsg(err)}`,
        );
      }
    }
  }

  private async fireCancellation(appointment: {
    id: string;
    tenantId: string;
    patientId: string;
    doctorId: string | null;
    startsAt: Date;
  }): Promise<void> {
    const ctx = await this.resolveMessagingContext(appointment.patientId, appointment.doctorId);
    if (!ctx) return;
    try {
      await this.messaging.fire({
        tenantId: appointment.tenantId,
        key: 'APPOINTMENT_CANCELLED',
        recipient: ctx.patientPhone,
        context: {
          patientName: ctx.patientName,
          appointmentDate: formatTrDate(appointment.startsAt),
        },
      });
    } catch (err) {
      this.logger.warn(`APPOINTMENT_CANCELLED fire failed for ${appointment.id}: ${asMsg(err)}`);
    }
  }

  private async resolveMessagingContext(
    patientId: string,
    doctorId: string | null,
  ): Promise<{ patientName: string; patientPhone: string; doctorName: string } | null> {
    const [patient, doctor] = await Promise.all([
      this.prisma.scoped.patient.findFirst({
        where: { id: patientId },
        select: { firstName: true, lastName: true, phone: true },
      }),
      // #367 — Doktorsuz randevuda doktor yok (havuz); doctorName fallback.
      doctorId
        ? this.prisma.scoped.doctor.findFirst({ where: { id: doctorId }, select: { name: true } })
        : Promise.resolve(null),
    ]);
    if (!patient?.phone) return null;
    return {
      patientName: `${patient.firstName} ${patient.lastName}`.trim(),
      patientPhone: patient.phone,
      doctorName: doctor?.name ?? 'Dr.',
    };
  }

  private async requireAppointment(id: string) {
    const found = await this.prisma.scoped.appointment.findFirst({
      where: { id, deletedAt: null },
    });
    if (!found) throw new NotFoundException('Appointment not found');
    return found;
  }

  private async assertPatientAndDoctorExist(patientId: string, doctorId: string | null) {
    const tx = this.prisma.scoped;
    const patient = await tx.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException('Patient not found');
    // #367 — Doktorsuz randevuda doctor kontrolü yok (havuz).
    if (doctorId) {
      const doctor = await tx.doctor.findFirst({
        where: { id: doctorId, deletedAt: null },
        select: { id: true },
      });
      if (!doctor) throw new NotFoundException('Doctor not found');
    }
  }

  /**
   * Per-doctor advisory lock for the duration of the surrounding tx.
   * Serializes concurrent create/update writes against the same doctor so
   * the EXCLUDE constraint never has to reject under contention — the lock
   * gives predictable latency, the constraint is the last line of defense.
   */
  private async acquireDoctorLock(doctorId: string) {
    await this.prisma.scoped
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${doctorId})::bigint)`;
  }
}

function asMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatTrDate(d: Date): string {
  // dd.MM.yyyy HH:mm — Asia/Dushanbe UTC+5
  const local = new Date(d.getTime() + 5 * 60 * 60 * 1000);
  const day = String(local.getUTCDate()).padStart(2, '0');
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const year = local.getUTCFullYear();
  return `${day}.${month}.${year} ${formatTrTime(d)}`;
}

function formatTrTime(d: Date): string {
  const local = new Date(d.getTime() + 5 * 60 * 60 * 1000);
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function isOverlapViolation(err: unknown): boolean {
  // Prisma surfaces Postgres EXCLUDE violations differently depending on
  // whether the path is the typed query API (KnownRequest) or a raw call
  // (UnknownRequest). The constraint name is in the message either way —
  // matching it is the most reliable signal we can pin to.
  if (
    err instanceof Prisma.PrismaClientKnownRequestError ||
    err instanceof Prisma.PrismaClientUnknownRequestError
  ) {
    return err.message.includes('appointments_no_overlap');
  }
  return false;
}
