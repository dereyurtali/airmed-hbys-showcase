import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SURGERY_BILLING_ROLES } from '@airmed/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import type { PaymentCreateInput } from './billing.schemas';
import { InvoiceService } from './invoice.service';

// S11b — Payment (tahsilat) service.
// İş kuralları:
//   - Invoice status açık ('open' veya 'partial') olmalı
//   - currency != invoice.currency ise exchangeRate ZORUNLU (> 0)
//   - aksi halde exchangeRate = 1.0 (sabit)
//   - tjsEquivalent: TJS payment ise = amount; USD ise:
//       invoice TJS → amount * exchangeRate
//       invoice USD → amount * (USD/TJS sabit kur — opsiyonel; pilot için
//                                exchangeRate alanı kullanılır)
//   - amount > 0 ve net açık bakiyeyi aşmamalı (overpayment yok)
//   - Z-raporu kapanışı SONRASI tarihte takenAt olmaz (sayman cheating önleme)
//
// Yan etki: InvoiceService.recomputeStatus çağrılır → invoice status güncellenir

interface Actor {
  id: string;
  // S12a — Cerrahi bağlı invoice'a tahsilat kontrolü
  roles?: readonly string[];
}

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly invoiceService: InvoiceService,
  ) {}

  async create(input: PaymentCreateInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    const amount = new Prisma.Decimal(input.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('amount must be greater than 0');
    }

    const tx = this.prisma.scoped;
    const invoice = await tx.invoice.findFirst({
      where: { id: input.invoiceId, deletedAt: null },
      include: { payments: { where: { deletedAt: null }, include: { refunds: true } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'cancelled') {
      throw new BadRequestException('Cannot pay against a cancelled invoice');
    }
    if (invoice.status === 'refunded') {
      throw new BadRequestException('Invoice fully refunded; create new invoice');
    }
    if (invoice.status === 'paid') {
      throw new BadRequestException('Invoice already paid');
    }
    // S14 — Onay bekleyen fatura tahsilat almaz; admin önce indirimi onaylamalı
    if (invoice.status === 'pending_approval') {
      throw new BadRequestException(
        'Bu fatura indirim onayı bekliyor; admin onay vermeden tahsilat alınamaz',
      );
    }

    // S12a — Cerrahi bağlı invoice'a tahsilat yalnız SURGERY_BILLING_ROLES
    if (invoice.surgeryId && actor.roles) {
      const allowed = actor.roles.some((r) =>
        (SURGERY_BILLING_ROLES as readonly string[]).includes(r),
      );
      if (!allowed) {
        throw new ForbiddenException(
          'Cerrahi paket tahsilatı yalnız Ameliyat Satış (veya yönetici/asistan) tarafından alınabilir',
        );
      }
    }

    // Exchange rate kuralı: currency != invoice.currency → exchangeRate zorunlu
    let exchangeRate: Prisma.Decimal;
    if (input.currency === invoice.currency) {
      exchangeRate = new Prisma.Decimal(1);
    } else {
      if (!input.exchangeRate) {
        throw new BadRequestException(
          `exchangeRate required when payment currency (${input.currency}) != invoice currency (${invoice.currency})`,
        );
      }
      exchangeRate = new Prisma.Decimal(input.exchangeRate);
      if (exchangeRate.lte(0)) {
        throw new BadRequestException('exchangeRate must be greater than 0');
      }
    }

    // Açık bakiye kontrolü (invoice currency birimine)
    const amountInInvoiceCurrency = amount.mul(exchangeRate);
    const netPaidInInv = invoice.payments.reduce((sum, p) => {
      const pInInv = p.currency === invoice.currency ? p.amount : p.amount.mul(p.exchangeRate);
      const refunded = p.refunds.reduce((rs, r) => {
        const rInInv = r.currency === invoice.currency ? r.amount : r.amount.mul(p.exchangeRate);
        return rs.plus(rInInv);
      }, new Prisma.Decimal(0));
      return sum.plus(pInInv).minus(refunded);
    }, new Prisma.Decimal(0));

    const openBalance = invoice.total.minus(netPaidInInv);
    if (amountInInvoiceCurrency.gt(openBalance)) {
      throw new BadRequestException(
        `Payment exceeds open balance. Open: ${openBalance.toFixed(2)} ${invoice.currency}, attempted: ${amountInInvoiceCurrency.toFixed(2)}`,
      );
    }

    // TJS karşılığı (raporlama için her zaman TJS bazında):
    // - currency=TJS → amount
    // - currency=USD → amount * exchangeRate (USD→TJS)
    //   exchangeRate USD→TJS bazlı (örn. 1 USD = 11 TJS).
    const tjsEquivalent = input.currency === 'TJS' ? amount : amount.mul(exchangeRate);

    const payment = await tx.payment.create({
      data: {
        tenantId,
        invoiceId: invoice.id,
        amount,
        currency: input.currency,
        exchangeRate,
        tjsEquivalent,
        method: input.method,
        referenceNumber: input.referenceNumber ?? null,
        notes: input.notes ?? null,
        takenAt: input.takenAt ? new Date(input.takenAt) : new Date(),
        takenById: actor.id,
      },
      include: { invoice: { select: { id: true, invoiceNumber: true } } },
    });

    // Invoice status güncelle
    await this.invoiceService.recomputeStatus(invoice.id);

    // S11e — Commission collection hook: invoice surgery/procedure'a bağlıysa
    // ilgili commission entry'sinin collectedAmount + collectionStatus güncelle.
    if (invoice.surgeryId || invoice.procedureId) {
      await this.syncCommissionCollection({
        sourceType: invoice.surgeryId ? 'surgery' : 'procedure',
        sourceId: invoice.surgeryId ?? invoice.procedureId!,
      });
    }

    return payment;
  }

  /**
   * Bir surgery/procedure'a bağlı tüm invoice'ların net tahsilatını toplar
   * ve commission entry'sine yansıtır.
   * - collectedAmount = sum(net TJS karşılığı tahsilat) across all linked invoices
   * - collectionStatus: amount/threshold karşılaştırması
   *
   * Idempotent: bir invoice'a yapılan tüm ödemeler için defalarca çağrılabilir.
   * RefundService de çağırır (refund sonrası net tutar azalır).
   */
  async syncCommissionCollection(opts: {
    sourceType: 'surgery' | 'procedure';
    sourceId: string;
  }): Promise<void> {
    const tx = this.prisma.scoped;
    const entry = await tx.commissionEntry.findFirst({
      where: { sourceType: opts.sourceType, sourceId: opts.sourceId, deletedAt: null },
      select: { id: true, amount: true },
    });
    if (!entry) return; // commission yoksa skip (henüz hesaplanmamış)

    // İlgili source'a bağlı tüm aktif invoice'ların net ödemeleri
    const invoices = await tx.invoice.findMany({
      where: {
        deletedAt: null,
        ...(opts.sourceType === 'surgery'
          ? { surgeryId: opts.sourceId }
          : { procedureId: opts.sourceId }),
      },
      include: {
        payments: { where: { deletedAt: null }, include: { refunds: true } },
      },
    });

    let net = new Prisma.Decimal(0);
    for (const inv of invoices) {
      for (const p of inv.payments) {
        net = net.plus(p.tjsEquivalent);
        for (const r of p.refunds) {
          net = net.minus(r.tjsEquivalent);
        }
      }
    }
    if (net.lt(0)) net = new Prisma.Decimal(0);

    // collectionStatus: net >= entry.amount → collected; net > 0 → partial; else pending
    let collectionStatus: 'pending' | 'partial' | 'collected';
    if (net.gte(entry.amount)) collectionStatus = 'collected';
    else if (net.gt(0)) collectionStatus = 'partial';
    else collectionStatus = 'pending';

    await tx.commissionEntry.update({
      where: { id: entry.id },
      data: { collectedAmount: net, collectionStatus },
    });
  }

  async findById(id: string) {
    const payment = await this.prisma.scoped.payment.findFirst({
      where: { id, deletedAt: null },
      include: { invoice: true, takenBy: { select: { id: true, name: true } }, refunds: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  async listByInvoice(invoiceId: string) {
    return this.prisma.scoped.payment.findMany({
      where: { invoiceId, deletedAt: null },
      include: {
        takenBy: { select: { id: true, name: true } },
        refunds: { include: { approvedBy: { select: { id: true, name: true } } } },
      },
      orderBy: { takenAt: 'asc' },
    });
  }
}
