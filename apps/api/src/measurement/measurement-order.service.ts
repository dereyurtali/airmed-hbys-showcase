import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceService } from '../billing/invoice.service';
import { EncounterService } from '../encounter/encounter.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { SyncGateway } from '../sync/sync.gateway';
import { TenantContextService } from '../tenant/tenant-context.service';
import { MeasurementService } from './measurement.service';
import type {
  MeasurementOrderCreateInput,
  MeasurementOrderDeferInput,
  MeasurementOrderFulfillInput,
  MeasurementOrderListQuery,
} from './measurement-order.schemas';

// S15c — MeasurementOrder (ölçüm sipariş akışı).
//
// createOrder (doktor): ücretliyse encounter → awaiting_measurement_payment +
// resepsiyona bildirim; değilse → in_measurement + ölçüm birimine (hemşire)
// bildirim. fulfill (hemşire/doktor): Measurement kayıtları yaratır (komisyon
// hook'u dahil), order → fulfilled, encounter → measurement_ready, isteyen
// doktora "sonuçlar düştü" bildirimi. Ödeme kapısı fulfill'de de doğrulanır.

interface Actor {
  id: string;
  roles: readonly string[];
}

const ACTIVE_STATUSES = ['requested', 'awaiting_payment', 'in_progress'] as const;

@Injectable()
export class MeasurementOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly measurements: MeasurementService,
    private readonly notifications: NotificationService,
    private readonly invoice: InvoiceService,
    private readonly encounters: EncounterService,
    // S15-PR12 — WS broadcast: 'measurement.ready' tenant room'a
    private readonly syncGateway: SyncGateway,
  ) {}

  async createOrder(
    input: MeasurementOrderCreateInput,
    actor: Actor,
    // #363 — asistan hemşire acting-on-behalf girerse talep asiste edilen
    // doktora atfedilir (orderedById = hemşire kalır; doctorId = acting doktor).
    actingDoctorUserId?: string,
  ) {
    const tenantId = this.tenantContext.requireTenantId();
    const doctorProfile = await this.prisma.scoped.doctor.findFirst({
      where: { userId: actingDoctorUserId ?? actor.id, deletedAt: null },
      select: { id: true },
    });
    const requiresPayment = (input.serviceItemIds?.length ?? 0) > 0;

    const order = await this.prisma.scoped.measurementOrder.create({
      data: {
        tenantId,
        encounterId: input.encounterId ?? null,
        patientId: input.patientId,
        orderedById: actor.id,
        doctorId: doctorProfile?.id ?? null,
        requestedTypes: input.requestedTypes,
        serviceItemIds: input.serviceItemIds ?? [],
        requiresPayment,
        status: requiresPayment ? 'awaiting_payment' : 'requested',
        notes: input.notes ?? null,
      },
    });

    // İstasyon yönlendirmesi: ücretliyse kasaya, değilse ölçüm odasına.
    if (input.encounterId) {
      await this.encounters.advance({
        id: input.encounterId,
        toStage: requiresPayment ? 'awaiting_measurement_payment' : 'in_measurement',
      });
    }

    // Bildirim: ücretliyse resepsiyon, değilse ölçüm birimi. #363 — ölçüm
    // bildirimi hem klasik `hemsire` hem de kilitli istasyondaki
    // `olcum_hemsiresi` rolüne düşer (eskiden yalnız hemsire alıyordu).
    const payload = {
      encounterId: input.encounterId ?? undefined,
      patientId: input.patientId,
      orderId: order.id,
    };
    if (requiresPayment) {
      await this.notifications.createForRole('resepsiyon', {
        type: 'measurement_payment_due',
        title: 'Ölçüm ödemesi bekliyor',
        body: 'Doktor ölçüm istedi — tahsilat sonrası ölçüm odasına yönlendirin.',
        payload,
      });
    } else {
      for (const role of ['hemsire', 'olcum_hemsiresi'] as const) {
        await this.notifications.createForRole(role, {
          type: 'measurement_ordered',
          title: 'Yeni ölçüm isteği',
          body: 'Doktor ölçüm istedi.',
          payload,
        });
      }
    }

    // #363 — WS: yeni talebi ölçüm istasyonu kuyruğuna anında düşür (ücretli/
    // ücretsiz fark etmez; awaiting_payment talep de kuyrukta rozetiyle görünür).
    this.syncGateway.broadcastMeasurementOrdered({
      tenantId,
      patientId: input.patientId,
      orderId: order.id,
    });

    return order;
  }

  async fulfill(input: MeasurementOrderFulfillInput, actor: Actor) {
    const order = await this.requireOrder(input.orderId);

    // Ödeme kapısı (defense in depth): ücretli ölçüm ödenmeden sonuç bırakılamaz.
    if (order.requiresPayment) {
      await this.invoice.assertPaidSession(order.patientId, 'measurement');
    }

    // #1063 — order bağı create'te set edilir; kayıt başına ikinci UPDATE kalktı.
    for (const m of input.measurements) {
      await this.measurements.create(
        {
          patientId: order.patientId,
          type: m.type,
          eyeSide: m.eyeSide,
          values: m.values,
          measuredAt: m.measuredAt ?? new Date().toISOString(),
          notes: m.notes ?? null,
        },
        actor,
        { measurementOrderId: order.id },
      );
    }

    const updated = await this.prisma.scoped.measurementOrder.update({
      where: { id: order.id },
      data: { status: 'fulfilled', fulfilledById: actor.id, fulfilledAt: new Date() },
    });

    if (order.encounterId) {
      await this.encounters.advance({ id: order.encounterId, toStage: 'measurement_ready' });
    }

    // "Sonuçlar düştü" — isteyen doktora bildirim.
    await this.notifications.create({
      recipientUserId: order.orderedById,
      type: 'measurement_ready',
      title: 'Ölçüm sonuçları hazır',
      body: 'İstediğiniz ölçümlerin sonuçları girildi.',
      payload: {
        encounterId: order.encounterId ?? undefined,
        patientId: order.patientId,
        orderId: order.id,
      },
    });

    // S15-PR12 — WebSocket broadcast: tenant room'daki tüm clientlar
    // 'measurement.ready' event'i alır; doktor frontend'i kendi userId'si
    // ile karşılaştırıp encounter.myWorklist invalidate + glow/toast tetikler.
    const tenantId = this.tenantContext.requireTenantId();
    this.syncGateway.broadcastMeasurementReady({
      tenantId,
      patientId: order.patientId,
      doctorUserId: order.orderedById,
      encounterId: order.encounterId ?? null,
      orderId: order.id,
    });

    return updated;
  }

  // Ölçüm birimi kuyruğu — terminal olmayan siparişler. S16: ölçüm hemşiresi
  // iki-panel ekranı için zenginleştirilmiş include (hasta yaş/cinsiyet, randevu
  // sebebi/saati, girilmiş ölçümler) + isteyen doktor adı (Doctor.id → name,
  // relation yok → batch lookup). completedToday: bugün fulfilled (salt-okunur).
  async listForUnit(query: MeasurementOrderListQuery) {
    const include = {
      patient: {
        select: {
          id: true,
          mrn: true,
          firstName: true,
          lastName: true,
          birthDate: true,
          gender: true,
        },
      },
      encounter: {
        select: {
          id: true,
          stage: true,
          appointment: { select: { notes: true, startsAt: true, type: true } },
        },
      },
      measurements: {
        where: { deletedAt: null },
        select: { id: true, type: true, eyeSide: true, values: true, measuredAt: true },
      },
    };

    // #376 — Tip filtresi: requestedTypes[] içinde seçilen tip varsa döner.
    const typeFilter = query.requestedType ? { requestedTypes: { has: query.requestedType } } : {};

    let orders;
    if (query.completedToday) {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      orders = await this.prisma.scoped.measurementOrder.findMany({
        where: {
          deletedAt: null,
          status: 'fulfilled',
          fulfilledAt: { gte: dayStart, lt: dayEnd },
          ...typeFilter,
        },
        include,
        orderBy: { fulfilledAt: 'desc' },
      });
    } else {
      orders = await this.prisma.scoped.measurementOrder.findMany({
        where: {
          deletedAt: null,
          status: query.status ? query.status : { in: [...ACTIVE_STATUSES] },
          ...typeFilter,
        },
        include,
        orderBy: { createdAt: 'asc' },
      });
    }

    // İsteyen doktor adı (detay başlığı). MeasurementOrder.doctorId scalar (relation
    // yok), batch ile çöz; null doctorId atlanır.
    const doctorIds = [
      ...new Set(orders.map((o) => o.doctorId).filter((id): id is string => !!id)),
    ];
    const doctors = doctorIds.length
      ? await this.prisma.scoped.doctor.findMany({
          where: { id: { in: doctorIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(doctors.map((d) => [d.id, d.name]));
    return orders.map((o) => ({
      ...o,
      doctorName: o.doctorId ? (nameById.get(o.doctorId) ?? null) : null,
    }));
  }

  // R2 (#724) — "Resepsiyona bildir": ölçüm hemşiresi ödeme-bekleyen bir talebi
  // gördüğünde (hasta ölçüm odasında ama tahsilat yapılmamış) resepsiyonu yeniden
  // uyarır. Order create'te otomatik bildirim zaten gider; bu manuel nudge.
  async notifyReceptionForPayment(orderId: string) {
    const order = await this.requireOrder(orderId);
    if (order.status !== 'awaiting_payment') {
      throw new BadRequestException('Bu talep ödeme beklemiyor');
    }
    const patient = await this.prisma.scoped.patient.findFirst({
      where: { id: order.patientId, deletedAt: null },
      select: { firstName: true, lastName: true, mrn: true },
    });
    const who = patient ? `${patient.firstName} ${patient.lastName} (${patient.mrn})` : 'Hasta';
    await this.notifications.createForRole('resepsiyon', {
      type: 'measurement_payment_due',
      title: 'Ölçüm ödemesi bekliyor — hasta odada',
      body: `${who} ölçüm odasında ama tahsilat yapılmadı. Lütfen tahsilatı tamamlayın.`,
      payload: { patientId: order.patientId, orderId: order.id },
    });
    return { ok: true as const };
  }

  // R2 (#724) — "Ertele/Skip": ölçüm hemşiresi hazır olmayan talebi erteler
  // (hasta gelmedi / cihaz meşgul). Aktif kuyruktan çıkar (status='deferred');
  // sebep notlara timestamp'li eklenir (audit + "Ertelenenler" görünümünde okunur).
  async defer(input: MeasurementOrderDeferInput) {
    const order = await this.requireOrder(input.orderId);
    if (!['requested', 'awaiting_payment', 'in_progress'].includes(order.status)) {
      throw new BadRequestException('Yalnız aktif (bekleyen) talep ertelenebilir');
    }
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const note = `[Ertelendi ${stamp}] ${input.reason}`;
    return this.prisma.scoped.measurementOrder.update({
      where: { id: input.orderId },
      data: {
        status: 'deferred',
        notes: order.notes ? `${order.notes}\n${note}` : note,
      },
    });
  }

  // R2 (#724) — Ertelenmiş talebi geri al: aktif kuyruğa döner. Ücretliyse
  // tekrar ödeme bekler (awaiting_payment), değilse requested.
  async resume(orderId: string) {
    const order = await this.requireOrder(orderId);
    if (order.status !== 'deferred') {
      throw new BadRequestException('Yalnız ertelenmiş talep geri alınabilir');
    }
    return this.prisma.scoped.measurementOrder.update({
      where: { id: orderId },
      data: { status: order.requiresPayment ? 'awaiting_payment' : 'requested' },
    });
  }

  private async requireOrder(id: string) {
    const order = await this.prisma.scoped.measurementOrder.findFirst({
      where: { id, deletedAt: null },
    });
    if (!order) throw new NotFoundException('Ölçüm siparişi bulunamadı');
    return order;
  }
}
