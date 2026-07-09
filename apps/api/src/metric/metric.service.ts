import { Injectable } from '@nestjs/common';
import type { Prisma } from '@airmed/db';
import { PrismaService } from '../prisma/prisma.service';
import {
  CohortInput,
  HeatmapInput,
  MetricRangeInput,
  MetricTrendInput,
  RetentionInput,
  RevenueTrendInput,
} from './metric.schemas';

// A11 dashboard metric servisi.
//
// Tüm sorgular tenant-scoped (this.prisma.scoped — RLS aktif). Yetki kontrolü
// router katmanında (protectedProcedure). Doktor filtreleri opsiyonel.
//
// İleri faz: cache (5 dk Redis), pre-aggregated daily snapshots (E5).
// Şimdi: live aggregate, datasets küçük, perf yeterli.

interface DateRange {
  from: Date;
  to: Date;
}

@Injectable()
export class MetricService {
  constructor(private readonly prisma: PrismaService) {}

  // #402 — Aylık ciro raporu: son N ay tahsilat (Payment.tjsEquivalent, iade/silme
  // hariç) ay bazında. "Bu ay ne kazandık?" sorusunu cevaplar. Eksik aylar 0 ile
  // doldurulur (grafikte boşluk olmasın).
  async revenueTrend({ months }: RevenueTrendInput) {
    const since = new Date();
    since.setMonth(since.getMonth() - months + 1);
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    // #1062 — aylık toplam DB'de: eskiden tüm ödeme satırları Node'a çekilip
    // JS'te toplanıyordu (12 ay ≈ on binlerce satır, tx içinde). Ay anahtarı
    // eski JS bucketing ile birebir aynı kalsın diye server TZ'ine çevrilir
    // (timestamp kolonları UTC saklanır, getMonth() server-yerel çalışıyordu).
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const rows = await this.prisma.scoped.$queryRaw<{ month: string; total: number }[]>`
      SELECT to_char(("taken_at" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM') AS month,
             SUM("tjs_equivalent")::float8 AS total
      FROM "payments"
      WHERE "deleted_at" IS NULL AND "refunded_at" IS NULL AND "taken_at" >= ${since}
      GROUP BY 1
    `;
    const byMonth = new Map(rows.map((r) => [r.month, r.total]));
    const result: { month: string; revenueTjs: number }[] = [];
    const cur = new Date(since);
    for (let i = 0; i < months; i++) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
      result.push({ month: key, revenueTjs: Math.round((byMonth.get(key) ?? 0) * 100) / 100 });
      cur.setMonth(cur.getMonth() + 1);
    }
    return { months: result };
  }

  /**
   * Bugün özet — randevu sayısı (durum bazlı), gerçekleşmiş muayene, gerçekleşmiş
   * ameliyat, bugün eklenen yeni hasta.
   */
  async today() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const [appointmentsByStatus, examinations, surgeries, newPatients] = await Promise.all([
      this.prisma.scoped.appointment.groupBy({
        by: ['status'],
        where: {
          deletedAt: null,
          startsAt: { gte: start, lt: end },
        },
        _count: { _all: true },
      }),
      this.prisma.scoped.examination.count({
        where: {
          deletedAt: null,
          examinedAt: { gte: start, lt: end },
        },
      }),
      this.prisma.scoped.surgery.count({
        where: {
          deletedAt: null,
          performedAt: { gte: start, lt: end },
        },
      }),
      this.prisma.scoped.patient.count({
        where: {
          deletedAt: null,
          createdAt: { gte: start, lt: end },
        },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of appointmentsByStatus) {
      byStatus[row.status] = row._count._all;
    }
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

    return {
      appointments: {
        total,
        scheduled: byStatus.scheduled ?? 0,
        checkedIn: byStatus.checked_in ?? 0,
        inProgress: byStatus.in_progress ?? 0,
        completed: byStatus.completed ?? 0,
        cancelled: byStatus.cancelled ?? 0,
        noShow: byStatus.no_show ?? 0,
      },
      examinations,
      surgeries,
      newPatients,
    };
  }

  /**
   * Tarih aralığı özet — KPI kartları için.
   */
  async summary(input: MetricRangeInput) {
    const range = this.parseRange(input);
    const doctorFilter = input.doctorId ? { doctorId: input.doctorId } : {};
    const aptWhere: Prisma.AppointmentWhereInput = {
      deletedAt: null,
      startsAt: { gte: range.from, lt: range.to },
      ...doctorFilter,
    };
    const examWhere: Prisma.ExaminationWhereInput = {
      deletedAt: null,
      examinedAt: { gte: range.from, lt: range.to },
      ...doctorFilter,
    };
    const surgWhere: Prisma.SurgeryWhereInput = {
      deletedAt: null,
      performedAt: { gte: range.from, lt: range.to },
      ...doctorFilter,
    };

    const [appointmentsByStatus, examinations, surgeries, complicationsCount, newPatients] =
      await Promise.all([
        this.prisma.scoped.appointment.groupBy({
          by: ['status'],
          where: aptWhere,
          _count: { _all: true },
        }),
        this.prisma.scoped.examination.count({ where: examWhere }),
        this.prisma.scoped.surgery.count({ where: surgWhere }),
        this.prisma.scoped.surgery.count({
          where: { ...surgWhere, complicationFlag: true },
        }),
        this.prisma.scoped.patient.count({
          where: {
            deletedAt: null,
            createdAt: { gte: range.from, lt: range.to },
          },
        }),
      ]);

    const byStatus: Record<string, number> = {};
    for (const row of appointmentsByStatus) {
      byStatus[row.status] = row._count._all;
    }
    const totalAppts = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const noShow = byStatus.no_show ?? 0;
    const noShowRate = totalAppts > 0 ? noShow / totalAppts : 0;
    const complicationRate = surgeries > 0 ? complicationsCount / surgeries : 0;

    return {
      appointments: {
        total: totalAppts,
        scheduled: byStatus.scheduled ?? 0,
        checkedIn: byStatus.checked_in ?? 0,
        inProgress: byStatus.in_progress ?? 0,
        completed: byStatus.completed ?? 0,
        cancelled: byStatus.cancelled ?? 0,
        noShow,
      },
      noShowRate,
      examinations,
      surgeries,
      complications: complicationsCount,
      complicationRate,
      newPatients,
    };
  }

  /**
   * Haftalık randevu trendi — son N hafta, sayım by week.
   */
  async appointmentTrend(input: MetricTrendInput) {
    const range = this.parseRange(input);
    const grouping = this.bucketSql(input.bucket);

    // Raw SQL aggregation: $queryRaw is RLS-safe (uses same connection).
    type Row = { bucket: Date; count: bigint };
    const rows = await this.prisma.scoped.$queryRawUnsafe<Row[]>(
      `SELECT date_trunc('${grouping}', starts_at) as bucket, count(*)::bigint as count
       FROM appointments
       WHERE deleted_at IS NULL
         AND starts_at >= $1
         AND starts_at < $2
         ${input.doctorId ? 'AND doctor_id = $3' : ''}
       GROUP BY bucket
       ORDER BY bucket ASC`,
      range.from,
      range.to,
      ...(input.doctorId ? [input.doctorId] : []),
    );

    return rows.map((r) => ({
      bucket: r.bucket.toISOString(),
      count: Number(r.count),
    }));
  }

  /**
   * Doktor başına performans — randevu sayısı + tamamlanma oranı.
   */
  async doctorPerformance(input: MetricRangeInput) {
    const range = this.parseRange(input);
    const where: Prisma.AppointmentWhereInput = {
      deletedAt: null,
      startsAt: { gte: range.from, lt: range.to },
    };
    const grouped = await this.prisma.scoped.appointment.groupBy({
      by: ['doctorId', 'status'],
      where,
      _count: { _all: true },
    });

    const byDoctor = new Map<string, Record<string, number>>();
    for (const row of grouped) {
      // #367 — Doktorsuz (havuz) randevular doktor performansına girmez.
      if (!row.doctorId) continue;
      const stats = byDoctor.get(row.doctorId) ?? {};
      stats[row.status] = row._count._all;
      byDoctor.set(row.doctorId, stats);
    }

    const doctorIds = [...byDoctor.keys()];
    if (doctorIds.length === 0) return [];

    const doctors = await this.prisma.scoped.doctor.findMany({
      where: { id: { in: doctorIds }, deletedAt: null },
      select: { id: true, name: true, specialty: true },
    });
    const doctorById = new Map(doctors.map((d) => [d.id, d]));

    return [...byDoctor.entries()].map(([doctorId, stats]) => {
      const total = Object.values(stats).reduce((a, b) => a + b, 0);
      const completed = stats.completed ?? 0;
      const noShow = stats.no_show ?? 0;
      const doctor = doctorById.get(doctorId);
      return {
        doctorId,
        name: doctor?.name ?? 'Unknown',
        specialty: doctor?.specialty ?? '',
        total,
        completed,
        noShow,
        completionRate: total > 0 ? completed / total : 0,
      };
    });
  }

  // -------------------- E5 ek raporlar --------------------

  /**
   * Aylık kohort — son N ay için yeni eklenen hasta sayısı.
   */
  async cohort({ months }: CohortInput) {
    const end = startOfMonth(new Date());
    end.setMonth(end.getMonth() + 1);
    const start = startOfMonth(new Date());
    start.setMonth(start.getMonth() - (months - 1));

    type Row = { bucket: Date; count: bigint };
    const rows = await this.prisma.scoped.$queryRawUnsafe<Row[]>(
      `SELECT date_trunc('month', created_at) AS bucket, count(*)::bigint AS count
       FROM patients
       WHERE deleted_at IS NULL AND created_at >= $1 AND created_at < $2
       GROUP BY bucket
       ORDER BY bucket ASC`,
      start,
      end,
    );
    return rows.map((r) => ({ bucket: r.bucket.toISOString(), count: Number(r.count) }));
  }

  /**
   * Retention — son N ay kohortlarından her biri için, kayıt tarihinden
   * sonraki M gün içinde dönen hasta oranı (en az 1 randevu/muayene).
   */
  async retention({ cohortMonths, lookAheadDays }: RetentionInput) {
    const end = startOfMonth(new Date());
    end.setMonth(end.getMonth() + 1);
    const start = startOfMonth(new Date());
    start.setMonth(start.getMonth() - (cohortMonths - 1));

    type Row = { bucket: Date; total: bigint; returned: bigint };
    const rows = await this.prisma.scoped.$queryRawUnsafe<Row[]>(
      `WITH cohorts AS (
         SELECT id, created_at, date_trunc('month', created_at) AS bucket
         FROM patients
         WHERE deleted_at IS NULL AND created_at >= $1 AND created_at < $2
       ),
       returns AS (
         SELECT c.bucket, c.id, EXISTS (
           SELECT 1 FROM appointments a
           WHERE a.patient_id = c.id
             AND a.deleted_at IS NULL
             AND a.starts_at > c.created_at
             AND a.starts_at <= c.created_at + ($3::int || ' days')::interval
         ) AS returned
         FROM cohorts c
       )
       SELECT bucket,
              count(*)::bigint AS total,
              count(*) FILTER (WHERE returned)::bigint AS returned
       FROM returns
       GROUP BY bucket
       ORDER BY bucket ASC`,
      start,
      end,
      lookAheadDays,
    );
    return rows.map((r) => {
      const total = Number(r.total);
      const returned = Number(r.returned);
      return {
        bucket: r.bucket.toISOString(),
        total,
        returned,
        rate: total > 0 ? returned / total : 0,
      };
    });
  }

  /**
   * Doktor performans heatmap — son N gün, gün-saat hücrelerinde randevu
   * sayısı. Yoğunluk paterni görmek için (kullanım yoğunluğu).
   * Saat aralığı: 0-23. Gün: 0=Pazar … 6=Cumartesi (Postgres EXTRACT(DOW)).
   */
  async doctorHeatmap({ days, doctorId }: HeatmapInput) {
    const start = new Date();
    start.setDate(start.getDate() - days);
    start.setHours(0, 0, 0, 0);

    type Row = { dow: number; hour: number; count: bigint };
    const rows = await this.prisma.scoped.$queryRawUnsafe<Row[]>(
      `SELECT EXTRACT(DOW FROM starts_at)::int AS dow,
              EXTRACT(HOUR FROM starts_at)::int AS hour,
              count(*)::bigint AS count
       FROM appointments
       WHERE deleted_at IS NULL AND starts_at >= $1
         ${doctorId ? 'AND doctor_id = $2' : ''}
       GROUP BY dow, hour
       ORDER BY dow, hour`,
      start,
      ...(doctorId ? [doctorId] : []),
    );
    return rows.map((r) => ({
      dow: r.dow,
      hour: r.hour,
      count: Number(r.count),
    }));
  }

  // -------------------- helpers --------------------

  private parseRange(input: { dateFrom: string; dateTo: string }): DateRange {
    return {
      from: new Date(input.dateFrom),
      to: new Date(input.dateTo),
    };
  }

  private bucketSql(bucket: 'day' | 'week' | 'month'): string {
    // Whitelist'ten geçmiş; SQL injection riski yok.
    return bucket;
  }
}

function startOfMonth(d: Date): Date {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}
