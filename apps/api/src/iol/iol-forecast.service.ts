import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// S15-PR22 — Yönetici stok tahmin servisi. Önümüzdeki N gün için planlanan
// ameliyatların PreOp'ta seçilmiş lenslerini topla → ihtiyaç matrisi.
// Available + reserved ile karşılaştır → kritik uyarı.

export interface ForecastRow {
  lotId: string;
  modelName: string;
  lotNumber: string;
  power: string;
  neededCount: number;
  availableQty: number;
  reservedQty: number;
  consumedQty: number;
  expiresAt: string;
  gap: number; // available - needed; negative = kritik
  isCritical: boolean;
}

export interface UnassignedLensType {
  surgeryType: string;
  count: number;
}

// #364 — Lens implantı gerektiren cerrahi tipleri (forecast tip-bazlı beslemesi).
// Lens lotu pre-op'ta seçilmemiş planlı ameliyatları yine de "ihtiyaç" olarak
// göstermek için. Anahtar kelime sezgiseli seed tiplerini güvenle kapsar:
// "Katarakt (Fako + Trifocal IOL)", "Phacoemulsification + IOL" vb.
const LENS_SURGERY_KEYWORDS = [
  'iol',
  'lens',
  'katarakt',
  'cataract',
  'fako',
  'phaco',
  'trifocal',
  'monofocal',
  'edof',
];

export function surgeryTypeNeedsLens(type: string | null | undefined): boolean {
  if (!type) return false;
  const lower = type.toLowerCase();
  return LENS_SURGERY_KEYWORDS.some((kw) => lower.includes(kw));
}

export interface ConsumptionReportRow {
  modelId: string;
  modelName: string;
  consumedCount: number;
}
export interface ConsumptionReportMonth {
  month: string; // 'YYYY-MM'
  total: number;
  byModel: ConsumptionReportRow[];
}

@Injectable()
export class IolForecastService {
  constructor(private readonly prisma: PrismaService) {}

  // #372 — Geriye dönük IOL tüketim raporu (IolStockMovement type=consume).
  // Son `months` ayın her biri için toplam + model bazında tüketim. Eskiden
  // listMovements (lot bazlı) vardı ama hiçbir UI raporu tüketmiyordu.
  async consumptionReport(months: number): Promise<{ months: ConsumptionReportMonth[] }> {
    const since = new Date();
    since.setMonth(since.getMonth() - months + 1);
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    // #1062 — ay × model toplamı DB'de: eskiden tüm consume hareketleri Node'a
    // çekilip JS'te bucket'lanıyordu. Ay anahtarı eski JS bucketing ile birebir
    // aynı kalsın diye server TZ'ine çevrilir (kolonlar UTC saklanır).
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const rows = await this.prisma.scoped.$queryRaw<
      { month: string; modelId: string; modelName: string; count: number }[]
    >`
      SELECT to_char((m."created_at" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM') AS month,
             l."model_id" AS "modelId",
             md."brand" || ' ' || md."model" AS "modelName",
             SUM(ABS(m."quantity"))::int AS count
      FROM "iol_stock_movements" m
      JOIN "iol_lots" l ON l."id" = m."lot_id"
      JOIN "iol_models" md ON md."id" = l."model_id"
      WHERE m."type" = 'consume' AND m."created_at" >= ${since}
      GROUP BY 1, 2, 3
    `;

    const byMonth = new Map<string, ConsumptionReportRow[]>();
    for (const r of rows) {
      const list = byMonth.get(r.month) ?? [];
      list.push({ modelId: r.modelId, modelName: r.modelName, consumedCount: r.count });
      byMonth.set(r.month, list);
    }
    const result: ConsumptionReportMonth[] = [...byMonth.entries()]
      .map(([month, byModel]) => {
        byModel.sort((a, b) => b.consumedCount - a.consumedCount);
        return { month, total: byModel.reduce((s, r) => s + r.consumedCount, 0), byModel };
      })
      .sort((a, b) => b.month.localeCompare(a.month));

    return { months: result };
  }

  async forecastDays(days: number): Promise<{
    horizonDays: number;
    totalPlanned: number;
    rows: ForecastRow[];
    unassignedLensCount: number;
    unassignedByType: UnassignedLensType[];
  }> {
    const now = new Date();
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + days);

    // #364 — Tip-bazlı feed: lens implantı gerektiren planlı ameliyatlardan
    // pre-op'ta lens lotu seçilmemiş olanları say. Eskiden lot seçilmemişse
    // ihtiyaç 0 görünüyordu (açıklamasız) → yönetici "5 katarakt var ama 2'sine
    // lens atanmış" göremiyordu. Tek sorgu: planlı cerrahiler + pre-op lot.
    const plannedSurgeries = await this.prisma.scoped.surgery.findMany({
      where: { deletedAt: null, status: 'planned', scheduledAt: { gte: now, lt: horizon } },
      // preOpRecord = PreOp ilişkisi (Surgery.preOp ayrı bir Json kolon, karıştırma).
      select: {
        id: true,
        type: true,
        preOpRecord: { select: { lensIolLotId: true, deletedAt: true } },
      },
    });
    const unassignedByTypeMap = new Map<string, number>();
    for (const s of plannedSurgeries) {
      if (!surgeryTypeNeedsLens(s.type)) continue;
      const rec = s.preOpRecord;
      const hasLot = rec !== null && rec.deletedAt === null && rec.lensIolLotId !== null;
      if (hasLot) continue;
      unassignedByTypeMap.set(s.type, (unassignedByTypeMap.get(s.type) ?? 0) + 1);
    }
    const unassignedByType: UnassignedLensType[] = [...unassignedByTypeMap.entries()]
      .map(([surgeryType, count]) => ({ surgeryType, count }))
      .sort((a, b) => b.count - a.count);
    const unassignedLensCount = unassignedByType.reduce((sum, u) => sum + u.count, 0);

    // Planlanmış ama henüz performed olmayan + lens planlanmış cerrahileri çek
    const preOps = await this.prisma.scoped.preOp.findMany({
      where: {
        deletedAt: null,
        lensIolLotId: { not: null },
        surgery: {
          deletedAt: null,
          status: 'planned',
          scheduledAt: { gte: now, lt: horizon },
        },
      },
      select: { lensIolLotId: true },
    });

    const needByLot = new Map<string, number>();
    for (const p of preOps) {
      if (!p.lensIolLotId) continue;
      needByLot.set(p.lensIolLotId, (needByLot.get(p.lensIolLotId) ?? 0) + 1);
    }

    const lotIds = Array.from(needByLot.keys());
    if (lotIds.length === 0) {
      return {
        horizonDays: days,
        totalPlanned: 0,
        rows: [],
        unassignedLensCount,
        unassignedByType,
      };
    }

    const lots = await this.prisma.scoped.iolLot.findMany({
      where: { id: { in: lotIds }, deletedAt: null },
      include: { model: { select: { brand: true, model: true } } },
    });

    const rows: ForecastRow[] = lots.map((lot) => {
      const needed = needByLot.get(lot.id) ?? 0;
      const gap = lot.availableQty - needed;
      return {
        lotId: lot.id,
        modelName: `${lot.model.brand} ${lot.model.model}`,
        lotNumber: lot.lotNumber,
        power: lot.power.toString(),
        neededCount: needed,
        availableQty: lot.availableQty,
        reservedQty: lot.reservedQty,
        consumedQty: lot.consumedQty,
        expiresAt: lot.expiresAt.toISOString(),
        gap,
        isCritical: gap < 0,
      };
    });

    rows.sort((a, b) => a.gap - b.gap);

    return {
      horizonDays: days,
      totalPlanned: preOps.length,
      rows,
      unassignedLensCount,
      unassignedByType,
    };
  }
}
