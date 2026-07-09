import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@airmed/db';
import { InvoiceService } from '../billing/invoice.service';
import { CommissionService } from '../commission/commission.service';
import { PatientDoctorService } from '../patient/patient-doctor.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import {
  ExaminationCreateInput,
  ExaminationListQuery,
  ExaminationUpdateInput,
} from './examination.schemas';

// A7 muayene servisi.
//
// Yetki kuralı (update):
// - "yonetici" rolü: her zaman düzenleyebilir
// - Diğer roller: yalnızca aynı gün (24 saatlik pencere) ve yalnızca kendi
//   muayenesini düzenleyebilir
// - Soft-delete: aynı kural; ileride retention politikasına bağlanır
//
// Doctor relation User'a (Examination.doctorId → User.id). doktor rolündeki
// kullanıcı muayeneyi sahiplenir; user.id ile aynı olmalı (admin override
// edebilir).

interface Actor {
  id: string;
  roles: readonly string[];
}

const SAME_DAY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 saat

@Injectable()
export class ExaminationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly patientDoctor: PatientDoctorService,
    // S12b — müşteri görüşmesi sonrası: muayene başına otomatik hakediş
    private readonly commission: CommissionService,
    // S12c — "Önce öde sonra hizmet" sıkı engel
    private readonly invoice: InvoiceService,
  ) {}

  async create(input: ExaminationCreateInput) {
    const tenantId = this.tenantContext.requireTenantId();
    await this.assertPatientAndDoctor(input.patientId, input.doctorId);
    if (input.appointmentId) {
      await this.assertAppointmentFree(input.appointmentId);
    }
    // S12c — müşteri görüşmesi karar 3: hasta bugün muayene için ödeme yapmadıysa
    // examination açılmaz. Klinik akış: önce resepsiyon fatura+tahsilat.
    await this.invoice.assertPaidSession(input.patientId, 'examination');

    const created = await this.prisma.scoped.examination.create({
      data: {
        tenantId,
        patientId: input.patientId,
        doctorId: input.doctorId,
        appointmentId: input.appointmentId ?? null,
        examinedAt: new Date(input.examinedAt),
        chiefComplaint: input.chiefComplaint ?? null,
        history: input.history ?? null,
        findings: (input.findings ?? {}) as Prisma.InputJsonValue,
        diagnosis: input.diagnosis ?? null,
        treatmentPlan: input.treatmentPlan ?? null,
        prescription: input.prescription ?? null,
        status: input.status ?? 'final',
      },
    });

    // S4 — Doktor-hasta atama auto upsert (karar tutanağı §7).
    // Examination.doctorId User.id'yi işaret ediyor (Appointment/Surgery'de
    // Doctor.id'ye, schema'da inconsistency). Doctor profile lookup yapıp
    // bulamazsak atla — visiting cerrah veya profilsiz doktor user (asistan
    // doktor üyeliği gibi sınır durumlar) için defensive.
    const doctorProfile = await this.prisma.scoped.doctor.findFirst({
      where: { userId: input.doctorId },
      select: { id: true },
    });
    if (doctorProfile) {
      await this.patientDoctor.assignAuto({
        tenantId,
        patientId: input.patientId,
        doctorId: doctorProfile.id,
      });
    }

    // S12b — müşteri görüşmesi sonrası: muayene başına otomatik hakediş entry.
    // baseAmount aktif "examination" hizmet kataloğu fiyatından alınır;
    // katalogta yoksa default 0 ile geçilir (kural yine eşleşirse boş entry).
    if (doctorProfile) {
      const baseAmount = await this.lookupExaminationBaseAmount();
      await this.commission.tryAutoCalculate({
        sourceType: 'examination',
        sourceId: created.id,
        doctorId: doctorProfile.id,
        baseAmount,
      });
    }

    return created;
  }

  /**
   * S12b — Aktif examination kategorisinde ilk hizmet kalemi fiyatı.
   * Klinik genelde tek "Muayene" item'ı tutar; çoklu varsa sortOrder'a göre ilk.
   */
  private async lookupExaminationBaseAmount(): Promise<string> {
    const item = await this.prisma.scoped.serviceItem.findFirst({
      where: { category: 'examination', isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { defaultPrice: 'desc' }],
      select: { defaultPrice: true },
    });
    return item?.defaultPrice.toString() ?? '0';
  }

  async list({ patientId, doctorId, dateFrom, dateTo, page, pageSize }: ExaminationListQuery) {
    const where: Prisma.ExaminationWhereInput = {
      deletedAt: null,
      ...(patientId ? { patientId } : {}),
      ...(doctorId ? { doctorId } : {}),
      ...(dateFrom || dateTo
        ? {
            examinedAt: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lt: new Date(dateTo) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.scoped.examination.findMany({
        where,
        orderBy: { examinedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scoped.examination.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  // S15 — "Geçmiş Muayeneler" (doktor ekranı). Giriş yapan doktorun yaptığı
  // muayeneler (Examination.doctorId = User.id). Hasta bilgisi include; sayfalı.
  // doctorId sunucuda ctx.user.sub'a sabitlenir → doktor yalnız kendininkini görür.
  async listByDoctorUser(userId: string, { page, pageSize }: { page: number; pageSize: number }) {
    const where: Prisma.ExaminationWhereInput = { doctorId: userId, deletedAt: null };
    const [items, total] = await Promise.all([
      this.prisma.scoped.examination.findMany({
        where,
        orderBy: { examinedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.scoped.examination.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  // Hasta tarihçesi için convenience query (timeline render).
  async listByPatient(patientId: string) {
    return this.prisma.scoped.examination.findMany({
      where: { patientId, deletedAt: null },
      orderBy: { examinedAt: 'desc' },
      include: {
        doctor: { select: { id: true, name: true, email: true } },
      },
      // #1064 — timeline tavanı (kronik hastada sınırsız büyürdü).
      take: 200,
    });
  }

  async findById(id: string) {
    const exam = await this.prisma.scoped.examination.findFirst({
      where: { id, deletedAt: null },
      include: {
        patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
        doctor: { select: { id: true, name: true, email: true } },
      },
    });
    if (!exam) throw new NotFoundException('Examination not found');
    return exam;
  }

  // #379 — Açık taslak: hastanın en güncel kaydedilmemiş (draft) muayenesi.
  // Doktor ölçüme yolladığında yarım kalan formu yeniden yüklemek için.
  async findOpenDraft(patientId: string) {
    return this.prisma.scoped.examination.findFirst({
      where: { patientId, status: 'draft', deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      include: {
        patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
        doctor: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async update(id: string, input: ExaminationUpdateInput, actor: Actor) {
    const current = await this.findById(id);
    this.assertEditAllowed(current.examinedAt, current.doctorId, actor);

    const data: Prisma.ExaminationUpdateInput = {};
    if (input.examinedAt !== undefined) data.examinedAt = new Date(input.examinedAt);
    if (input.chiefComplaint !== undefined) data.chiefComplaint = input.chiefComplaint;
    if (input.history !== undefined) data.history = input.history;
    if (input.findings !== undefined) data.findings = input.findings as Prisma.InputJsonValue;
    if (input.diagnosis !== undefined) data.diagnosis = input.diagnosis;
    if (input.treatmentPlan !== undefined) data.treatmentPlan = input.treatmentPlan;
    if (input.prescription !== undefined) data.prescription = input.prescription;
    if (input.status !== undefined) data.status = input.status;

    return this.prisma.scoped.examination.update({ where: { id }, data });
  }

  async softDelete(id: string, actor: Actor) {
    const current = await this.findById(id);
    this.assertEditAllowed(current.examinedAt, current.doctorId, actor);
    await this.prisma.scoped.examination.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private assertEditAllowed(examinedAt: Date, ownerDoctorId: string, actor: Actor): void {
    const isAdmin = actor.roles.includes('yonetici');
    if (isAdmin) return;

    const isOwner = actor.id === ownerDoctorId;
    if (!isOwner) {
      throw new ForbiddenException('Only the examining doctor or yonetici can edit this record');
    }

    const ageMs = Date.now() - new Date(examinedAt).getTime();
    if (ageMs > SAME_DAY_WINDOW_MS) {
      throw new BadRequestException('Same-day edit window expired');
    }
  }

  private async assertPatientAndDoctor(patientId: string, doctorId: string): Promise<void> {
    const [patient, doctor] = await Promise.all([
      this.prisma.scoped.patient.findFirst({ where: { id: patientId, deletedAt: null } }),
      this.prisma.scoped.user.findFirst({ where: { id: doctorId } }),
    ]);
    if (!patient) throw new NotFoundException('Patient not found');
    if (!doctor) throw new NotFoundException('Doctor (user) not found');
  }

  // appointmentId @unique: tek randevu → tek muayene. Mevcut bağlanma varsa
  // 409 yerine 400 dön (klinik yanlış flow ile karşılaşmasın diye açık mesaj).
  private async assertAppointmentFree(appointmentId: string): Promise<void> {
    const existing = await this.prisma.scoped.examination.findUnique({
      where: { appointmentId },
    });
    if (existing) {
      throw new BadRequestException('This appointment already has an examination');
    }
  }
}
