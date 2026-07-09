import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EncounterStage, ServiceCategory } from '@airmed/db';
import { InvoiceService } from '../billing/invoice.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { DOCTOR_WORKLIST_STAGES, isLegalStageTransition } from './encounter.constants';
import type {
  EncounterAdvanceInput,
  EncounterOpenInput,
  EncounterWorklistQuery,
} from './encounter.schemas';

// S15 — Encounter (hasta ziyaret akışı / istasyon yolculuğu).
//
// Appointment.status (takvim) ayrı kalır; Encounter.stage klinik istasyon
// yolculuğunu sürer. Ödeme istasyonları (awaiting_*) assertPaidSession ile
// kapılıdır. Encounter, AppointmentService'e bağımlı DEĞİLDIR (ters yön:
// AppointmentService check-in'de encounter.open çağırır) — döngü olmasın diye
// randevu status senkronu burada doğrudan prisma ile yapılır.

const WORKLIST_INCLUDE = {
  // S15-VIP — Patient.tags VIP-first sıralama için include'a alındı. UI kart
  // üstünde altın rozet vurgulu gösterimi için de gerekli.
  patient: {
    select: { id: true, mrn: true, firstName: true, lastName: true, tags: true, photoUrl: true },
  },
  appointment: { select: { id: true, startsAt: true, type: true, status: true, notes: true } },
  // #1157 — public bekleme monitörü "Dr. X" gösterir (lobi TV). Doctor.name
  // doğrudan alanda (user join gerekmez). worklist/reception için zararsız ek.
  doctor: { select: { id: true, name: true } },
} as const;

/**
 * S15-VIP — VIP tier sıralama: Patient.tags 'vip' içerenler kuyruğun en üstüne
 * çıkar. Mevcut orderBy stage_updated_at vb. tie-breaker olarak kalır.
 * Ali kararı: günlük limit YOK; sebep zorunluluğu YOK; sadece tag bazlı.
 */
// #424 — Triyaj önceliği: acil (isUrgent) hastalar en üstte, sonra VIP, sonra
// mevcut sıra (stage_updated_at vb. tie-breaker olarak korunur).
function sortVipFirst<
  T extends { isUrgent?: boolean; patient?: { tags?: string[] | null } | null },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aU = a.isUrgent ? 1 : 0;
    const bU = b.isUrgent ? 1 : 0;
    if (aU !== bU) return bU - aU;
    const aVip = (a.patient?.tags ?? []).includes('vip') ? 1 : 0;
    const bVip = (b.patient?.tags ?? []).includes('vip') ? 1 : 0;
    return bVip - aVip;
  });
}

// #395 — Ödeme-bekleyen stage'in S12c "önce öde" kategorisi. receptionQueue
// satırının hasPaidSession bayrağı bu kategoride bugünkü paid/partial faturayı arar.
function stagePaymentCategory(stage: EncounterStage): ServiceCategory {
  return stage === 'awaiting_measurement_payment' ? 'measurement' : 'examination';
}

@Injectable()
export class EncounterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly invoice: InvoiceService,
  ) {}

  /**
   * Ziyaret aç. check-in'de (randevulu) veya resepsiyon "ziyaret aç" ile
   * (walk-in) çağrılır. Idempotent: aynı randevu için açık ziyaret varsa onu
   * döner (appointmentId @unique). Açılış stage'i muayene ödemesine bağlı:
   * ödenmişse waiting_doctor (doktora düşer), değilse awaiting_exam_payment.
   */
  async open(input: EncounterOpenInput, actorUserId?: string) {
    const tenantId = this.tenantContext.requireTenantId();
    const tx = this.prisma.scoped;

    if (input.appointmentId) {
      const existing = await tx.encounter.findFirst({
        where: { appointmentId: input.appointmentId, deletedAt: null },
      });
      if (existing) return existing;
    }

    let doctorId = input.doctorId ?? null;
    if (!doctorId && input.appointmentId) {
      const appt = await tx.appointment.findFirst({
        where: { id: input.appointmentId, deletedAt: null },
        select: { doctorId: true },
      });
      doctorId = appt?.doctorId ?? null;
    }

    // Madde 6 — ilk istasyon. Walk-in default 'measurement' (ölçüm odasına);
    // randevu check-in caller'ı 'examination' geçer (eski davranış, doktora).
    const initialStation = input.initialStation ?? 'measurement';
    const stage: EncounterStage =
      initialStation === 'examination'
        ? (await this.invoice.hasPaidSession(input.patientId, 'examination'))
          ? 'waiting_doctor'
          : 'awaiting_exam_payment'
        : (await this.invoice.hasPaidSession(input.patientId, 'measurement'))
          ? 'in_measurement'
          : 'awaiting_measurement_payment';

    return tx.encounter.create({
      data: {
        tenantId,
        patientId: input.patientId,
        appointmentId: input.appointmentId ?? null,
        doctorId,
        stage,
        createdById: actorUserId ?? null,
      },
    });
  }

  /**
   * İstasyon geçişi. Yasal geçiş tablosu + ödeme kapıları uygulanır:
   *  - → waiting_doctor: muayene ödemesi (assertPaidSession 'examination')
   *  - → in_measurement (ödeme istasyonundan): ölçüm ödemesi ('measurement')
   * Geçiş in_exam ise bağlı randevu in_progress'e, done ise completed'a senkronlanır.
   */
  async advance(input: EncounterAdvanceInput) {
    const current = await this.requireEncounter(input.id);
    const to = input.toStage;

    if (current.stage === to) return current;
    if (!isLegalStageTransition(current.stage, to)) {
      throw new BadRequestException(`Geçersiz ziyaret geçişi: ${current.stage} → ${to}`);
    }

    // Ödeme kapıları (yalnız ödeme-bekleme istasyonundan ilerlerken).
    if (current.stage === 'awaiting_exam_payment' && to === 'waiting_doctor') {
      await this.invoice.assertPaidSession(current.patientId, 'examination');
    }
    if (current.stage === 'awaiting_measurement_payment' && to === 'in_measurement') {
      await this.invoice.assertPaidSession(current.patientId, 'measurement');
    }

    // S15-PR26 — 3-hasta hard cap: bir doktorun aynı anda en fazla 3 hastası
    // in_exam'da olabilir. Klinik kalitesi + UX: yarım muayene sorunu önlenir.
    // Geçerli olduğu durum: hasta 'in_exam' state'ine geçirilirken.
    if (to === 'in_exam' && current.doctorId) {
      const activeCount = await this.prisma.scoped.encounter.count({
        where: {
          doctorId: current.doctorId,
          stage: 'in_exam',
          deletedAt: null,
          NOT: { id: current.id },
        },
      });
      if (activeCount >= 3) {
        throw new BadRequestException({
          message: `Bu doktorun şu an ${activeCount} aktif muayenesi var (cap=3). Önce mevcut hastayı bitirin.`,
          messageKey: 'errors.clinic.threePatientCap',
          messageParams: { count: activeCount },
        });
      }
    }

    const updated = await this.prisma.scoped.encounter.update({
      where: { id: input.id },
      data: {
        stage: to,
        stageUpdatedAt: new Date(),
        ...(to === 'done' || to === 'cancelled' ? { closedAt: new Date() } : {}),
      },
    });

    await this.syncAppointmentStatus(current.appointmentId, to);
    return updated;
  }

  /** "Ziyareti kapat" — done istasyonuna ilerletir. */
  close(id: string) {
    return this.advance({ id, toStage: 'done' });
  }

  /**
   * S15-PR5 — Break Glass: acil durumda "önce öde" kuralını bypass et.
   * Stage `emergency_bypass`'a alınır (mevcut state ne olursa olsun);
   * sebep + activatedBy zorunlu audit log; assertPaidSession bu encounter
   * için artık geçer (auto-bill sonradan).
   */
  async activateEmergencyBypass(encounterId: string, reason: string, actorUserId: string) {
    if (!reason || reason.trim().length < 10) {
      throw new BadRequestException('Acil bypass sebebi ≥10 karakter olmalı');
    }
    const current = await this.requireEncounter(encounterId);
    if (current.emergencyBypassActivatedAt && !current.emergencyBypassClosedAt) {
      throw new BadRequestException("Bu ziyaretin bypass'ı zaten aktif");
    }
    const now = new Date();
    return this.prisma.scoped.encounter.update({
      where: { id: encounterId },
      data: {
        stage: 'emergency_bypass',
        stageUpdatedAt: now,
        emergencyBypassReason: reason.trim().slice(0, 500),
        emergencyBypassActivatedAt: now,
        emergencyBypassActivatedBy: actorUserId,
        emergencyBypassClosedAt: null,
        emergencyBypassClosedBy: null,
      },
    });
  }

  /**
   * Bypass'ı kapat ve normal akışa dön. Hedef stage opsiyonel; verilmezse
   * akıllı default uygulanır (henüz muayene yoksa waiting_doctor, varsa done).
   */
  async closeEmergencyBypass(encounterId: string, actorUserId: string, nextStage?: EncounterStage) {
    const current = await this.requireEncounter(encounterId);
    if (!current.emergencyBypassActivatedAt || current.emergencyBypassClosedAt) {
      throw new BadRequestException('Aktif bypass yok');
    }
    const target: EncounterStage = nextStage ?? 'done';
    const now = new Date();
    return this.prisma.scoped.encounter.update({
      where: { id: encounterId },
      data: {
        stage: target,
        stageUpdatedAt: now,
        emergencyBypassClosedAt: now,
        emergencyBypassClosedBy: actorUserId,
        ...(target === 'done' ? { closedAt: now } : {}),
      },
    });
  }

  /** assertPaidSession bypass kontrolü için: hasta için aktif bypass var mı? */
  async hasActiveBypass(patientId: string): Promise<boolean> {
    const found = await this.prisma.scoped.encounter.findFirst({
      where: {
        patientId,
        deletedAt: null,
        emergencyBypassActivatedAt: { not: null },
        emergencyBypassClosedAt: null,
      },
      select: { id: true },
    });
    return found !== null;
  }

  /**
   * "Muayeneye başla" — randevudan köprü. appointmentId'ye bağlı ziyareti bulur
   * ve in_exam'a ilerletir (bağlı randevu in_progress olur). Ziyaret yoksa
   * (örn. check-in yapılmadıysa) NotFound. Doktor randevu detayından / iş
   * kuyruğundan tek tıkla muayeneye geçer.
   */
  async startExamByAppointment(appointmentId: string) {
    const encounter = await this.prisma.scoped.encounter.findFirst({
      where: { appointmentId, deletedAt: null },
      select: { id: true },
    });
    if (!encounter) {
      throw new NotFoundException('Bu randevu için açık ziyaret yok (önce check-in yapın)');
    }
    return this.advance({ id: encounter.id, toStage: 'in_exam' });
  }

  /**
   * Doktor iş kuyruğu — giriş yapan doktorun (User.id) bugünkü aktif ziyaretleri.
   * User.id → Doctor.id çözümü Doctor.userId @unique ile yapılır; profil yoksa
   * (visiting doctor, user hesabı yok) boş liste döner (hata değil). Admin
   * override için query.doctorId verilebilir.
   */
  async findMyWorklist(doctorUserId: string, query: EncounterWorklistQuery) {
    const tx = this.prisma.scoped;

    let doctorId = query.doctorId ?? null;
    if (!doctorId) {
      const profile = await tx.doctor.findFirst({
        where: { userId: doctorUserId, deletedAt: null },
        select: { id: true },
      });
      if (!profile) return [];
      doctorId = profile.id;
    }

    const base = query.date ? new Date(query.date) : new Date();
    const dayStart = new Date(base);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const rows = await tx.encounter.findMany({
      where: {
        doctorId,
        deletedAt: null,
        stage: { in: [...DOCTOR_WORKLIST_STAGES] },
        openedAt: { gte: dayStart, lt: dayEnd },
      },
      include: WORKLIST_INCLUDE,
      // #1152 — asc (eskiden desc): en uzun bekleyen üstte (FIFO). receptionQueue +
      // waitingMonitor ile aynı yön. "Sırada" sekmesi frontend'de acil>VIP>stage>
      // randevu-saati ile yeniden sıralanır; bu asc yalnız "Ölçüm hazır"/"Ödenmemiş"
      // sekmelerinin (frontend re-sort etmez) sırasını doğru (recall'da FIFO) tutar.
      orderBy: { stageUpdatedAt: 'asc' },
    });
    return sortVipFirst(rows);
  }

  // S15-P3 — Daily Huddle widget: bugün için klinik özet (open encounter,
  // şu an in_exam, ölçüm bekleyen, ameliyat satışta, today randevu sayıları).
  async dailyHuddleSummary(): Promise<{
    openEncounters: number;
    inExam: number;
    awaitingMeasurement: number;
    awaitingSurgerySales: number;
    todayAppointments: number;
    activeBypass: number;
  }> {
    const tx = this.prisma.scoped;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const [
      openEncounters,
      inExam,
      awaitingMeasurement,
      awaitingSurgerySales,
      todayAppointments,
      activeBypass,
    ] = await Promise.all([
      tx.encounter.count({
        where: { closedAt: null, deletedAt: null },
      }),
      tx.encounter.count({ where: { stage: 'in_exam', deletedAt: null } }),
      tx.encounter.count({
        where: {
          stage: { in: ['awaiting_measurement_payment', 'in_measurement'] },
          deletedAt: null,
        },
      }),
      tx.encounter.count({ where: { stage: 'awaiting_surgery_sales', deletedAt: null } }),
      tx.appointment.count({
        where: {
          deletedAt: null,
          startsAt: { gte: todayStart, lt: todayEnd },
        },
      }),
      tx.encounter.count({
        where: {
          deletedAt: null,
          emergencyBypassActivatedAt: { not: null },
          emergencyBypassClosedAt: null,
        },
      }),
    ]);

    return {
      openEncounters,
      inExam,
      awaitingMeasurement,
      awaitingSurgerySales,
      todayAppointments,
      activeBypass,
    };
  }

  // S15-P3 — Doctor's Lag Time monitor: doktorun bugünki in_exam ziyaretleri
  // için ortalama ve max stage süreleri (waiting_doctor → in_exam → measurement
  // ya da done). stageUpdatedAt'ten current state'in başlangıcına geçen ms.
  async lagTimeSummary(): Promise<
    Array<{
      doctorId: string;
      doctorName: string | null;
      stage: string;
      count: number;
      avgMinutes: number;
      maxMinutes: number;
    }>
  > {
    const tx = this.prisma.scoped;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const encounters = await tx.encounter.findMany({
      where: {
        deletedAt: null,
        stage: { in: ['waiting_doctor', 'in_exam', 'measurement_ready', 'awaiting_surgery_sales'] },
        openedAt: { gte: todayStart, lt: todayEnd },
      },
      select: {
        doctorId: true,
        stage: true,
        stageUpdatedAt: true,
        doctor: { select: { user: { select: { name: true } } } },
      },
    });

    const now = Date.now();
    const groups = new Map<
      string,
      { doctorId: string; doctorName: string | null; stage: string; mins: number[] }
    >();
    for (const e of encounters) {
      if (!e.doctorId) continue;
      const key = `${e.doctorId}:${e.stage}`;
      const min = Math.round((now - e.stageUpdatedAt.getTime()) / 60000);
      const g = groups.get(key);
      if (g) {
        g.mins.push(min);
      } else {
        groups.set(key, {
          doctorId: e.doctorId,
          doctorName: e.doctor?.user?.name ?? null,
          stage: e.stage,
          mins: [min],
        });
      }
    }

    return Array.from(groups.values()).map((g) => ({
      doctorId: g.doctorId,
      doctorName: g.doctorName,
      stage: g.stage,
      count: g.mins.length,
      avgMinutes: Math.round(g.mins.reduce((s, m) => s + m, 0) / g.mins.length),
      maxMinutes: Math.max(...g.mins),
    }));
  }

  // S15-PR26 — UI rozeti için: doktorun şu anda kaç aktif in_exam'i var.
  async activeExamCountForDoctor(doctorUserId: string): Promise<{
    count: number;
    cap: number;
    isAtCap: boolean;
  }> {
    const tx = this.prisma.scoped;
    const profile = await tx.doctor.findFirst({
      where: { userId: doctorUserId, deletedAt: null },
      select: { id: true },
    });
    if (!profile) return { count: 0, cap: 3, isAtCap: false };
    const count = await tx.encounter.count({
      where: { doctorId: profile.id, stage: 'in_exam', deletedAt: null },
    });
    return { count, cap: 3, isAtCap: count >= 3 };
  }

  async findById(id: string) {
    const encounter = await this.prisma.scoped.encounter.findFirst({
      where: { id, deletedAt: null },
      include: WORKLIST_INCLUDE,
    });
    if (!encounter) throw new NotFoundException('Ziyaret bulunamadı');
    return encounter;
  }

  // Resepsiyon ödeme/yönlendirme kuyruğu — ödeme bekleyen istasyonlardaki bugünkü
  // ziyaretler. Resepsiyon ödeme alınca "Doktora gönder"/"Ölçüme gönder" (advance,
  // assertPaidSession kapılı) ile ilerletir.
  async receptionQueue() {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const rows = await this.prisma.scoped.encounter.findMany({
      where: {
        deletedAt: null,
        stage: { in: ['awaiting_exam_payment', 'awaiting_measurement_payment'] },
        openedAt: { gte: dayStart, lt: dayEnd },
      },
      include: WORKLIST_INCLUDE,
      orderBy: { stageUpdatedAt: 'asc' },
    });
    const sorted = sortVipFirst(rows);

    // #395 — Çift-fatura koruması: resepsiyon tahsilatı aldıysa (bugün ilgili
    // kategoride paid/partial fatura) ama henüz "Gönder" ile advance etmediyse
    // satır hâlâ awaiting_*_payment stage'inde durur. hasPaidSession bayrağı UI'a
    // "tahsilat alındı, ikinci fatura kesme" sinyali verir (stage→kategori: exam
    // payment→examination, measurement payment→measurement). Tek bulk sorgu.
    const pairs = sorted.map((r) => ({
      patientId: r.patientId,
      category: stagePaymentCategory(r.stage),
    }));
    const paidSet = await this.invoice.hasPaidSessionsBulk(pairs);
    return sorted.map((r) => ({
      ...r,
      hasPaidSession: paidSet.has(`${r.patientId}::${stagePaymentCategory(r.stage)}`),
    }));
  }

  // #412 — Lobby TV bekleme monitörü: bugünkü terminal-olmayan (done/cancelled
  // hariç) TÜM aktif istasyonlardaki ziyaretler. receptionQueue yalnız ödeme
  // bekleyenleri gösterir; TV ekranı bütün bekleme tablosunu ister. hasPaidSession
  // zenginleştirmesi YOK (o resepsiyona özel) — sadece sıralı satırlar döner.
  async waitingMonitor() {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const rows = await this.prisma.scoped.encounter.findMany({
      where: {
        deletedAt: null,
        stage: { notIn: ['done', 'cancelled'] },
        openedAt: { gte: dayStart, lt: dayEnd },
      },
      include: WORKLIST_INCLUDE,
      orderBy: { stageUpdatedAt: 'asc' },
    });
    return sortVipFirst(rows);
  }

  // Hastanın o anki aktif (terminal olmayan) ziyareti — en yeni açılan. Ölçüm
  // sipariş / cerrahi devir gibi hook'lar "bu hastanın yolculuğunu ilerlet" için
  // kullanır. Yoksa null (walk-in / ziyaret açılmamış).
  findActiveByPatient(patientId: string) {
    return this.prisma.scoped.encounter.findFirst({
      where: { patientId, deletedAt: null, stage: { notIn: ['done', 'cancelled'] } },
      orderBy: { openedAt: 'desc' },
      select: { id: true, stage: true },
    });
  }

  // #424 — Triyaj: ziyareti acil/normal işaretle (kuyruk önceliği). Acil hasta
  // sortVipFirst ile en üste çıkar. reason yalnız acil işaretlerken anlamlı.
  async setUrgent(id: string, isUrgent: boolean, reason: string | null) {
    await this.requireEncounter(id);
    return this.prisma.scoped.encounter.update({
      where: { id },
      data: { isUrgent, urgentReason: isUrgent ? reason : null },
      select: { id: true, isUrgent: true, urgentReason: true },
    });
  }

  private async requireEncounter(id: string) {
    const encounter = await this.prisma.scoped.encounter.findFirst({
      where: { id, deletedAt: null },
    });
    if (!encounter) throw new NotFoundException('Ziyaret bulunamadı');
    return encounter;
  }

  // Encounter → Appointment status senkronu (döngü olmaması için doğrudan prisma).
  // Yalnız yasal randevu geçişlerini uygular; aksi halde sessizce atlar.
  private async syncAppointmentStatus(appointmentId: string | null, stage: EncounterStage) {
    if (!appointmentId) return;
    const target = stage === 'in_exam' ? 'in_progress' : stage === 'done' ? 'completed' : null;
    if (!target) return;

    const appt = await this.prisma.scoped.appointment.findFirst({
      where: { id: appointmentId, deletedAt: null },
      select: { status: true },
    });
    if (!appt) return;

    const legal =
      (target === 'in_progress' && appt.status === 'checked_in') ||
      (target === 'completed' && (appt.status === 'checked_in' || appt.status === 'in_progress'));
    if (!legal) return;

    await this.prisma.scoped.appointment.update({
      where: { id: appointmentId },
      data: { status: target },
    });
  }
}
