import { z } from 'zod';
import {
  cashRegisterCloseSchema,
  cashRegisterIdSchema,
  cashRegisterListQuerySchema,
  invoiceCancelSchema,
  invoiceCreateSchema,
  invoiceIdSchema,
  invoiceListQuerySchema,
  invoiceUpdateSchema,
  paymentCreateSchema,
  paymentIdSchema,
  paymentListByInvoiceSchema,
  refundApproveSchema,
  refundCreateSchema,
  refundIdSchema,
  refundRejectSchema,
  refundReverseSchema,
  serviceItemCreateSchema,
  serviceItemIdSchema,
  serviceItemListQuerySchema,
  serviceItemUpdateSchema,
} from '../../billing/billing.schemas';
import { CashRegisterService } from '../../billing/cash-register.service';
import { InvoiceService } from '../../billing/invoice.service';
import { PaymentService } from '../../billing/payment.service';
import { RatesService } from '../../billing/rates.service';
import { RefundService } from '../../billing/refund.service';
import { ServiceItemService } from '../../billing/service-item.service';
import { permissionProcedure, protectedProcedure, router } from '../trpc';

// S11c — Billing tRPC router (tek dosyada 5 alt grup: serviceItem, invoice,
// payment, refund, cashRegister). Permission'lar S11c'de tanımlı.

const patientIdInput = z.object({ patientId: z.string().uuid() });

export const billingRouterFactory = (deps: {
  serviceItems: ServiceItemService;
  invoices: InvoiceService;
  payments: PaymentService;
  refunds: RefundService;
  cashRegister: CashRegisterService;
  rates: RatesService;
}) =>
  router({
    // -------------------- ServiceItem (katalog) --------------------

    listServiceItems: protectedProcedure
      .input(serviceItemListQuerySchema)
      .query(({ input }) => deps.serviceItems.list(input)),

    findServiceItem: protectedProcedure
      .input(serviceItemIdSchema)
      .query(({ input }) => deps.serviceItems.findById(input.id)),

    createServiceItem: permissionProcedure('action:serviceItem.create')
      .input(serviceItemCreateSchema)
      .mutation(({ input, ctx }) => deps.serviceItems.create(input, { id: ctx.user!.sub })),

    updateServiceItem: permissionProcedure('action:serviceItem.update')
      .input(serviceItemIdSchema.extend({ data: serviceItemUpdateSchema }))
      .mutation(({ input }) => deps.serviceItems.update(input.id, input.data)),

    softDeleteServiceItem: permissionProcedure('action:serviceItem.softDelete')
      .input(serviceItemIdSchema)
      .mutation(async ({ input }) => {
        await deps.serviceItems.softDelete(input.id);
        return { ok: true as const };
      }),

    // -------------------- Invoice (fatura) --------------------

    listInvoices: protectedProcedure
      .input(invoiceListQuerySchema)
      .query(({ input }) => deps.invoices.list(input)),

    findInvoice: protectedProcedure
      .input(invoiceIdSchema)
      .query(({ input }) => deps.invoices.findById(input.id)),

    listInvoicesByPatient: protectedProcedure
      .input(patientIdInput)
      .query(({ input }) => deps.invoices.listByPatient(input.patientId)),

    openBalance: protectedProcedure
      .input(patientIdInput)
      .query(({ input }) => deps.invoices.getOpenBalance(input.patientId)),

    // #419b — Güncel USD→TJS kuru (PaymentDialog hardcoded 11.00 yerine). NBT
    // cron'unun yazdığı en güncel satır; yoksa null (frontend fallback uygular).
    currentRate: protectedProcedure.query(() => deps.rates.currentUsdTjs()),

    createInvoice: permissionProcedure('action:invoice.create')
      .input(invoiceCreateSchema)
      .mutation(({ input, ctx }) =>
        // S12a — actor.roles cerrahi bağ kontrolü için
        deps.invoices.create(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    updateInvoice: permissionProcedure('action:invoice.update')
      .input(invoiceIdSchema.extend({ data: invoiceUpdateSchema }))
      .mutation(({ input, ctx }) =>
        deps.invoices.update(input.id, input.data, {
          id: ctx.user!.sub,
          roles: ctx.user!.roles,
        }),
      ),

    cancelInvoice: permissionProcedure('action:invoice.cancel')
      .input(invoiceCancelSchema)
      .mutation(({ input, ctx }) =>
        deps.invoices.cancel(input.id, input.reason, { id: ctx.user!.sub }),
      ),

    // -------------------- Payment (tahsilat) --------------------

    listPaymentsByInvoice: protectedProcedure
      .input(paymentListByInvoiceSchema)
      .query(({ input }) => deps.payments.listByInvoice(input.invoiceId)),

    findPayment: protectedProcedure
      .input(paymentIdSchema)
      .query(({ input }) => deps.payments.findById(input.id)),

    createPayment: permissionProcedure('action:payment.create')
      .input(paymentCreateSchema)
      .mutation(({ input, ctx }) =>
        deps.payments.create(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    // -------------------- Refund (iade) — S15-PR15b 2-aşama --------------------

    // Legacy tek-aşama (yönetici tek başına): create. Yönetici değilse pending kalır.
    createRefund: permissionProcedure('action:payment.refund')
      .input(refundCreateSchema)
      .mutation(({ input, ctx }) =>
        deps.refunds.create(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    // PR15b — Talep (resepsiyon/asistan/yönetici).
    requestRefund: permissionProcedure('action:payment.refundRequest')
      .input(refundCreateSchema)
      .mutation(({ input, ctx }) =>
        deps.refunds.request(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    // PR15b — Onay (yalnız yönetici).
    approveRefund: permissionProcedure('action:payment.refundApprove')
      .input(refundApproveSchema)
      .mutation(({ input, ctx }) =>
        deps.refunds.approve(input.refundId, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    // PR15b — Red (yalnız yönetici).
    rejectRefund: permissionProcedure('action:payment.refundApprove')
      .input(refundRejectSchema)
      .mutation(({ input, ctx }) =>
        deps.refunds.reject(input, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    // PR15b — 24h reverse (yalnız yönetici).
    reverseRefund: permissionProcedure('action:payment.refundReverse')
      .input(refundReverseSchema)
      .mutation(({ input, ctx }) =>
        deps.refunds.reverse(input.refundId, { id: ctx.user!.sub, roles: ctx.user!.roles }),
      ),

    // PR15b — Pending refund kuyruğu (yönetici onay paneli için).
    listPendingRefunds: permissionProcedure('action:payment.refundApprove').query(() =>
      deps.refunds.listPending(),
    ),

    findRefund: protectedProcedure
      .input(refundIdSchema)
      .query(({ input }) => deps.refunds.findById(input.id)),

    // S15-PR18 — "Önce öde" compliance pulse (dashboard widget).
    compliancePulse: protectedProcedure.query(() => deps.invoices.compliancePulse()),

    // -------------------- CashRegister (Z-raporu) --------------------

    cashSnapshot: protectedProcedure
      .input(z.object({}).optional())
      .query(() => deps.cashRegister.currentSnapshot()),

    listCashClosures: protectedProcedure
      .input(cashRegisterListQuerySchema)
      .query(({ input }) => deps.cashRegister.list(input)),

    findCashClosure: protectedProcedure
      .input(cashRegisterIdSchema)
      .query(({ input }) => deps.cashRegister.findById(input.id)),

    closeCashRegister: permissionProcedure('action:cashRegister.close')
      .input(cashRegisterCloseSchema)
      .mutation(({ input, ctx }) => deps.cashRegister.close(input, { id: ctx.user!.sub })),

    // R5 (#727) — 2-aşama: asistan taslak hazırlar, yönetici/finans finalize eder.
    currentCashDraft: protectedProcedure.query(() => deps.cashRegister.currentDraft()),

    prepareCashDraft: permissionProcedure('action:cashRegister.prepareDraft')
      .input(cashRegisterCloseSchema)
      .mutation(({ input, ctx }) => deps.cashRegister.prepareDraft(input, { id: ctx.user!.sub })),

    finalizeCashDraft: permissionProcedure('action:cashRegister.close')
      .input(cashRegisterIdSchema)
      .mutation(({ input, ctx }) =>
        deps.cashRegister.finalizeDraft(input.id, { id: ctx.user!.sub }),
      ),

    discardCashDraft: permissionProcedure('action:cashRegister.prepareDraft')
      .input(cashRegisterIdSchema)
      .mutation(({ input }) => deps.cashRegister.discardDraft(input.id)),
  });
