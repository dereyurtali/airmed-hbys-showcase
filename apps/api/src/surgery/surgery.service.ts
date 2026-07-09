import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InvoiceService } from '../billing/invoice.service';
import { EncounterService } from '../encounter/encounter.service';
import { MessagingService } from '../messaging/messaging.service';
import { NotificationService } from '../notification/notification.service';
import { IolService } from '../iol/iol.service';
import { PatientDoctorService } from '../patient/patient-doctor.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { PostOpService } from '../post-op/post-op.service';
import { buildPostOpProposalsByType } from './post-op-defaults';
import {
  MarkComplicationInput,
  MarkCompletedInput,
  MarkRefusedInput,
  RegisterLensInput,
  SurgeryCreateInput,
  SurgeryListQuery,
  SurgeryUpdateInput,
} from './surgery.schemas';
import { UserFlags } from '../auth/auth.types';

// Karar 2 (v0.4.2) — surgery.create çağıran kullanıcının kimliği + bayrakları.
// Misafir doktor "own-patient" scope guard'ı için gerekli; verilmezse (eski
// çağrı / sistem) scope kontrolü atlanır.
export interface SurgeryCreateActor {
  userId: string;
  flags?: UserFlags;
}

// A8 ameliyat servisi.
//
// Yetki kuralı (update/softDelete):
// - "yonetici" rolü: her zaman düzenleyebilir.
// - Diğer roller: yalnızca Doctor profile sahibi cerrah (doctor.userId ===
//   actor.id) düzenleyebilir.
// - Same-day edit window: yalnızca performedAt set edildiyse, performedAt
//   üzerinden 24sa pencere. Status hala "planned" ise (performedAt null)
//   pencere yok — planlama aşamasında cerrahi takım serbestçe düzenler.
//
// Doctor relation Doctor profile'a (Surgery.doctorId → Doctor.id, doctor.userId
// nullable → visiting prof senaryosu). Visiting prof'un user'ı yoksa sadece
// yonetici düzenler.

interface Actor {
  id: string;
  roles: readonly string[];
}

const SAME_DAY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 saat

// #369 — Doctor ↔ cerrahi-tip yetkinlik (keyword-based). Tip ve uzmanlık
// serbest metin olduğundan anahtar-kelime eşleşmesi: cerrahi tipin gerektirdiği
// uzmanlık kelimeleri doktorun specialty'sinde geçiyorsa eligible. Tip için
// kural yoksa (genel cerrahi) veya uzmanlık tanımsızsa engelleme yok — soft model
// (satışı bloklamaz, yalnız uyumsuz açık seçimi reddeder).
const SURGERY_SPECIALTY_RULES: { match: string[]; specialty: string[] }[] = [
  {
    match: ['katarakt', 'cataract', 'fako', 'phaco', 'iol', 'trifocal', 'monofocal', 'edof'],
    specialty: ['katarakt', 'ön segment', 'on segment', 'cataract', 'anterior'],
  },
  {
    match: ['retina', 'vitre', 'vitreous', 'vitreus', 'vitrektomi'],
    specialty: ['retina', 'vitreus', 'vitreoretinal'],
  },
  { match: ['glokom', 'glaucoma'], specialty: ['glokom', 'glaucoma'] },
  {
    match: ['şaşılık', 'sasilik', 'strabismus', 'pediatrik'],
    specialty: ['şaşılık', 'sasilik', 'strabismus', 'pediatrik'],
  },
];

export function isDoctorEligibleForSurgery(
  doctorSpecialty: string | null,
  surgeryType: string,
): boolean {
  if (!doctorSpecialty) return true;
  const type = surgeryType.toLowerCase();
  const spec = doctorSpecialty.toLowerCase();
  const rule = SURGERY_SPECIALTY_RULES.find((r) => r.match.some((m) => type.includes(m)));
  if (!rule) return true;
  return rule.specialty.some((s) => spec.includes(s));
}

// Madde 5b — precondition check'i için. consent.service'deki util'in kopyası
// (cross-module helper'a ayrılması ileri faz). Pediatrik onam guard'ı ile aynı
// algoritma; tek doğru kaynak gerekmiyor (test edilmiş matematik).
function calculateAge(birthDate: Date | null): number | null {
  if (!birthDate || !(birthDate instanceof Date) || Number.isNaN(birthDate.getTime())) {
    return null;
  }
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age -= 1;
  return age;
}

@Injectable()
export class SurgeryService {
  private readonly logger = new Logger(SurgeryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly postOp: PostOpService,
    private readonly messaging: MessagingService,
    private readonly patientDoctor: PatientDoctorService,
    private readonly invoice: InvoiceService,
    // S15 — ameliyat satışa devir (bildirim + ziyaret istasyonu)
    private readonly notifications: NotificationService,
    private readonly encounter: EncounterService,
    // Delta audit C-2 — 3-state stock model (reserve/consume) için
    private readonly iol: IolService,
  ) {}

  // Madde 5b — ServiceItem.preconditions hard block (cerrahi seçimde).
  // 1) Hasta yaşı min/max sınırı dışındaysa 400.
  // 2) requiredServiceCodes set ise hastanın aynı gün tamamlanmış (paid|partial
  //    fatura içinde) bu kodları içeren InvoiceItem'ları olmalı.
  private async assertPreconditions(patientId: string, surgeryTypeCode: string): Promise<void> {
    const item = await this.prisma.scoped.serviceItem.findFirst({
      where: {
        code: surgeryTypeCode,
        category: 'surgery',
        isActive: true,
        deletedAt: null,
      },
      select: { preconditions: true },
    });
    if (!item) return;
    const pre = (item.preconditions ?? {}) as {
      minAge?: number | null;
      maxAge?: number | null;
      requiredServiceCodes?: string[];
    };

    if (pre.minAge != null || pre.maxAge != null) {
      const patient = await this.prisma.scoped.patient.findFirst({
        where: { id: patientId, deletedAt: null },
        select: { birthDate: true },
      });
      const age = patient ? calculateAge(patient.birthDate) : null;
      if (age != null) {
        if (pre.minAge != null && age < pre.minAge) {
          throw new BadRequestException(
            `Hasta yaşı (${age}) bu cerrahi için minimum ${pre.minAge} olmalı`,
          );
        }
        if (pre.maxAge != null && age > pre.maxAge) {
          throw new BadRequestException(
            `Hasta yaşı (${age}) bu cerrahi için maksimum ${pre.maxAge} olmalı`,
          );
        }
      }
    }

    if (Array.isArray(pre.requiredServiceCodes) && pre.requiredServiceCodes.length > 0) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const completedItems = await this.prisma.scoped.invoiceItem.findMany({
        where: {
          invoice: {
            patientId,
            deletedAt: null,
            status: { in: ['paid', 'partial'] },
            createdAt: { gte: todayStart },
          },
          serviceItem: { code: { in: pre.requiredServiceCodes } },
        },
        select: { serviceItem: { select: { code: true } } },
      });
      const completedCodes = new Set(
        completedItems.map((it) => it.serviceItem?.code).filter((c): c is string => !!c),
      );
      const missing = pre.requiredServiceCodes.filter((c) => !completedCodes.has(c));
      if (missing.length > 0) {
        throw new BadRequestException(
          `Eksik ön şart hizmet(ler) — bugün tamamlanmamış: ${missing.join(', ')}`,
        );
      }
    }
  }

  // Karar 2 (v0.4.2) — misafir doktor yalnız kendi atanmış hastasına ameliyat
  // önerebilir. Yerleşik doktorda + sistem çağrısında (actor yok) kontrol yok.
  private async assertVisitingDoctorScope(
    patientId: string,
    actor: SurgeryCreateActor | undefined,
  ): Promise<void> {
    if (actor?.flags?.is_visiting_doctor !== true) return;
    const tenantId = this.tenantContext.requireTenantId();
    const assigned = await this.patientDoctor.isPatientAssignedToDoctorUser({
      tenantId,
      userId: actor.userId,
      patientId,
    });
    if (!assigned) {
      throw new ForbiddenException('Misafir doktor yalnız kendi hastasına ameliyat önerebilir');
    }
  }

  async create(input: SurgeryCreateInput, actor?: SurgeryCreateActor) {
    const tenantId = this.tenantContext.requireTenantId();
    // Karar 2 — misafir doktor own-patient scope (önce öde kontrolünden önce;
    // yetkisiz hastaya ödeme durumu sızdırılmasın).
    await this.assertVisitingDoctorScope(input.patientId, actor);
    // S12c — "önce öde sonra hizmet" sıkı engel (müşteri görüşmesi).
    await this.invoice.assertPaidSession(input.patientId, 'surgery');
    await this.assertPatientAndDoctor(input.patientId, input.doctorId);
    // Madde 5b — kataloğa girilmiş ön şartları (yaş limit, zorunlu ölçüm
    // kodları) hard block uygula. Eşleşen ServiceItem yoksa kontrol atlanır
    // (yönetici precondition tanımlamamış demek).
    await this.assertPreconditions(input.patientId, input.type);
    if (input.appointmentId) {
      await this.assertAppointmentFree(input.appointmentId);
    }

    const created = await this.prisma.scoped.surgery.create({
      data: {
        tenantId,
        patientId: input.patientId,
        doctorId: input.doctorId,
        appointmentId: input.appointmentId ?? null,
        type: input.type,
        status: input.status ?? 'planned',
        scheduledAt: new Date(input.scheduledAt),
        performedAt: input.performedAt ? new Date(input.performedAt) : null,
        preOp: (input.preOp ?? {}) as Prisma.InputJsonValue,
        intraOp: (input.intraOp ?? {}) as Prisma.InputJsonValue,
        postOp: (input.postOp ?? {}) as Prisma.InputJsonValue,
        complicationFlag: input.complicationFlag ?? false,
        complicationNotes: input.complicationNotes ?? null,
        // B1 PR 1 — yapısal alanlar
        eyeSide: input.eyeSide ?? null,
        anesthesiaType: input.anesthesiaType ?? null,
        surgeonRole: input.surgeonRole ?? null,
      },
    });

    // S4 — Doktor-hasta atama auto upsert (karar tutanağı §7). Cerrahi yapan
    // doktor o hastanın doktoru olur (visiting cerrah özel davranışı S5).
    await this.patientDoctor.assignAuto({
      tenantId,
      patientId: input.patientId,
      doctorId: input.doctorId,
    });

    // #381 — Examination varlık uyarısı (soft). Doktor muayene girmeden planlı
    // cerrahi açabiliyordu; hard block değil (acil / dış muayene senaryosu) ama
    // hastanın hiç muayenesi yoksa uyarı payload'da döner (UI gösterir).
    const hasExam = await this.prisma.scoped.examination.findFirst({
      where: { patientId: input.patientId, deletedAt: null },
      select: { id: true },
    });

    // S15 — Ameliyat satışa devir: planlanan cerrahi paket fatura/tahsilat için
    // ameliyat_satis rolüne düşer. Best-effort: hastanın aktif ziyaretini
    // awaiting_surgery_sales'a ilerlet + ameliyat_satis kullanıcılarına bildir.
    let handoffAdvanced = false;
    if (created.status === 'planned') {
      handoffAdvanced = await this.fireSurgeryHandoff(created.id, input.patientId);
    }

    // #381 — Handoff sessizce yutulmuyor: encounter yasal stage'de değilse
    // advanced=false döner; UI "satış kuyruğuna düşmedi, manuel devir gerekebilir"
    // uyarısı gösterebilir (encounter zaten açıksa normal).
    return {
      ...created,
      warnings: {
        noExamination: !hasExam,
        handoffAdvanced,
      },
    };
  }

  private async fireSurgeryHandoff(surgeryId: string, patientId: string): Promise<boolean> {
    let advanced = false;
    try {
      const enc = await this.encounter.findActiveByPatient(patientId);
      if (enc) {
        await this.encounter.advance({ id: enc.id, toStage: 'awaiting_surgery_sales' });
        advanced = true;
      }
    } catch (err) {
      this.logger.warn(`Encounter handoff advance failed for surgery ${surgeryId}: ${asMsg(err)}`);
    }
    try {
      await this.notifications.createForRole('ameliyat_satis', {
        type: 'surgery_handoff',
        title: 'Yeni ameliyat satış devri',
        body: 'Doktor cerrahi planladı — paket fatura/tahsilat bekliyor.',
        payload: { patientId, surgeryId },
      });
    } catch (err) {
      this.logger.warn(`Surgery handoff notify failed for surgery ${surgeryId}: ${asMsg(err)}`);
    }
    return advanced;
  }

  // S15 — Ameliyat satış kuyruğu: planlanan + henüz cerrahi-bağlı ödenmiş
  // faturası olmayan cerrahiler. ameliyat_satis bu kuyruktan paket faturası keser.
  async handoffQueue() {
    // #1062 — "ödenmiş/kısmi cerrahi faturası olanları çıkar" filtresi DB'de
    // (eskiden tüm planlılar çekilip JS'te eleniyordu). take: kuyruk ekranı
    // için üst sınır — planlı cerrahi birikiminde yanıtı şişirme.
    return this.prisma.scoped.surgery.findMany({
      where: {
        status: 'planned',
        deletedAt: null,
        invoices: { none: { deletedAt: null, status: { in: ['paid', 'partial'] } } },
      },
      include: {
        patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
        invoices: { where: { deletedAt: null }, select: { status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  // S16 — Satış Hattı pipeline: tüm planlı ameliyatlar + türetilmiş 4 durum
  // (yeni/fiyat verildi/yönetici onayında/planlandı) + aktif fatura tutarı +
  // doktor/göz/öneri notu. Durum surgery+invoice'tan türetilir (yeni alan yok).
  async salesPipeline() {
    const surgeries = await this.prisma.scoped.surgery.findMany({
      where: { status: 'planned', deletedAt: null },
      orderBy: { scheduledAt: 'asc' },
      include: {
        patient: {
          select: {
            id: true,
            mrn: true,
            firstName: true,
            lastName: true,
            birthDate: true,
            phone: true,
          },
        },
        doctor: { select: { id: true, name: true, specialty: true } },
        invoices: {
          where: { deletedAt: null },
          select: { id: true, status: true, total: true, currency: true },
        },
      },
    });

    // #370 — Satış temsilcisine salt-okunur klinik özet: hastanın en güncel
    // muayene tanısı/bulgusu + ölçüm sayısı. Eskiden satış yalnız ameliyat adı/
    // lens/göz görüyordu. Batch (patientId in) → N+1 yok.
    const patientIds = Array.from(new Set(surgeries.map((s) => s.patientId)));
    const summaryByPatient = new Map<
      string,
      { diagnosis: string | null; examinedAt: Date | null; measurementCount: number }
    >();
    if (patientIds.length > 0) {
      const [exams, measGroups] = await Promise.all([
        this.prisma.scoped.examination.findMany({
          where: { patientId: { in: patientIds }, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { patientId: true, diagnosis: true, createdAt: true },
        }),
        this.prisma.scoped.measurement.groupBy({
          by: ['patientId'],
          where: { patientId: { in: patientIds }, deletedAt: null },
          _count: { _all: true },
        }),
      ]);
      const measCount = new Map(measGroups.map((g) => [g.patientId, g._count._all]));
      for (const e of exams) {
        if (summaryByPatient.has(e.patientId)) continue; // ilk = en güncel
        summaryByPatient.set(e.patientId, {
          diagnosis: e.diagnosis,
          examinedAt: e.createdAt,
          measurementCount: measCount.get(e.patientId) ?? 0,
        });
      }
      // Muayenesi yok ama ölçümü olan hastalar için de özet.
      for (const [pid, count] of measCount) {
        if (!summaryByPatient.has(pid)) {
          summaryByPatient.set(pid, { diagnosis: null, examinedAt: null, measurementCount: count });
        }
      }
    }

    return surgeries.map((s) => {
      const { invoices, ...rest } = s;
      const pick = (...statuses: string[]) =>
        invoices.find((i) => statuses.includes(i.status)) ?? null;
      let pipelineStatus: 'new' | 'price_given' | 'pending_approval' | 'scheduled';
      let active: (typeof invoices)[number] | null = null;
      if (invoices.length === 0) {
        pipelineStatus = 'new';
      } else if ((active = pick('paid', 'partial'))) {
        pipelineStatus = 'scheduled';
      } else if ((active = pick('pending_approval'))) {
        pipelineStatus = 'pending_approval';
      } else if ((active = pick('open'))) {
        pipelineStatus = 'price_given';
      } else {
        // yalnız cancelled/refunded → fiyat yeniden verilebilir.
        pipelineStatus = 'new';
      }
      return {
        ...rest,
        pipelineStatus,
        invoiceId: active?.id ?? null,
        invoiceTotal: active ? String(active.total) : null,
        invoiceCurrency: active?.currency ?? null,
        clinicalSummary: summaryByPatient.get(s.patientId) ?? {
          diagnosis: null,
          examinedAt: null,
          measurementCount: 0,
        },
      };
    });
  }

  // S16 — Satış "Randevu Ver": ameliyat satış, fiyatı kabul eden hastaya ameliyat
  // tarihi verir. surgery.update doktora kısıtlı; satış için ayrı (SURGERY_BILLING_ROLES).
  // #369 — Satış randevuda doktor seçimi + uzmanlık-cerrahi tip yetkinliği +
  // müsaitlik çakışması. Eskiden yalnız scheduledAt set ediliyordu (doktor
  // öneren doktora sabitti). doctorId verilirse: aktif + yetkin + çakışmasız.
  async eligibleDoctors(surgeryId: string) {
    const surgery = await this.prisma.scoped.surgery.findFirst({
      where: { id: surgeryId, deletedAt: null },
      select: { type: true },
    });
    if (!surgery) throw new NotFoundException('Ameliyat bulunamadı');
    const doctors = await this.prisma.scoped.doctor.findMany({
      where: { isActive: true },
      select: { id: true, name: true, specialty: true },
      orderBy: { name: 'asc' },
    });
    return doctors.map((d) => ({
      ...d,
      isEligible: isDoctorEligibleForSurgery(d.specialty, surgery.type),
    }));
  }

  async scheduleForSale(id: string, scheduledAt: string, doctorId?: string) {
    const surgery = await this.prisma.scoped.surgery.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, type: true, doctorId: true },
    });
    if (!surgery) throw new NotFoundException('Ameliyat bulunamadı');
    const when = new Date(scheduledAt);

    let nextDoctorId = surgery.doctorId;
    if (doctorId && doctorId !== surgery.doctorId) {
      const doctor = await this.prisma.scoped.doctor.findFirst({
        where: { id: doctorId, isActive: true },
        select: { id: true, specialty: true },
      });
      if (!doctor) throw new BadRequestException('Seçilen doktor bulunamadı veya aktif değil');
      if (!isDoctorEligibleForSurgery(doctor.specialty, surgery.type)) {
        throw new BadRequestException('Seçilen doktorun uzmanlığı bu cerrahi tipiyle uyumlu değil');
      }
      nextDoctorId = doctorId;
    }

    // Müsaitlik: aynı doktorun ±2 saat içinde başka planlı ameliyatı olmasın.
    const windowMs = 2 * 60 * 60 * 1000;
    const conflict = await this.prisma.scoped.surgery.findFirst({
      where: {
        id: { not: id },
        doctorId: nextDoctorId,
        status: 'planned',
        deletedAt: null,
        scheduledAt: {
          gte: new Date(when.getTime() - windowMs),
          lt: new Date(when.getTime() + windowMs),
        },
      },
      select: { id: true },
    });
    if (conflict) {
      throw new BadRequestException(
        'Seçilen doktorun bu saat civarında başka planlı ameliyatı var',
      );
    }

    return this.prisma.scoped.surgery.update({
      where: { id },
      data: { scheduledAt: when, doctorId: nextDoctorId },
      select: { id: true, scheduledAt: true, status: true },
    });
  }

  async list({ patientId, doctorId, status, dateFrom, dateTo, page, pageSize }: SurgeryListQuery) {
    const where: Prisma.SurgeryWhereInput = {
      deletedAt: null,
      ...(patientId ? { patientId } : {}),
      ...(doctorId ? { doctorId } : {}),
      ...(status ? { status } : {}),
      ...(dateFrom || dateTo
        ? {
            scheduledAt: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lt: new Date(dateTo) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.scoped.surgery.findMany({
        where,
        orderBy: { scheduledAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        // SurgeryDayCenterPage + Ameliyat Takvimi hasta/doktor adını gösterir.
        include: {
          patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
          doctor: { select: { id: true, name: true } },
        },
      }),
      this.prisma.scoped.surgery.count({ where }),
    ]);

    // #392 — SurgeryDayCenterPage pipeline'ı "güvenlik bekliyor" rozeti +
    // "Tamamlandı" kapısı için her satırın WHO checklist tam-tamamlanma
    // durumunu ister. Batch tek sorgu (N+1 yok); checklist hiç açılmamışsa
    // satır map'te yok → safetyFullyComplete=false.
    const checks = await this.prisma.scoped.surgicalSafetyCheck.findMany({
      where: { surgeryId: { in: items.map((s) => s.id) } },
      select: {
        surgeryId: true,
        signInCompletedAt: true,
        timeOutCompletedAt: true,
        signOutCompletedAt: true,
      },
    });
    const fullyCompleteById = new Map(
      checks.map((c) => [
        c.surgeryId,
        c.signInCompletedAt !== null &&
          c.timeOutCompletedAt !== null &&
          c.signOutCompletedAt !== null,
      ]),
    );

    // R1 (#723) — SurgeryDayCenterPage "Tamamlamak için eksikler" paneli: her
    // satırın imzalı onam durumu. markCompleted ile aynı OR mantığı (cerrahiye
    // bağlı VEYA hastaya genel, revoke edilmemiş). Batch (N+1 yok).
    const surgeryIds = items.map((s) => s.id);
    const patientIds = items.map((s) => s.patientId);
    const consents = await this.prisma.scoped.consentSigning.findMany({
      where: {
        revokedAt: null,
        OR: [{ surgeryId: { in: surgeryIds } }, { patientId: { in: patientIds }, surgeryId: null }],
      },
      select: { surgeryId: true, patientId: true },
    });
    const consentBySurgery = new Set(
      consents.map((c) => c.surgeryId).filter((id): id is string => !!id),
    );
    const consentByPatient = new Set(consents.filter((c) => !c.surgeryId).map((c) => c.patientId));

    // R6 (#728) — satış öncesi "ödeme eksik" riski: cerrahiye bağlı (Invoice.
    // surgeryId) tahsil edilmiş (paid/partial) fatura var mı (batch, N+1 yok).
    const paidInvoices = await this.prisma.scoped.invoice.findMany({
      where: { surgeryId: { in: surgeryIds }, status: { in: ['paid', 'partial'] } },
      select: { surgeryId: true },
    });
    const paidBySurgery = new Set(
      paidInvoices.map((i) => i.surgeryId).filter((id): id is string => !!id),
    );

    const itemsWithSafety = items.map((s) => ({
      ...s,
      safetyFullyComplete: fullyCompleteById.get(s.id) ?? false,
      consentSigned: consentBySurgery.has(s.id) || consentByPatient.has(s.patientId),
      paymentComplete: paidBySurgery.has(s.id),
    }));

    return { items: itemsWithSafety, total, page, pageSize };
  }

  // Hasta tarihçesi için convenience query (timeline render).
  async listByPatient(patientId: string) {
    return this.prisma.scoped.surgery.findMany({
      where: { patientId, deletedAt: null },
      orderBy: { scheduledAt: 'desc' },
      include: {
        doctor: { select: { id: true, name: true, specialty: true, userId: true } },
      },
    });
  }

  async findById(id: string) {
    const surgery = await this.prisma.scoped.surgery.findFirst({
      where: { id, deletedAt: null },
      include: {
        // birthDate — #418 cerrahi time-out ikinci kimlik doğrulaması (MRN/DT).
        patient: {
          select: { id: true, mrn: true, firstName: true, lastName: true, birthDate: true },
        },
        doctor: { select: { id: true, name: true, specialty: true, userId: true } },
      },
    });
    if (!surgery) throw new NotFoundException('Surgery not found');
    return surgery;
  }

  async update(id: string, input: SurgeryUpdateInput, actor: Actor) {
    const current = await this.findById(id);
    this.assertEditAllowed(current.performedAt, current.doctor.userId, actor);

    const data: Prisma.SurgeryUpdateInput = {};
    if (input.type !== undefined) data.type = input.type;
    if (input.status !== undefined) data.status = input.status;
    if (input.scheduledAt !== undefined) data.scheduledAt = new Date(input.scheduledAt);
    if (input.performedAt !== undefined) {
      data.performedAt = input.performedAt ? new Date(input.performedAt) : null;
    }
    if (input.preOp !== undefined) data.preOp = input.preOp as Prisma.InputJsonValue;
    if (input.intraOp !== undefined) data.intraOp = input.intraOp as Prisma.InputJsonValue;
    if (input.postOp !== undefined) data.postOp = input.postOp as Prisma.InputJsonValue;
    if (input.complicationFlag !== undefined) data.complicationFlag = input.complicationFlag;
    if (input.complicationNotes !== undefined) data.complicationNotes = input.complicationNotes;
    // B1 PR 1 — yapısal alanlar
    if (input.eyeSide !== undefined) data.eyeSide = input.eyeSide;
    if (input.anesthesiaType !== undefined) data.anesthesiaType = input.anesthesiaType;
    if (input.surgeonRole !== undefined) data.surgeonRole = input.surgeonRole;

    return this.prisma.scoped.surgery.update({ where: { id }, data });
  }

  // B1 PR 2 — Lens implant kaydı (intra-op flow).
  // 4-aşamalı validation:
  // 1. Format zaten Zod regex'te kontrol edildi (schema seviyesi)
  // 2. Tek kullanım: aynı serial başka cerrahide kullanılmışsa 409
  // 3. Stock cross-check: lotId verildiyse IolLot tenant'a ait + quantity > 0
  // 4. Stock dışı serial + isOverride=false → 400 (override flag zorunlu)
  // 5. Override sırasında reason zorunlu (Zod refine)
  //
  // Başarılı kayıt sonrası:
  // - Surgery.lensImplantLotId + lens* alanlar güncellenir
  // - lotId varsa IolStockMovement 'consume' kaydı oluşturulur (quantity -1,
  //   surgeryId set) — stok hareketi auditlenir
  async registerLens(input: RegisterLensInput, actor: Actor) {
    const surgery = await this.findById(input.surgeryId);
    this.assertEditAllowed(surgery.performedAt, surgery.doctor.userId, actor);

    // Step 2 (tek kullanım): partial unique index `surgeries_tenant_lens_serial_unique`
    // race-free şekilde uygular (migration 20260526023943). Pre-check yok;
    // P2002 catch ConflictException'a çevirir. Eski find+insert pattern'i
    // iki paralel istekte ikisinin de pre-check'i geçmesine izin veriyordu.

    // Step 3: stock cross-check
    let validatedLotId: string | null = null;
    if (input.lotId) {
      const lot = await this.prisma.scoped.iolLot.findFirst({
        where: { id: input.lotId, deletedAt: null },
      });
      if (!lot) throw new BadRequestException('IolLot bulunamadı veya silinmiş');
      if (lot.quantity <= 0 && !input.isOverride) {
        throw new BadRequestException(
          'Lot stoğu bitmiş — gerçek kullanım için isOverride=true ve reason gerek',
        );
      }
      validatedLotId = lot.id;
    } else if (!input.isOverride) {
      // Step 4: lotId verilmedi + override yok → stock-dışı kabul edilmez
      throw new BadRequestException(
        'lotId boş; stok dışı serial kullanımı için isOverride=true gerek',
      );
    }

    // Surgery update + IolStockMovement consume sırayla; tenant-scoped
    // client zaten request transaction'ı içinde (TenantInterceptor opens
    // per-request tx), iki operation aynı tx'te yürür. Nested $transaction
    // çağrısı TransactionClient'ta mevcut değil.
    let updated;
    try {
      updated = await this.prisma.scoped.surgery.update({
        where: { id: input.surgeryId },
        data: {
          lensImplantLotId: validatedLotId,
          lensSerialNumber: input.serialNumber,
          lensBarcode: input.barcode ?? null,
          lensIsOverride: input.isOverride,
          lensOverrideReason: input.isOverride ? (input.overrideReason ?? null) : null,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Semantic olarak ConflictException (409); tRPC HTTP layer'ı bilinmeyen
        // exception'ı 500'e çeviriyor, bu yüzden 400 + açık mesaj (mapping
        // standardizasyonu denetim P2 listesinde).
        throw new BadRequestException(
          'Bu lens seri numarası başka bir cerrahide zaten kullanılmış',
        );
      }
      throw err;
    }
    if (validatedLotId) {
      // Delta audit C-2 — Legacy `iolLot.update({quantity: {decrement:1}})`
      // 3-state model'i (availableQty/reservedQty/consumedQty) bypass ediyordu;
      // forecast servisi consumedQty üzerinden raporladığı için stok tahmin
      // yanlış çıkıyordu. Şimdi `IolService.consumeForSurgery` çağrılır:
      //  - reservedQty >= 1 → reserved → consumed (pre-op rezerve akışı)
      //  - availableQty >= 1 → available → consumed direkt
      //  - isOverride → consumedQty + legacy quantity (negatif kabul)
      // Movement audit IolService içinde tek satırda yazılır.
      await this.iol.consumeForSurgery(
        validatedLotId,
        input.surgeryId,
        input.isOverride,
        actor,
        input.overrideReason ?? undefined,
      );
    }
    return updated;
  }

  // B1 PR 2 — Komplikasyon kaydı.
  // complicationDetail JSONB + complicationFlag=true. complicationNotes
  // legacy free-text alan — description alanına eşlenip korunur.
  async markComplication(input: MarkComplicationInput, actor: Actor) {
    const surgery = await this.findById(input.surgeryId);
    this.assertEditAllowed(surgery.performedAt, surgery.doctor.userId, actor);
    const updated = await this.prisma.scoped.surgery.update({
      where: { id: input.surgeryId },
      data: {
        complicationFlag: true,
        complicationNotes: input.description,
        complicationDetail: {
          category: input.category,
          severity: input.severity,
          description: input.description,
          markedAt: new Date().toISOString(),
          markedById: actor.id,
        } as Prisma.InputJsonValue,
      },
    });

    // D1 entegrasyonu — COMPLICATION_DOCTOR_ALERT mandatory trigger. Best-
    // effort: messaging düşse bile cerrahi kaydı bozulmaz, ama loglanır.
    await this.fireComplicationAlert(surgery, input);

    return updated;
  }

  private async fireComplicationAlert(
    surgery: {
      tenantId: string;
      doctorId: string;
      patient: { firstName: string; lastName: string };
      doctor: { name: string };
    },
    input: MarkComplicationInput,
  ): Promise<void> {
    const contact = await this.prisma.scoped.doctor.findFirst({
      where: { id: surgery.doctorId },
      select: { contactPhone: true, contactEmail: true },
    });
    const recipient =
      contact?.contactPhone ?? contact?.contactEmail ?? `internal:doctor-${surgery.doctorId}`;
    try {
      await this.messaging.fire({
        tenantId: surgery.tenantId,
        key: 'COMPLICATION_DOCTOR_ALERT',
        recipient,
        context: {
          doctorName: surgery.doctor.name,
          patientName: `${surgery.patient.firstName} ${surgery.patient.lastName}`.trim(),
          severity: input.severity,
          description: input.description,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`COMPLICATION_DOCTOR_ALERT fire failed for ${input.surgeryId}: ${msg}`);
    }
  }

  // B1 PR 3 — Surgery'i 'performed' state'ine alır + cerrahi tipine göre
  // post-op kontrol takvimini otomatik üretir.
  //
  // Tasarım:
  // - performedAt verilmezse server now() kullanır
  // - skipAutoSchedule=true: kontrol takvimi oluşturulmaz (cerrah elle ekler)
  // - Otomatik schedule başarısız olursa surgery state'i geri alınmaz (best-
  //   effort; PostOp conflict varsa cerrah manuel düzeltir). Hatayı yutmaz —
  //   throw eder ki UI'de kullanıcı görür.
  // - Idempotency: surgery zaten 'performed' ise re-trigger değil (zaten
  //   performedAt set ise update sadece skipAutoSchedule false ile re-attempt).
  // #418 — Yanlış-göz/lens laterality 'never event' bariyeri. Lens implant edilen
  // cerrahide (lensImplantLotId veya lensSerialNumber set), ameliyat edilen gözün
  // (eyeSide) biyometri/keratometri ölçümü bulunmalı — IOL gücü o göze hesaplanır;
  // ölçülmemiş göze lens = yanlış-göz cerrahisi. 'ou' (bilateral) ölçümler her iki
  // gözü kapsar. Lens implant yoksa (LASIK/pterjium/IVT/lazer) bu zorunluluk yok.
  private async assertEyeLaterality(surgery: {
    patientId: string;
    eyeSide: string | null;
    lensImplantLotId: string | null;
    lensSerialNumber: string | null;
  }): Promise<void> {
    const lensUsed = surgery.lensImplantLotId !== null || surgery.lensSerialNumber !== null;
    if (!lensUsed) return;

    const side = surgery.eyeSide;
    if (side !== 'od' && side !== 'os') {
      throw new BadRequestException(
        'Ameliyat tamamlanamaz (yanlış-göz bariyeri): lens implantı için ameliyat gözü ' +
          'OD veya OS olarak net belirtilmeli (eyeSide).',
      );
    }

    const measured = await this.prisma.scoped.measurement.findFirst({
      where: {
        patientId: surgery.patientId,
        deletedAt: null,
        type: { in: ['biometry', 'keratometry'] },
        eyeSide: { in: [side, 'ou'] },
      },
      select: { id: true },
    });
    if (!measured) {
      throw new BadRequestException(
        `Ameliyat tamamlanamaz (yanlış-göz bariyeri): ${side.toUpperCase()} gözü için ` +
          'biyometri/keratometri ölçümü yok. Lens ölçülmemiş göze implante edilemez — ' +
          'ameliyat gözü ile ölçüm gözünü doğrulayın.',
      );
    }
  }

  // #392 — WHO Surgical Safety Checklist 3 fazının (sign-in/time-out/sign-out)
  // tamamlanmış olmasını zorunlu kılar. SafetyChecklistService.markPhaseComplete
  // her faz için completedAt timestamp set eder; üçü de dolu = fullyComplete.
  // Checklist hiç açılmamışsa satır yok → tamamlanmamış sayılır.
  private async assertSafetyChecklistComplete(surgeryId: string): Promise<void> {
    const check = await this.prisma.scoped.surgicalSafetyCheck.findUnique({
      where: { surgeryId },
      select: {
        signInCompletedAt: true,
        timeOutCompletedAt: true,
        signOutCompletedAt: true,
      },
    });
    const fullyComplete =
      check !== null &&
      check.signInCompletedAt !== null &&
      check.timeOutCompletedAt !== null &&
      check.signOutCompletedAt !== null;
    if (!fullyComplete) {
      throw new BadRequestException(
        'Ameliyat tamamlanamaz: WHO cerrahi güvenlik kontrol listesi (sign-in / ' +
          'time-out / sign-out) tüm fazlarıyla tamamlanmalı. Güvenlik adımı atlanamaz.',
      );
    }
  }

  async markCompleted(input: MarkCompletedInput, actor: Actor) {
    const surgery = await this.findById(input.surgeryId);
    this.assertEditAllowed(surgery.performedAt, surgery.doctor.userId, actor);

    // S15-PR8 — Cerrahi tamamlama öncesi imzalı (ve revoke edilmemiş) onam
    // zorunlu. KVKK + Tacik veri yasası: ameliyat sonrası hukuki sorumluluk
    // için imza dosyada olmalı. Yönetici override yok (admin de aynı kurala
    // tabi); acil durumda Break Glass (PR5) bypass akışı ayrı.
    const signedConsent = await this.prisma.scoped.consentSigning.findFirst({
      where: {
        OR: [
          { surgeryId: input.surgeryId, revokedAt: null },
          { patientId: surgery.patientId, surgeryId: null, revokedAt: null },
        ],
      },
      select: { id: true },
    });
    if (!signedConsent) {
      throw new BadRequestException(
        'Ameliyat tamamlanamaz: hasta için imzalı (revoke edilmemiş) onam bulunmuyor.',
      );
    }

    // #418 — Yanlış-göz 'never event' bariyeri (onam'dan sonra, tamamlamadan önce).
    await this.assertEyeLaterality(surgery);

    // #392 — WHO güvenlik kontrol listesi atlanamaz. Ekip sign-in/time-out/
    // sign-out fazlarını tamamlamadan ameliyat 'performed' işaretlenemez.
    // Service-layer guard: UI disabled gate'i tek başına yeterli değil
    // (doğrudan tRPC çağrısı bypass edemesin). fullyComplete = 3 faz tam.
    await this.assertSafetyChecklistComplete(input.surgeryId);

    const performedAt = input.performedAt ? new Date(input.performedAt) : new Date();

    const updated = await this.prisma.scoped.surgery.update({
      where: { id: input.surgeryId },
      data: {
        status: 'performed',
        performedAt,
      },
    });

    const scheduledAppointments: Array<{ id: string; startsAt: Date }> = [];
    if (!input.skipAutoSchedule) {
      const proposals = buildPostOpProposalsByType(surgery.type, performedAt, input.slotHour);
      // Plan default'ları conflict yaratırsa (mevcut randevu çakışması, vs.)
      // surgery zaten 'performed' state'inde; cerrah manuel reschedule eder.
      // Hata UI'a yansır.
      const appts = await this.postOp.scheduleFollowUps(
        {
          surgeryId: input.surgeryId,
          proposals: proposals.map((p) => ({
            daysFromSurgery: p.daysFromSurgery,
            startsAt: p.startsAt,
            endsAt: p.endsAt,
            notes: p.notes,
          })),
        },
        actor,
      );
      for (const a of appts) {
        scheduledAppointments.push({ id: a.id, startsAt: a.startsAt });
      }
    }

    return {
      surgery: updated,
      autoScheduledAppointments: scheduledAppointments,
    };
  }

  // S15-PR16 — Cerrahi reddi (hasta vazgeçti). status=refused → audit + lead
  // funnel sinyali. performedAt set edilmemiş ameliyatlarda kullanılır;
  // performed surgery için bu uygunsuz (cancelled veya complication akışına git).
  async markRefused(input: MarkRefusedInput, actor: Actor) {
    const surgery = await this.findById(input.surgeryId);
    this.assertEditAllowed(surgery.performedAt, surgery.doctor.userId, actor);

    if (surgery.status === 'performed') {
      throw new BadRequestException(
        'Performed ameliyat reddi olarak işaretlenemez (cancelled veya komplikasyon akışını kullanın).',
      );
    }

    if (
      input.refusalReason === 'other' &&
      (!input.refusalNotes || input.refusalNotes.trim().length < 10)
    ) {
      throw new BadRequestException(
        'refusalReason=other ise refusalNotes zorunlu (en az 10 karakter).',
      );
    }

    const refusedAt = new Date();
    const updated = await this.prisma.scoped.surgery.update({
      where: { id: input.surgeryId },
      data: {
        status: 'refused',
        refusalReason: input.refusalReason,
        refusalNotes: input.refusalNotes ?? null,
        refusedAt,
      },
    });

    this.logger.log(
      `surgery.refused id=${input.surgeryId} reason=${input.refusalReason} by=${actor.id}`,
    );

    // S15-P3 — Cerrahi reddi auto 3-ay follow-up. Reason !== second_opinion ise
    // (hasta zaten başka klinik tercih etti). Best-effort: takvim çakışması
    // yaşarsa sessizce geçer; klinisyen manuel re-schedule eder.
    if (input.refusalReason !== 'second_opinion') {
      try {
        const followUpAt = new Date(refusedAt);
        followUpAt.setMonth(followUpAt.getMonth() + 3);
        followUpAt.setHours(9, 0, 0, 0);
        const followUpEnd = new Date(followUpAt);
        followUpEnd.setMinutes(followUpEnd.getMinutes() + 30);
        await this.prisma.scoped.appointment.create({
          data: {
            tenantId: surgery.tenantId,
            patientId: surgery.patientId,
            doctorId: surgery.doctorId,
            type: 'control',
            status: 'scheduled',
            startsAt: followUpAt,
            endsAt: followUpEnd,
            notes: `Cerrahi reddi sonrası 3 ay takip (#surgery:${input.surgeryId})`,
            createdById: actor.id,
          },
        });
      } catch (err) {
        this.logger.warn(`auto 3-month follow-up after refusal failed: ${(err as Error).message}`);
      }
    }

    return updated;
  }

  async softDelete(id: string, actor: Actor) {
    const current = await this.findById(id);
    this.assertEditAllowed(current.performedAt, current.doctor.userId, actor);
    await this.prisma.scoped.surgery.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private assertEditAllowed(
    performedAt: Date | null,
    ownerUserId: string | null,
    actor: Actor,
  ): void {
    const isAdmin = actor.roles.includes('yonetici');
    if (isAdmin) return;

    // Visiting prof (no user account) → only admin can edit.
    if (!ownerUserId) {
      throw new ForbiddenException('Only the operating surgeon or yonetici can edit this record');
    }

    const isOwner = actor.id === ownerUserId;
    if (!isOwner) {
      throw new ForbiddenException('Only the operating surgeon or yonetici can edit this record');
    }

    // Same-day window only applies once surgery is performed.
    if (performedAt) {
      const ageMs = Date.now() - new Date(performedAt).getTime();
      if (ageMs > SAME_DAY_WINDOW_MS) {
        throw new BadRequestException('Same-day edit window expired');
      }
    }
  }

  private async assertPatientAndDoctor(patientId: string, doctorId: string): Promise<void> {
    const [patient, doctor] = await Promise.all([
      this.prisma.scoped.patient.findFirst({ where: { id: patientId, deletedAt: null } }),
      this.prisma.scoped.doctor.findFirst({ where: { id: doctorId, deletedAt: null } }),
    ]);
    if (!patient) throw new NotFoundException('Patient not found');
    if (!doctor) throw new NotFoundException('Doctor not found');
  }

  // appointmentId @unique: tek randevu → tek ameliyat. Mevcut bağlanma varsa
  // 400 dön (klinik yanlış flow ile karşılaşmasın diye açık mesaj).
  private async assertAppointmentFree(appointmentId: string): Promise<void> {
    const existing = await this.prisma.scoped.surgery.findUnique({
      where: { appointmentId },
    });
    if (existing) {
      throw new BadRequestException('This appointment already has a surgery');
    }
  }
}

function asMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
