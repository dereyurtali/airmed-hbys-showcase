import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { CommissionRule } from '@airmed/db';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import {
  CommissionCalculateInput,
  CommissionEntryListQuery,
  CommissionMarkPaidInput,
  CommissionMonthlySummaryQuery,
  CommissionRejectInput,
  CommissionRuleCreateInput,
  CommissionRuleListQuery,
  CommissionRuleUpdateInput,
} from './commission.schemas';

// E2 Doktor Hakediş servisi (v0.2 dilimi).
//
// Yetki kuralı:
// - Tüm endpoint'ler yalnızca yonetici / yonetici_asistani için (hassas finans).
// - Doktor kendi entry listesini ileride /performans page üzerinden görür
//   (v0.3 — DoctorPerformanceMetric ile birlikte).
//
// Kural seçim mantığı (calculate):
// 1. ruleIdOverride verilirse o kullanılır (validity hâlâ kontrol edilir)
// 2. Doctor-spesifik aktif kurallar arasından applicable scope + priority
//    desc + en yakın validFrom → en uygun
// 3. Klinik-geneli (doctorId=null) aktif kural fallback
// 4. Yine yoksa BadRequest — manuel kural önce tanımlanmalı
//
// Hesaplama:
// - PER_SURGERY: amount = rule.value (sabit)
// - PERCENTAGE: amount = baseAmount * rule.value / 100 (baseAmount zorunlu)
//
// Idempotency: aynı (sourceType, sourceId) için tek entry — unique constraint
// 409 döner.

interface Actor {
  id: string;
  roles: readonly string[];
}

@Injectable()
export class CommissionService {
  private readonly logger = new Logger(CommissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // -------------------- Rules --------------------

  async createRule(input: CommissionRuleCreateInput, actor: Actor) {
    this.assertAdmin(actor);
    this.validateRuleValue(input.type, input.value);
    this.validateValidityRange(input.validFrom, input.validTo);
    const tenantId = this.tenantContext.requireTenantId();
    if (input.doctorId) await this.assertDoctorExists(input.doctorId);

    return this.prisma.scoped.commissionRule.create({
      data: {
        tenantId,
        doctorId: input.doctorId ?? null,
        type: input.type,
        value: new Prisma.Decimal(input.value),
        currency: input.currency,
        applicableSurgeryTypes: input.applicableSurgeryTypes,
        applicableProcedureTypes: input.applicableProcedureTypes,
        priority: input.priority,
        validFrom: new Date(input.validFrom),
        validTo: input.validTo ? new Date(input.validTo) : null,
        notes: input.notes ?? null,
      },
    });
  }

  async updateRule(id: string, input: CommissionRuleUpdateInput, actor: Actor) {
    this.assertAdmin(actor);
    const existing = await this.findRuleById(id);
    if (input.value !== undefined) {
      this.validateRuleValue(input.type ?? existing.type, input.value);
    }
    if (input.validFrom !== undefined || input.validTo !== undefined) {
      this.validateValidityRange(
        input.validFrom ?? existing.validFrom.toISOString().slice(0, 10),
        input.validTo ?? (existing.validTo ? existing.validTo.toISOString().slice(0, 10) : null),
      );
    }
    return this.prisma.scoped.commissionRule.update({
      where: { id },
      data: {
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.value !== undefined ? { value: new Prisma.Decimal(input.value) } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.applicableSurgeryTypes !== undefined
          ? { applicableSurgeryTypes: input.applicableSurgeryTypes }
          : {}),
        ...(input.applicableProcedureTypes !== undefined
          ? { applicableProcedureTypes: input.applicableProcedureTypes }
          : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.validFrom !== undefined ? { validFrom: new Date(input.validFrom) } : {}),
        ...(input.validTo !== undefined
          ? { validTo: input.validTo ? new Date(input.validTo) : null }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });
  }

  async softDeleteRule(id: string, actor: Actor) {
    this.assertAdmin(actor);
    await this.findRuleById(id);
    await this.prisma.scoped.commissionRule.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { ok: true as const };
  }

  async listRules({ doctorId, includeInactive }: CommissionRuleListQuery, actor: Actor) {
    this.assertAdmin(actor);
    return this.prisma.scoped.commissionRule.findMany({
      where: {
        deletedAt: null,
        ...(doctorId === undefined ? {} : doctorId === null ? { doctorId: null } : { doctorId }),
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ priority: 'desc' }, { validFrom: 'desc' }],
      include: { doctor: { select: { id: true, name: true } } },
    });
  }

  async findRuleById(id: string) {
    const r = await this.prisma.scoped.commissionRule.findFirst({
      where: { id, deletedAt: null },
      include: { doctor: { select: { id: true, name: true } } },
    });
    if (!r) throw new NotFoundException('Commission rule not found');
    return r;
  }

  // -------------------- Calculate (create entry) --------------------

  async calculate(input: CommissionCalculateInput, actor: Actor) {
    this.assertAdmin(actor);
    const tenantId = this.tenantContext.requireTenantId();
    const { source, doctorId, surgeryOrProcedureType } = await this.loadSource(
      input.sourceType,
      input.sourceId,
    );

    const rule = input.ruleIdOverride
      ? await this.findRuleById(input.ruleIdOverride)
      : await this.findApplicableRule(doctorId, input.sourceType, surgeryOrProcedureType);

    const currency = input.currency ?? rule.currency;
    let amount: Prisma.Decimal;
    let baseAmount: Prisma.Decimal | null = null;

    if (rule.type === 'per_surgery') {
      amount = rule.value;
    } else {
      if (!input.baseAmount) {
        throw new BadRequestException(
          'PERCENTAGE rule requires baseAmount (B3 snapshot v0.3 sonrası otomatik gelecek)',
        );
      }
      baseAmount = new Prisma.Decimal(input.baseAmount);
      // amount = baseAmount * rule.value / 100, 2 ondalık yuvarlama
      amount = baseAmount.mul(rule.value).div(100).toDecimalPlaces(2);
    }

    try {
      return await this.prisma.scoped.commissionEntry.create({
        data: {
          tenantId,
          doctorId,
          ruleId: rule.id,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          amount,
          baseAmount,
          currency,
          status: 'pending',
          snapshotData: {
            rule: {
              id: rule.id,
              type: rule.type,
              value: rule.value.toString(),
              currency: rule.currency,
              priority: rule.priority,
            },
            source: {
              type: input.sourceType,
              id: input.sourceId,
              sourceTypeValue: surgeryOrProcedureType,
              snapshotAt: new Date().toISOString(),
              ...source,
            },
          } as Prisma.InputJsonValue,
        },
        include: this.entryInclude(),
      });
    } catch (err) {
      const e = err as { code?: string };
      if (e?.code === 'P2002') {
        throw new ConflictException(
          'Bu kayda zaten hakediş hesaplanmış — önce mevcut entry iptal edin',
        );
      }
      throw err as Error;
    }
  }

  // -------------------- Entry workflow --------------------

  async approve(id: string, actor: Actor) {
    this.assertAdmin(actor);
    const entry = await this.findEntryById(id);
    if (entry.status !== 'pending') {
      throw new ConflictException(`Sadece pending hakediş onaylanabilir (mevcut: ${entry.status})`);
    }
    return this.prisma.scoped.commissionEntry.update({
      where: { id },
      data: {
        status: 'approved',
        reviewedById: actor.id,
        reviewedAt: new Date(),
        rejectionReason: null,
      },
      include: this.entryInclude(),
    });
  }

  async reject({ id, rejectionReason }: CommissionRejectInput, actor: Actor) {
    this.assertAdmin(actor);
    const entry = await this.findEntryById(id);
    if (entry.status === 'paid') {
      throw new ConflictException('Ödenmiş hakediş reddedilemez');
    }
    return this.prisma.scoped.commissionEntry.update({
      where: { id },
      data: {
        status: 'cancelled',
        rejectionReason,
        reviewedById: actor.id,
        reviewedAt: new Date(),
      },
      include: this.entryInclude(),
    });
  }

  async markPaid({ id, paidMethod, paidAt }: CommissionMarkPaidInput, actor: Actor) {
    this.assertAdmin(actor);
    const entry = await this.findEntryById(id);
    if (entry.status !== 'approved') {
      throw new ConflictException(`Sadece approved hakediş ödenebilir (mevcut: ${entry.status})`);
    }
    return this.prisma.scoped.commissionEntry.update({
      where: { id },
      data: {
        status: 'paid',
        paidMethod,
        paidAt: paidAt ? new Date(paidAt) : new Date(),
      },
      include: this.entryInclude(),
    });
  }

  async listEntries(q: CommissionEntryListQuery, actor: Actor) {
    this.assertAdmin(actor);
    const where: Prisma.CommissionEntryWhereInput = {
      deletedAt: null,
      ...(q.doctorId ? { doctorId: q.doctorId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.fromDate || q.toDate
        ? {
            calculatedAt: {
              ...(q.fromDate ? { gte: new Date(q.fromDate) } : {}),
              ...(q.toDate ? { lte: new Date(`${q.toDate}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    };
    return this.prisma.scoped.commissionEntry.findMany({
      where,
      orderBy: { calculatedAt: 'desc' },
      take: q.limit,
      include: this.entryInclude(),
    });
  }

  async findEntryById(id: string) {
    const e = await this.prisma.scoped.commissionEntry.findFirst({
      where: { id, deletedAt: null },
      include: this.entryInclude(),
    });
    if (!e) throw new NotFoundException('Commission entry not found');
    return e;
  }

  // -------------------- Monthly summary --------------------

  async monthlySummary({ year, month }: CommissionMonthlySummaryQuery, actor: Actor) {
    this.assertAdmin(actor);
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));

    const entries = await this.prisma.scoped.commissionEntry.findMany({
      where: {
        deletedAt: null,
        calculatedAt: { gte: start, lt: end },
      },
      select: {
        doctorId: true,
        amount: true,
        currency: true,
        status: true,
        doctor: { select: { id: true, name: true, specialty: true } },
      },
    });

    // Doktor × currency × status pivot
    const byDoctor = new Map<
      string,
      {
        doctor: { id: string; name: string; specialty: string };
        totals: Record<
          string,
          { pending: number; approved: number; paid: number; cancelled: number }
        >;
      }
    >();

    for (const e of entries) {
      const key = e.doctorId;
      const existing = byDoctor.get(key) ?? {
        doctor: e.doctor,
        totals: {},
      };
      const cur = existing.totals[e.currency] ?? {
        pending: 0,
        approved: 0,
        paid: 0,
        cancelled: 0,
      };
      cur[e.status] += Number(e.amount);
      existing.totals[e.currency] = cur;
      byDoctor.set(key, existing);
    }

    return {
      period: { year, month, start: start.toISOString(), end: end.toISOString() },
      doctors: Array.from(byDoctor.values()).sort((a, b) =>
        a.doctor.name.localeCompare(b.doctor.name),
      ),
    };
  }

  // -------------------- Helpers --------------------

  private async loadSource(
    type: 'surgery' | 'procedure',
    id: string,
  ): Promise<{
    source: Record<string, unknown>;
    doctorId: string;
    surgeryOrProcedureType: string;
  }> {
    if (type === 'surgery') {
      const s = await this.prisma.scoped.surgery.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          doctorId: true,
          type: true,
          status: true,
          performedAt: true,
          patientId: true,
        },
      });
      if (!s) throw new NotFoundException('Surgery not found');
      if (s.status !== 'performed') {
        throw new BadRequestException('Yalnızca tamamlanmış cerrahi için hakediş hesaplanabilir');
      }
      return {
        source: {
          status: s.status,
          performedAt: s.performedAt?.toISOString() ?? null,
          patientId: s.patientId,
        },
        doctorId: s.doctorId,
        surgeryOrProcedureType: s.type,
      };
    }
    const p = await this.prisma.scoped.procedure.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        doctorId: true,
        type: true,
        status: true,
        performedAt: true,
        patientId: true,
      },
    });
    if (!p) throw new NotFoundException('Procedure not found');
    if (p.status !== 'performed') {
      throw new BadRequestException('Yalnızca tamamlanmış prosedür için hakediş hesaplanabilir');
    }
    return {
      source: {
        status: p.status,
        performedAt: p.performedAt.toISOString(),
        patientId: p.patientId,
      },
      doctorId: p.doctorId,
      surgeryOrProcedureType: p.type,
    };
  }

  // -------------------- S12b — Auto-calculate (müşteri görüşmesi) --------------------

  /**
   * S12b — Examination/Lab/Measurement create sonrası hakediş entry otomatik
   * oluşturulur. Kural yoksa veya hata olursa SESSİZCE geçer (warning log) —
   * klinik akışını engellemez. Hakediş klinik için "nice-to-have", manuel
   * `calculate` halen çalışır.
   *
   * Idempotent: aynı (sourceType, sourceId) için unique constraint var, 2.
   * çağrı P2002 yutulur.
   *
   * Surgery/procedure için ayrı yol var (manuel calculate); bu helper
   * Examination/Lab/Measurement için tasarlandı.
   */
  async tryAutoCalculate(input: {
    sourceType: 'examination' | 'lab' | 'measurement';
    sourceId: string;
    doctorId: string;
    baseAmount: string; // hizmet fiyatı (ServiceItem'dan veya manuel)
    currency?: string;
  }): Promise<void> {
    try {
      const tenantId = this.tenantContext.requireTenantId();
      const rule = await this.findApplicableSourceTypeRule(input.doctorId, input.sourceType);
      if (!rule) return; // Kural yok, sessizce skip

      const currency = input.currency ?? rule.currency;
      let amount: Prisma.Decimal;
      let baseAmount: Prisma.Decimal | null = null;

      if (rule.type === 'per_surgery') {
        amount = rule.value;
      } else {
        baseAmount = new Prisma.Decimal(input.baseAmount);
        amount = baseAmount.mul(rule.value).div(100).toDecimalPlaces(2);
      }

      await this.prisma.scoped.commissionEntry.create({
        data: {
          tenantId,
          doctorId: input.doctorId,
          ruleId: rule.id,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          amount,
          baseAmount,
          currency,
          status: 'pending',
          snapshotData: {
            rule: {
              id: rule.id,
              type: rule.type,
              value: rule.value.toString(),
              currency: rule.currency,
              priority: rule.priority,
            },
            source: {
              type: input.sourceType,
              id: input.sourceId,
              autoTriggeredAt: new Date().toISOString(),
            },
            auto: true,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      // P2002 = duplicate entry (idempotent); BadRequest = rule yok → sessiz
      if (e?.code === 'P2002') return;
      // Delta audit A-8: console.warn → NestJS Logger
      this.logger.warn(
        `[tryAutoCalculate] ${input.sourceType}/${input.sourceId} skip: ${e?.message ?? String(err)}`,
      );
    }
  }

  /**
   * Examination/Lab/Measurement için kural eşleme. applicableSourceTypes
   * boş = hepsi (geriye uyumlu); set ise sadece listedeki tipler.
   * doctorId-spesifik > klinik-geneli > priority.
   */
  private async findApplicableSourceTypeRule(
    doctorId: string,
    sourceType: 'examination' | 'lab' | 'measurement',
  ): Promise<CommissionRule | null> {
    const today = new Date();
    const candidates = await this.prisma.scoped.commissionRule.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        validFrom: { lte: today },
        OR: [{ validTo: null }, { validTo: { gte: today } }],
        AND: [{ OR: [{ doctorId }, { doctorId: null }] }],
      },
      orderBy: [
        { doctorId: { sort: 'desc', nulls: 'last' } },
        { priority: 'desc' },
        { validFrom: 'desc' },
      ],
    });
    // applicableSourceTypes boşsa hepsine uygula; set ise filtre
    return (
      candidates.find((r) => {
        const arr = r.applicableSourceTypes as string[];
        return arr.length === 0 || arr.includes(sourceType);
      }) ?? null
    );
  }

  // En uygun aktif kuralı bul. doctorId-spesifik > klinik-geneli, ardından
  // applicable scope match, en yüksek priority, en yakın validFrom.
  private async findApplicableRule(
    doctorId: string,
    sourceType: 'surgery' | 'procedure',
    sourceTypeValue: string,
  ): Promise<CommissionRule> {
    const today = new Date();
    const candidates = await this.prisma.scoped.commissionRule.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        validFrom: { lte: today },
        OR: [{ validTo: null }, { validTo: { gte: today } }],
        AND: [
          {
            OR: [{ doctorId }, { doctorId: null }],
          },
        ],
      },
      // doctorId 'desc' + nulls:'last' → doktor-spesifik kurallar önce
      // klinik-geneli fallback en sonda. Ardından priority + validFrom.
      orderBy: [
        { doctorId: { sort: 'desc', nulls: 'last' } },
        { priority: 'desc' },
        { validFrom: 'desc' },
      ],
    });

    const fits = (r: CommissionRule): boolean => {
      if (sourceType === 'surgery') {
        const arr = r.applicableSurgeryTypes;
        return arr.length === 0 || arr.includes(sourceTypeValue);
      }
      const arr = r.applicableProcedureTypes as string[];
      return arr.length === 0 || arr.includes(sourceTypeValue);
    };

    // doctorId-spesifik önce, ardından klinik-geneli — orderBy {doctorId desc}
    // null'ları sonra koyar, doctorId UUID'leri önce gelir.
    const match = candidates.find(fits);
    if (!match) {
      throw new BadRequestException(
        'Uygulanabilir aktif hakediş kuralı yok — yönetici → kural tanımlanmalı',
      );
    }
    return match;
  }

  private validateRuleValue(type: 'per_surgery' | 'percentage', value: string): void {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      throw new BadRequestException('value must be >= 0');
    }
    if (type === 'percentage' && n > 100) {
      throw new BadRequestException('percentage value must be ≤ 100');
    }
  }

  private validateValidityRange(validFrom: string, validTo: string | null | undefined): void {
    if (validTo && validTo < validFrom) {
      throw new BadRequestException('validTo must be on or after validFrom');
    }
  }

  private async assertDoctorExists(id: string): Promise<void> {
    const d = await this.prisma.scoped.doctor.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!d) throw new NotFoundException('Doctor not found');
  }

  private assertAdmin(actor: Actor): void {
    const allowed = actor.roles.some((r) => r === 'yonetici' || r === 'yonetici_asistani');
    if (!allowed) {
      throw new ForbiddenException('Hakediş yönetimi yalnızca yonetici / yonetici_asistani için');
    }
  }

  private entryInclude(): Prisma.CommissionEntryInclude {
    return {
      doctor: { select: { id: true, name: true, specialty: true } },
      rule: { select: { id: true, type: true, value: true, currency: true } },
      reviewedBy: { select: { id: true, name: true } },
    };
  }
}
