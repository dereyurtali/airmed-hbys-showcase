import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import type { CashRegisterCloseInput, CashRegisterListQuery } from './billing.schemas';

// S11b — CashRegister (kasa / Z-raporu) service.
// İş akışı:
//   - Sayman gün sonunda "kapat" der:
//     1. Henüz kapanışı atanmamış (cashRegisterClosureId IS NULL) tüm
//        Payment + Refund toplanır
//     2. Method × currency dağılımı + toplam + net hesaplanır
//     3. CashRegisterClosure satırı oluşur (donmuş hali)
//     4. İlgili Payment + Refund'lara cashRegisterClosureId set edilir
//   - Bir kez kapatıldıktan sonra düzeltilemez (audit log için)
//   - "Bugünün snapshot'ı" — closure yapmadan canlı agregasyon (currentSnapshot)
//
// Çoklu birim:
//   - TJS ve USD ayrı tutulur (sayman fiziksel sayım için bilmesi gerek)
//   - netTjsEquivalent = total - refund (TJS karşılığı toplam)
//
// Açık tahsilat YOKSA closure yapılmaz (boş Z-raporu engellenir)

interface Actor {
  id: string;
}

@Injectable()
export class CashRegisterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Bugün henüz kapatılmamış (closureId NULL) Payment + Refund'ların canlı toplamı.
   * Sayman "günü kapat" demeden önce ne sayacağını görür.
   */
  async currentSnapshot() {
    this.tenantContext.requireTenantId();
    const [payments, refunds] = await Promise.all([
      this.prisma.scoped.payment.findMany({
        where: { deletedAt: null, cashRegisterClosureId: null },
        select: {
          id: true,
          amount: true,
          currency: true,
          tjsEquivalent: true,
          method: true,
          takenAt: true,
          takenBy: { select: { id: true, name: true } },
          invoice: { select: { id: true, invoiceNumber: true } },
        },
        orderBy: { takenAt: 'asc' },
      }),
      this.prisma.scoped.refund.findMany({
        where: { cashRegisterClosureId: null },
        select: {
          id: true,
          amount: true,
          currency: true,
          tjsEquivalent: true,
          reason: true,
          refundedAt: true,
          approvedBy: { select: { id: true, name: true } },
          payment: {
            select: {
              id: true,
              method: true,
              invoice: { select: { id: true, invoiceNumber: true } },
            },
          },
        },
        orderBy: { refundedAt: 'asc' },
      }),
    ]);

    const totals = this.aggregateTotals(payments, refunds);
    return {
      paymentCount: payments.length,
      refundCount: refunds.length,
      payments,
      refunds,
      ...totals,
    };
  }

  async close(input: CashRegisterCloseInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    const tx = this.prisma.scoped;

    const payments = await tx.payment.findMany({
      where: { deletedAt: null, cashRegisterClosureId: null },
      select: {
        id: true,
        amount: true,
        currency: true,
        tjsEquivalent: true,
        method: true,
      },
    });
    const refunds = await tx.refund.findMany({
      where: { cashRegisterClosureId: null },
      select: {
        id: true,
        amount: true,
        currency: true,
        tjsEquivalent: true,
      },
    });

    if (payments.length === 0 && refunds.length === 0) {
      throw new ConflictException('No unclosed payments/refunds; nothing to close');
    }

    const totals = this.aggregateTotals(payments, refunds);

    const closure = await tx.cashRegisterClosure.create({
      data: {
        tenantId,
        closedById: actor.id,
        ...totals,
        paymentCount: payments.length,
        refundCount: refunds.length,
        notes: input.notes ?? null,
      },
    });

    // Tüm payment + refund'lara closure ID'sini ata
    if (payments.length > 0) {
      await tx.payment.updateMany({
        where: { id: { in: payments.map((p) => p.id) } },
        data: { cashRegisterClosureId: closure.id },
      });
    }
    if (refunds.length > 0) {
      await tx.refund.updateMany({
        where: { id: { in: refunds.map((r) => r.id) } },
        data: { cashRegisterClosureId: closure.id },
      });
    }

    return closure;
  }

  // -------------------- R5 (#727) — 2-aşama draft --------------------

  /**
   * Asistan kapatma TASLAĞI hazırlar (operate-but-not-finalize). Snapshot'ı
   * dondurup 'draft' kaydı oluşturur ama payment/refund BAĞLAMAZ — finalize'da
   * yönetici/finans bağlar. Aynı anda yalnız bir açık taslak olabilir.
   */
  async prepareDraft(input: CashRegisterCloseInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    const tx = this.prisma.scoped;

    const existing = await tx.cashRegisterClosure.findFirst({ where: { status: 'draft' } });
    if (existing) {
      throw new ConflictException(
        'Zaten bekleyen bir kasa taslağı var; önce finalize edin veya iptal edin',
      );
    }

    const [payments, refunds] = await Promise.all([
      tx.payment.findMany({
        where: { deletedAt: null, cashRegisterClosureId: null },
        select: { id: true, amount: true, currency: true, tjsEquivalent: true, method: true },
      }),
      tx.refund.findMany({
        where: { cashRegisterClosureId: null },
        select: { id: true, amount: true, currency: true, tjsEquivalent: true },
      }),
    ]);
    if (payments.length === 0 && refunds.length === 0) {
      throw new ConflictException('Kapatılacak açık tahsilat yok; taslak hazırlanamaz');
    }

    const totals = this.aggregateTotals(payments, refunds);
    return tx.cashRegisterClosure.create({
      data: {
        tenantId,
        status: 'draft',
        preparedById: actor.id,
        preparedAt: new Date(),
        closedById: null,
        closedAt: null,
        ...totals,
        paymentCount: payments.length,
        refundCount: refunds.length,
        notes: input.notes ?? null,
      },
    });
  }

  /** Açık (bekleyen) kasa taslağı — yoksa null. Sayfa açık taslağı gösterir. */
  async currentDraft() {
    this.tenantContext.requireTenantId();
    return this.prisma.scoped.cashRegisterClosure.findFirst({
      where: { status: 'draft' },
      include: { preparedBy: { select: { id: true, name: true } } },
      orderBy: { preparedAt: 'desc' },
    });
  }

  /**
   * Yönetici/finans taslağı FINALIZE eder. Finalize anında açık tahsilatları
   * yeniden hesaplar (otoriter) → taslağın donmuş önizlemesi yerine güncel
   * değerlerle kapatır + payment/refund bağlar.
   */
  async finalizeDraft(draftId: string, actor: Actor) {
    const tx = this.prisma.scoped;
    const draft = await tx.cashRegisterClosure.findFirst({
      where: { id: draftId, status: 'draft' },
    });
    if (!draft) throw new NotFoundException('Kasa taslağı bulunamadı');

    const payments = await tx.payment.findMany({
      where: { deletedAt: null, cashRegisterClosureId: null },
      select: { id: true, amount: true, currency: true, tjsEquivalent: true, method: true },
    });
    const refunds = await tx.refund.findMany({
      where: { cashRegisterClosureId: null },
      select: { id: true, amount: true, currency: true, tjsEquivalent: true },
    });
    if (payments.length === 0 && refunds.length === 0) {
      throw new ConflictException('Açık tahsilat yok; taslağı iptal edin');
    }

    const totals = this.aggregateTotals(payments, refunds);
    const closure = await tx.cashRegisterClosure.update({
      where: { id: draft.id },
      data: {
        status: 'finalized',
        closedById: actor.id,
        closedAt: new Date(),
        ...totals,
        paymentCount: payments.length,
        refundCount: refunds.length,
      },
    });

    if (payments.length > 0) {
      await tx.payment.updateMany({
        where: { id: { in: payments.map((p) => p.id) } },
        data: { cashRegisterClosureId: closure.id },
      });
    }
    if (refunds.length > 0) {
      await tx.refund.updateMany({
        where: { id: { in: refunds.map((r) => r.id) } },
        data: { cashRegisterClosureId: closure.id },
      });
    }

    return closure;
  }

  /** Bekleyen taslağı iptal eder (payment bağlamadığı için satır silinir). */
  async discardDraft(draftId: string) {
    const tx = this.prisma.scoped;
    const draft = await tx.cashRegisterClosure.findFirst({
      where: { id: draftId, status: 'draft' },
    });
    if (!draft) throw new NotFoundException('Kasa taslağı bulunamadı');
    await tx.cashRegisterClosure.delete({ where: { id: draft.id } });
    return { discarded: true };
  }

  async list(input: CashRegisterListQuery) {
    const where: Prisma.CashRegisterClosureWhereInput = {
      // R5 (#727) — geçmiş yalnız finalize edilmiş kapanışlar; taslaklar hariç.
      status: 'finalized',
      ...((input.fromDate || input.toDate) && {
        closedAt: {
          ...(input.fromDate && { gte: new Date(input.fromDate) }),
          ...(input.toDate && { lt: this.nextDay(input.toDate) }),
        },
      }),
    };
    const [items, total] = await Promise.all([
      this.prisma.scoped.cashRegisterClosure.findMany({
        where,
        include: { closedBy: { select: { id: true, name: true } } },
        orderBy: { closedAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.scoped.cashRegisterClosure.count({ where }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  }

  async findById(id: string) {
    const closure = await this.prisma.scoped.cashRegisterClosure.findFirst({
      where: { id },
      include: {
        closedBy: { select: { id: true, name: true } },
        payments: {
          select: {
            id: true,
            amount: true,
            currency: true,
            method: true,
            takenAt: true,
            invoice: { select: { id: true, invoiceNumber: true } },
          },
        },
        refunds: {
          select: {
            id: true,
            amount: true,
            currency: true,
            reason: true,
            refundedAt: true,
            payment: {
              select: { id: true, invoice: { select: { invoiceNumber: true } } },
            },
          },
        },
      },
    });
    if (!closure) throw new NotFoundException('Cash register closure not found');
    return closure;
  }

  // -------------------- Helpers --------------------

  private aggregateTotals(
    payments: ReadonlyArray<{
      amount: Prisma.Decimal;
      currency: 'TJS' | 'USD';
      tjsEquivalent: Prisma.Decimal;
      method: 'cash' | 'card' | 'transfer' | 'insurance';
    }>,
    refunds: ReadonlyArray<{
      amount: Prisma.Decimal;
      currency: 'TJS' | 'USD';
      tjsEquivalent: Prisma.Decimal;
    }>,
  ) {
    const zero = new Prisma.Decimal(0);
    let cashTjs = zero,
      cashUsd = zero;
    let cardTjs = zero,
      cardUsd = zero;
    let transferTjs = zero,
      transferUsd = zero;
    let insuranceTjs = zero,
      insuranceUsd = zero;
    let totalTjs = zero,
      totalUsd = zero;
    let totalTjsEquivalent = zero;

    for (const p of payments) {
      const isTjs = p.currency === 'TJS';
      if (isTjs) totalTjs = totalTjs.plus(p.amount);
      else totalUsd = totalUsd.plus(p.amount);
      totalTjsEquivalent = totalTjsEquivalent.plus(p.tjsEquivalent);
      switch (p.method) {
        case 'cash':
          if (isTjs) cashTjs = cashTjs.plus(p.amount);
          else cashUsd = cashUsd.plus(p.amount);
          break;
        case 'card':
          if (isTjs) cardTjs = cardTjs.plus(p.amount);
          else cardUsd = cardUsd.plus(p.amount);
          break;
        case 'transfer':
          if (isTjs) transferTjs = transferTjs.plus(p.amount);
          else transferUsd = transferUsd.plus(p.amount);
          break;
        case 'insurance':
          if (isTjs) insuranceTjs = insuranceTjs.plus(p.amount);
          else insuranceUsd = insuranceUsd.plus(p.amount);
          break;
      }
    }

    let refundTjs = zero,
      refundUsd = zero;
    let refundTjsEquivalent = zero;
    for (const r of refunds) {
      if (r.currency === 'TJS') refundTjs = refundTjs.plus(r.amount);
      else refundUsd = refundUsd.plus(r.amount);
      refundTjsEquivalent = refundTjsEquivalent.plus(r.tjsEquivalent);
    }

    const netTjsEquivalent = totalTjsEquivalent.minus(refundTjsEquivalent);

    return {
      totalTjs,
      totalUsd,
      totalTjsEquivalent,
      cashTjs,
      cashUsd,
      cardTjs,
      cardUsd,
      transferTjs,
      transferUsd,
      insuranceTjs,
      insuranceUsd,
      refundTjs,
      refundUsd,
      netTjsEquivalent,
    };
  }

  private nextDay(isoDate: string): Date {
    const d = new Date(isoDate);
    d.setDate(d.getDate() + 1);
    return d;
  }
}
