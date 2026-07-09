import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import type { RefundCreateInput, RefundRejectInput } from './billing.schemas';
import { InvoiceService } from './invoice.service';
import { PaymentService } from './payment.service';

// S11b + S15-PR15b — Refund (iade) service, 2-aşamalı.
//
// Akış:
//   1. request(): resepsiyon/asistan/yönetici → status=pending oluşturur.
//      Payment side-effects tetiklenmez.
//   2. approve(): yalnız yönetici → pending→approved, refundedAt set, invoice
//      recompute, commission sync.
//   3. reject(): yalnız yönetici → pending→rejected, sebep ile.
//   4. reverse(): yalnız yönetici, approvedAt < 24h içinde → approved→reversed,
//      Payment.refundedAt geri al, invoice/commission yeniden hesapla.
//
// Eski (legacy) `create()` çağrıları router üzerinde `request()` + `approve()`
// kombinasyonuna eşittir; backward-compat için `create` adı korunur.

interface Actor {
  id: string;
  roles: readonly string[];
}

const MANAGER_ROLES = ['yonetici'];
const REVERSAL_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class RefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly invoiceService: InvoiceService,
    private readonly paymentService: PaymentService,
  ) {}

  private assertManager(actor: Actor) {
    if (!actor.roles.some((r) => MANAGER_ROLES.includes(r))) {
      throw new ForbiddenException('Bu işlemi yalnız yönetici onaylayabilir.');
    }
  }

  // PR15b — Talep (pending). Payment side-effects yok.
  async request(input: RefundCreateInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    const amount = new Prisma.Decimal(input.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('amount must be greater than 0');
    }

    const tx = this.prisma.scoped;
    const payment = await tx.payment.findFirst({
      where: { id: input.paymentId, deletedAt: null },
      include: { refunds: true, invoice: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.invoice.deletedAt) {
      throw new BadRequestException('Cannot refund payment of deleted invoice');
    }

    // pending iade talepleri de henüz "rezerve" sayılır — toplam ile karşılaştır.
    const reservedOrApproved = payment.refunds
      .filter((r) => r.approvalStatus === 'pending' || r.approvalStatus === 'approved')
      .reduce(
        (sum: Prisma.Decimal, r: { amount: Prisma.Decimal }) => sum.plus(r.amount),
        new Prisma.Decimal(0),
      );
    const refundable = payment.amount.minus(reservedOrApproved);
    if (amount.gt(refundable)) {
      throw new BadRequestException(
        `Refund exceeds refundable amount. Refundable: ${refundable.toFixed(2)} ${payment.currency}, attempted: ${amount.toFixed(2)}`,
      );
    }

    const tjsEquivalent = payment.currency === 'TJS' ? amount : amount.mul(payment.exchangeRate);

    return tx.refund.create({
      data: {
        tenantId,
        paymentId: payment.id,
        amount,
        currency: payment.currency,
        tjsEquivalent,
        reason: input.reason,
        requestedById: actor.id,
        approvalStatus: 'pending',
      },
      include: { payment: { select: { id: true, invoiceId: true } } },
    });
  }

  // PR15b — Yönetici onayı. Pending → approved. Yan etkiler burada işler.
  async approve(refundId: string, actor: Actor) {
    this.assertManager(actor);
    const tx = this.prisma.scoped;
    const refund = await tx.refund.findFirst({
      where: { id: refundId },
      include: { payment: { include: { refunds: true, invoice: true } } },
    });
    if (!refund) throw new NotFoundException('Refund not found');
    if (refund.approvalStatus !== 'pending') {
      throw new BadRequestException(
        `Refund ${refundId} approvalStatus=${refund.approvalStatus}, sadece pending iade onaylanabilir`,
      );
    }

    const updated = await tx.refund.update({
      where: { id: refundId },
      data: {
        approvalStatus: 'approved',
        approvedById: actor.id,
        approvedAt: new Date(),
      },
      include: { payment: { select: { id: true, invoiceId: true } } },
    });

    // Payment.refundedAt'i toplam approved refund tutarına göre güncelle.
    const totalApproved = refund.payment.refunds
      .filter((r) => r.id === refundId || r.approvalStatus === 'approved')
      .reduce(
        (sum: Prisma.Decimal, r: { amount: Prisma.Decimal }) => sum.plus(r.amount),
        new Prisma.Decimal(0),
      );
    if (totalApproved.gte(refund.payment.amount)) {
      await tx.payment.update({
        where: { id: refund.payment.id },
        data: { refundedAt: new Date() },
      });
    }

    await this.invoiceService.recomputeStatus(refund.payment.invoice.id);

    if (refund.payment.invoice.surgeryId || refund.payment.invoice.procedureId) {
      await this.paymentService.syncCommissionCollection({
        sourceType: refund.payment.invoice.surgeryId ? 'surgery' : 'procedure',
        sourceId: refund.payment.invoice.surgeryId ?? refund.payment.invoice.procedureId!,
      });
    }

    return updated;
  }

  // PR15b — Yönetici reddi. Pending → rejected. Yan etki yok.
  async reject(input: RefundRejectInput, actor: Actor) {
    this.assertManager(actor);
    const tx = this.prisma.scoped;
    const refund = await tx.refund.findFirst({ where: { id: input.refundId } });
    if (!refund) throw new NotFoundException('Refund not found');
    if (refund.approvalStatus !== 'pending') {
      throw new BadRequestException(
        `Refund ${input.refundId} approvalStatus=${refund.approvalStatus}, sadece pending iade reddedilebilir`,
      );
    }
    return tx.refund.update({
      where: { id: input.refundId },
      data: {
        approvalStatus: 'rejected',
        approvedById: actor.id,
        approvedAt: new Date(),
        rejectionReason: input.rejectionReason,
      },
    });
  }

  // PR15b — Yönetici reverse (24h). Approved → reversed. Yan etkiler geri alınır.
  async reverse(refundId: string, actor: Actor) {
    this.assertManager(actor);
    const tx = this.prisma.scoped;
    const refund = await tx.refund.findFirst({
      where: { id: refundId },
      include: { payment: { include: { refunds: true, invoice: true } } },
    });
    if (!refund) throw new NotFoundException('Refund not found');
    if (refund.approvalStatus !== 'approved') {
      throw new BadRequestException('Yalnız approved iade reverse edilebilir.');
    }
    if (!refund.approvedAt) {
      throw new BadRequestException('Refund approvedAt missing — corrupt state.');
    }
    if (Date.now() - refund.approvedAt.getTime() > REVERSAL_WINDOW_MS) {
      throw new BadRequestException(
        '24 saatlik reverse penceresi doldu. Yeni Payment ile düzeltme yapılmalı.',
      );
    }

    const updated = await tx.refund.update({
      where: { id: refundId },
      data: {
        approvalStatus: 'reversed',
        reversedAt: new Date(),
        reversedById: actor.id,
      },
      include: { payment: { select: { id: true, invoiceId: true } } },
    });

    // Payment.refundedAt geri al (artık tam iade değil).
    const totalApprovedExcludingThis = refund.payment.refunds
      .filter((r) => r.id !== refundId && r.approvalStatus === 'approved')
      .reduce(
        (sum: Prisma.Decimal, r: { amount: Prisma.Decimal }) => sum.plus(r.amount),
        new Prisma.Decimal(0),
      );
    if (totalApprovedExcludingThis.lt(refund.payment.amount)) {
      await tx.payment.update({
        where: { id: refund.payment.id },
        data: { refundedAt: null },
      });
    }

    await this.invoiceService.recomputeStatus(refund.payment.invoice.id);

    if (refund.payment.invoice.surgeryId || refund.payment.invoice.procedureId) {
      await this.paymentService.syncCommissionCollection({
        sourceType: refund.payment.invoice.surgeryId ? 'surgery' : 'procedure',
        sourceId: refund.payment.invoice.surgeryId ?? refund.payment.invoice.procedureId!,
      });
    }

    return updated;
  }

  // S11b backward-compat: tek-aşama akış (yönetici tek başına talep+onay).
  // Router yetki gate'i koruma sağlar; service yalnız bu wrapper'ı sunar.
  async create(input: RefundCreateInput, actor: Actor) {
    const requested = await this.request(input, actor);
    if (!actor.roles.some((r) => MANAGER_ROLES.includes(r))) {
      // Yönetici değilse pending kalsın.
      return requested;
    }
    return this.approve(requested.id, actor);
  }

  async findById(id: string) {
    const refund = await this.prisma.scoped.refund.findFirst({
      where: { id },
      include: {
        payment: { include: { invoice: { select: { id: true, invoiceNumber: true } } } },
        requestedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        reversedBy: { select: { id: true, name: true } },
      },
    });
    if (!refund) throw new NotFoundException('Refund not found');
    return refund;
  }

  async listPending() {
    return this.prisma.scoped.refund.findMany({
      where: { approvalStatus: 'pending' },
      include: {
        payment: { include: { invoice: { select: { id: true, invoiceNumber: true } } } },
        requestedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
