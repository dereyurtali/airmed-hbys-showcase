import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { DiscountApprovalService } from './approval/approval.service';
import { BillingController } from './billing.controller';
import { CashRegisterService } from './cash-register.service';
import { InvoiceService } from './invoice.service';
import { PaymentService } from './payment.service';
import { ReceiptPdfService } from './receipt-pdf.service';
import { RatesService } from './rates.service';
import { RefundService } from './refund.service';
import { ServiceItemService } from './service-item.service';

// S11b — Billing modülü (tahsilat / faturalama).
// Tasarım: docs/audits/2026-05-28-tahsilat-modul-tasarimi.md
//
// 5 service + S14 indirim onayı:
//   - ServiceItemService     — hizmet kataloğu CRUD
//   - InvoiceService         — fatura yaratma + güncelleme + iptal + status compute
//   - PaymentService         — tahsilat al (invoice.recomputeStatus tetikler)
//   - RefundService          — iade kaydı (yönetici onayı, payment.refundedAt set)
//   - CashRegisterService    — Z-raporu (kapanmamış payment+refund'ları kapatma)
//   - DiscountApprovalService— S14 v0.1 port: rol cap'i aşan indirim için onay state machine

@Module({
  imports: [NotificationModule],
  controllers: [BillingController],
  providers: [
    ServiceItemService,
    InvoiceService,
    PaymentService,
    RefundService,
    CashRegisterService,
    ReceiptPdfService,
    DiscountApprovalService,
    RatesService,
  ],
  exports: [
    ServiceItemService,
    InvoiceService,
    PaymentService,
    RefundService,
    CashRegisterService,
    ReceiptPdfService,
    DiscountApprovalService,
    RatesService,
  ],
})
export class BillingModule {}
