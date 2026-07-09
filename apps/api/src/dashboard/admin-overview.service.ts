import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

// S16 — Yönetici "Genel Bakış" (dashboard overview) aggregate servisi.
//
// Tek sorguda ekranın tüm verisi: 4 KPI (bugün muayene / bugünkü tahsilat +
// dünden delta / aktif ameliyat satışı / onay bekleyen indirim) + Bekleyen
// İndirim Onayları listesi + Kritik Stok (IOL düşük-stok modelleri + sarf
// malzeme) + Lens İhtiyacı (planlı ameliyatların lens tipine göre talebi).
//
// Hepsi tenant-scoped (prisma.scoped, RLS). Onay/Reddet aksiyonları ayrı
// `approval.review` mutation'ı ile yürür; bu servis salt-okumadır.

const ACTIVE_INVOICE_STATUSES = [
  'open',
  'partial',
  'paid',
  'pending_approval',
] satisfies import('@airmed/db').InvoiceStatus[];

// Lens İhtiyacı paneli sıralaması (klinik düzen, alfabetik değil).
const LENS_TYPE_ORDER = ['monofocal', 'trifocal', 'edof', 'toric'];
const lensTypeRank = (t: string): number => {
  const i = LENS_TYPE_ORDER.indexOf(t);
  return i === -1 ? LENS_TYPE_ORDER.length : i;
};

const LENS_CODE: Record<string, string> = {
  monofocal: 'LNS-MONO',
  trifocal: 'LNS-TRI',
  edof: 'LNS-EDOF',
  toric: 'LNS-TORIC',
};

export interface AdminOverviewApproval {
  id: string;
  patientName: string;
  surgeryType: string | null;
  requestedByName: string | null;
  reason: string;
  createdAt: string;
  discountPercent: string;
  listAmount: string;
  discountedAmount: string | null;
  lossAmount: string;
  currency: string;
}

export interface AdminOverviewLowStock {
  id: string;
  kind: 'iol' | 'consumable';
  lensType: string | null;
  name: string | null;
  availableQty: number;
  minQty: number;
}

export interface AdminOverviewLensNeed {
  lensType: string;
  neededCount: number;
  availableQty: number;
}

export interface StockRow {
  lensType: string | null;
  name: string | null;
  code: string;
  total: number;
  reserved: number;
  available: number;
  unit: string;
  minQty: number;
  low: boolean;
}

export interface StockOverviewDTO {
  clinicName: string;
  lenses: StockRow[];
  supplies: StockRow[];
  drugs: StockRow[];
}

export interface AdminOverviewDTO {
  clinicName: string;
  todayExaminations: number;
  todayCollected: { amount: string; currency: string; deltaPercent: number | null };
  activeSurgerySales: number;
  pendingApprovalCount: number;
  pendingApprovals: AdminOverviewApproval[];
  lowStock: AdminOverviewLowStock[];
  lensNeeds: AdminOverviewLensNeed[];
}

@Injectable()
export class AdminOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getOverview(): Promise<AdminOverviewDTO> {
    const tenantId = this.tenantContext.requireTenantId();

    const now = new Date();
    const todayStart = startOfDay(now);
    const tomorrowStart = addDays(todayStart, 1);
    const yesterdayStart = addDays(todayStart, -1);
    const horizon = addDays(todayStart, 30);

    const [
      tenant,
      todayExaminations,
      todaySum,
      yesterdaySum,
      activeSurgerySales,
      pendingApprovalCount,
      pendingApprovals,
      lowStock,
      lensNeeds,
    ] = await Promise.all([
      this.prisma.scoped.tenant.findFirst({ where: { id: tenantId }, select: { name: true } }),
      this.prisma.scoped.examination.count({
        where: { deletedAt: null, examinedAt: { gte: todayStart, lt: tomorrowStart } },
      }),
      this.sumCollected(todayStart, tomorrowStart),
      this.sumCollected(yesterdayStart, todayStart),
      this.countActiveSurgerySales(),
      this.prisma.scoped.discountApproval.count({ where: { status: 'pending' } }),
      this.listPendingApprovals(5),
      this.lowStock(),
      this.lensNeeds(todayStart, horizon),
    ]);

    const deltaPercent = yesterdaySum.gt(0)
      ? Math.round(todaySum.minus(yesterdaySum).div(yesterdaySum).mul(100).toNumber())
      : null;

    return {
      clinicName: tenant?.name ?? '',
      todayExaminations,
      // Delta audit C-18 takip: `sumCollected` payment.tjsEquivalent topluyor —
      // currency: 'TJS' etiketi aggregation birimini ifade eder, klinik default
      // para birimi ile karıştırılmamalı. USD klinik için bile dashboard rakamı
      // TJS karşılığıdır (raporlama tutarlılığı için).
      todayCollected: { amount: todaySum.toFixed(2), currency: 'TJS', deltaPercent },
      activeSurgerySales,
      pendingApprovalCount,
      pendingApprovals,
      lowStock,
      lensNeeds,
    };
  }

  // İndirim Onay Talepleri sayfası — TÜM bekleyen talepler (cap yok; inbox
  // hiçbir talebi gizlememeli) + klinik adı (sayfa başlığı). Reason dahil.
  async getPendingApprovalsPage(): Promise<{
    clinicName: string;
    items: AdminOverviewApproval[];
  }> {
    const tenantId = this.tenantContext.requireTenantId();
    const [tenant, items] = await Promise.all([
      this.prisma.scoped.tenant.findFirst({ where: { id: tenantId }, select: { name: true } }),
      this.listPendingApprovals(),
    ]);
    return { clinicName: tenant?.name ?? '', items };
  }

  // Stok & Malzeme Takibi sayfası — Lensler (IOL modeli, lot toplamı) + Sarf
  // Malzeme (consumable category!='drug') + İlaç (category='drug'). Her satır:
  // toplam / rezerve / kullanılabilir / minQty / düşük-mü.
  async getStockOverview(): Promise<StockOverviewDTO> {
    const tenantId = this.tenantContext.requireTenantId();
    const [tenant, models, consumables] = await Promise.all([
      this.prisma.scoped.tenant.findFirst({ where: { id: tenantId }, select: { name: true } }),
      this.prisma.scoped.iolModel.findMany({
        where: { deletedAt: null, isActive: true },
        select: {
          lensType: true,
          minQty: true,
          lots: {
            where: { deletedAt: null },
            select: { availableQty: true, reservedQty: true, quantity: true },
          },
        },
      }),
      this.prisma.scoped.consumable.findMany({
        where: { deletedAt: null, isActive: true },
        select: {
          name: true,
          code: true,
          category: true,
          unit: true,
          availableQty: true,
          reservedQty: true,
          minQty: true,
        },
        orderBy: { name: 'asc' },
      }),
    ]);

    const lenses: StockRow[] = models
      .map((m) => {
        const available = m.lots.reduce((s, l) => s + l.availableQty, 0);
        const reserved = m.lots.reduce((s, l) => s + l.reservedQty, 0);
        const total = m.lots.reduce((s, l) => s + l.quantity, 0);
        return {
          lensType: m.lensType,
          name: null,
          code: LENS_CODE[m.lensType] ?? 'LNS',
          total,
          reserved,
          available,
          unit: 'adet',
          minQty: m.minQty,
          low: m.minQty > 0 && available <= m.minQty,
        };
      })
      .sort((a, b) => lensTypeRank(a.lensType ?? '') - lensTypeRank(b.lensType ?? ''));

    const toRow = (c: {
      name: string;
      code: string | null;
      unit: string | null;
      availableQty: number;
      reservedQty: number;
      minQty: number;
    }): StockRow => ({
      lensType: null,
      name: c.name,
      code: c.code ?? '',
      total: c.availableQty + c.reservedQty,
      reserved: c.reservedQty,
      available: c.availableQty,
      unit: c.unit ?? 'adet',
      minQty: c.minQty,
      low: c.minQty > 0 && c.availableQty <= c.minQty,
    });

    return {
      clinicName: tenant?.name ?? '',
      lenses,
      supplies: consumables.filter((c) => c.category !== 'drug').map(toRow),
      drugs: consumables.filter((c) => c.category === 'drug').map(toRow),
    };
  }

  // -------------------- KPI helpers --------------------

  // Para toplamı Decimal kalır (Number'a çevirip toFixed → precision/rounding
  // kaybı riski). tjsEquivalent her zaman TJS karşılığı.
  private async sumCollected(from: Date, to: Date): Promise<Prisma.Decimal> {
    const agg = await this.prisma.scoped.payment.aggregate({
      _sum: { tjsEquivalent: true },
      where: { deletedAt: null, refundedAt: null, takenAt: { gte: from, lt: to } },
    });
    return agg._sum.tjsEquivalent ?? new Prisma.Decimal(0);
  }

  // "Aktif ameliyat satışı" = satış hattına girmiş planlı ameliyatlar
  // (salesPipeline'da pipelineStatus != 'new'). 'paid'/'partial' = planlandı
  // (satıldı, ameliyat henüz yapılmadı → planned), bu yüzden aktif satış sayılır;
  // ameliyat 'performed' olunca status != planned → otomatik düşer.
  private countActiveSurgerySales(): Promise<number> {
    // #1062 — count DB'de: eskiden tüm planlı cerrahiler + faturaları çekilip
    // JS'te filter+length yapılıyordu (yönetici Genel Bakış her refetch'te).
    return this.prisma.scoped.surgery.count({
      where: {
        status: 'planned',
        deletedAt: null,
        invoices: {
          some: { deletedAt: null, status: { in: [...ACTIVE_INVOICE_STATUSES] } },
        },
      },
    });
  }

  // -------------------- Bekleyen İndirim Onayları --------------------

  private async listPendingApprovals(limit?: number): Promise<AdminOverviewApproval[]> {
    const approvals = await this.prisma.scoped.discountApproval.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    if (approvals.length === 0) return [];

    const invoiceIds = approvals.map((a) => a.invoiceId).filter((v): v is string => !!v);
    const surgeryIdsDirect = approvals.map((a) => a.surgeryId).filter((v): v is string => !!v);

    const invoices = invoiceIds.length
      ? await this.prisma.scoped.invoice.findMany({
          where: { id: { in: invoiceIds } },
          select: {
            id: true,
            total: true,
            currency: true,
            patientId: true,
            surgeryId: true,
          },
        })
      : [];
    const invoiceMap = new Map(invoices.map((i) => [i.id, i]));

    const surgeryIds = [
      ...new Set([
        ...surgeryIdsDirect,
        ...invoices.map((i) => i.surgeryId).filter((v): v is string => !!v),
      ]),
    ];
    const surgeries = surgeryIds.length
      ? await this.prisma.scoped.surgery.findMany({
          where: { id: { in: surgeryIds } },
          select: { id: true, type: true, patientId: true },
        })
      : [];
    const surgeryMap = new Map(surgeries.map((s) => [s.id, s]));

    const patientIds = [
      ...new Set([...invoices.map((i) => i.patientId), ...surgeries.map((s) => s.patientId)]),
    ];
    const patients = patientIds.length
      ? await this.prisma.scoped.patient.findMany({
          where: { id: { in: patientIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const patientMap = new Map(patients.map((p) => [p.id, p]));

    const requesterIds = [...new Set(approvals.map((a) => a.requestedById))];
    const requesters = await this.prisma.scoped.user.findMany({
      where: { id: { in: requesterIds } },
      select: { id: true, name: true },
    });
    const requesterMap = new Map(requesters.map((u) => [u.id, u]));

    return approvals.map((a) => {
      const invoice = a.invoiceId ? invoiceMap.get(a.invoiceId) : undefined;
      // Onayın kendi surgeryId'si otoriter (indirim hangi cerrahiye ait); fatura
      // surgeryId'sine yalnız onayda yoksa düş.
      const surgeryId = a.surgeryId ?? invoice?.surgeryId ?? null;
      const surgery = surgeryId ? surgeryMap.get(surgeryId) : undefined;
      const patientId = invoice?.patientId ?? surgery?.patientId ?? null;
      const patient = patientId ? patientMap.get(patientId) : undefined;
      const requester = requesterMap.get(a.requestedById);

      const discounted = invoice ? (invoice.total as Prisma.Decimal) : null;
      // Liste (orijinal) = indirimli + indirim tutarı. Fatura yoksa percent'ten türet.
      const list = discounted
        ? discounted.plus(a.discountAmount)
        : a.discountPercent.gt(0)
          ? a.discountAmount.mul(100).div(a.discountPercent)
          : a.discountAmount;

      return {
        id: a.id,
        patientName: patient ? `${patient.firstName} ${patient.lastName}`.trim() : '—',
        surgeryType: surgery?.type ?? null,
        requestedByName: requester?.name ?? null,
        reason: a.reason,
        createdAt: a.createdAt.toISOString(),
        discountPercent: a.discountPercent.toFixed(2),
        listAmount: list.toFixed(2),
        discountedAmount: discounted ? discounted.toFixed(2) : null,
        lossAmount: a.discountAmount.toFixed(2),
        currency: invoice?.currency ?? 'TJS',
      };
    });
  }

  // -------------------- Kritik Stok --------------------

  private async lowStock(): Promise<AdminOverviewLowStock[]> {
    const [models, consumables] = await Promise.all([
      this.prisma.scoped.iolModel.findMany({
        where: { deletedAt: null, isActive: true, minQty: { gt: 0 } },
        select: {
          id: true,
          lensType: true,
          minQty: true,
          lots: { where: { deletedAt: null }, select: { availableQty: true } },
        },
      }),
      this.prisma.scoped.consumable.findMany({
        where: { deletedAt: null, isActive: true, minQty: { gt: 0 } },
        select: { id: true, name: true, availableQty: true, minQty: true },
      }),
    ]);

    const iolLow: AdminOverviewLowStock[] = models
      .map((m) => ({
        id: m.id,
        kind: 'iol' as const,
        lensType: m.lensType,
        name: null,
        availableQty: m.lots.reduce((sum, l) => sum + l.availableQty, 0),
        minQty: m.minQty,
      }))
      .filter((m) => m.availableQty <= m.minQty);

    const consumableLow: AdminOverviewLowStock[] = consumables
      .filter((c) => c.availableQty <= c.minQty)
      .map((c) => ({
        id: c.id,
        kind: 'consumable' as const,
        lensType: null,
        name: c.name,
        availableQty: c.availableQty,
        minQty: c.minQty,
      }));

    // En kritik (ihtiyaç-altı en derin) önce. Liste zaten availableQty <= minQty
    // ile filtreli → açık (minQty - availableQty) negatif olamaz.
    return [...iolLow, ...consumableLow].sort(
      (a, b) => b.minQty - b.availableQty - (a.minQty - a.availableQty),
    );
  }

  // -------------------- Lens İhtiyacı (forecast by type) --------------------

  private async lensNeeds(from: Date, to: Date): Promise<AdminOverviewLensNeed[]> {
    const preOps = await this.prisma.scoped.preOp.findMany({
      where: {
        deletedAt: null,
        lensIolLotId: { not: null },
        surgery: { deletedAt: null, status: 'planned', scheduledAt: { gte: from, lt: to } },
      },
      select: { lensIolLot: { select: { model: { select: { lensType: true } } } } },
    });
    if (preOps.length === 0) return [];

    const neededByType = new Map<string, number>();
    for (const p of preOps) {
      const type = p.lensIolLot?.model.lensType;
      if (!type) continue;
      neededByType.set(type, (neededByType.get(type) ?? 0) + 1);
    }

    // İlgili tiplerin toplam mevcut stoğu (aktif lotlar).
    const lots = await this.prisma.scoped.iolLot.findMany({
      where: { deletedAt: null, model: { deletedAt: null, isActive: true } },
      select: { availableQty: true, model: { select: { lensType: true } } },
    });
    const availByType = new Map<string, number>();
    for (const l of lots) {
      const type = l.model.lensType;
      availByType.set(type, (availByType.get(type) ?? 0) + l.availableQty);
    }

    return [...neededByType.entries()]
      .map(([lensType, neededCount]) => ({
        lensType,
        neededCount,
        availableQty: availByType.get(lensType) ?? 0,
      }))
      .sort((a, b) => lensTypeRank(a.lensType) - lensTypeRank(b.lensType));
  }
}

// -------------------- date helpers --------------------

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
