// S11d — Billing router loose cast (tRPC v11 AppRouter type recursion önleme,
// P1 #3.25 known type-debt). Schema validation backend Zod + matrix testlerle
// run-time tip emniyeti sağlanır.

import { trpc } from './trpc';

type LooseQuery<TInput, TData> = {
  useQuery: (
    input: TInput,
    opts?: { enabled?: boolean; refetchInterval?: number },
  ) => {
    data: TData | undefined;
    isLoading: boolean;
    isFetching: boolean;
    error: { message: string } | null;
    refetch: () => Promise<unknown>;
  };
};

type LooseMutation<TInput, TData> = {
  useMutation: (opts?: {
    onSuccess?: (data: TData) => void;
    onError?: (err: { message: string }) => void;
  }) => {
    mutate: (input: TInput) => void;
    mutateAsync: (input: TInput) => Promise<TData>;
    isPending: boolean;
  };
};

// ----------- Type shapes (matches backend service include shape) -----------

export interface ServiceItemRow {
  id: string;
  code: string;
  name: string;
  nameRu: string | null;
  nameTg: string | null;
  category: 'examination' | 'surgery' | 'procedure' | 'lab' | 'measurement' | 'other';
  defaultPrice: string;
  defaultCurrency: 'TJS' | 'USD';
  isActive: boolean;
  sortOrder: number;
  // #362 — cerrahi kalemlerde { surgeryGroup, lens, materials }; diğerlerinde {}.
  metadata?: ServiceItemMetadata;
}

export interface ServiceItemMetadata {
  surgeryGroup?: string;
  lens?: string | null;
  materials?: string[];
}

export interface PatientLite {
  id: string;
  firstName: string;
  lastName: string;
  mrn: string;
}

export interface InvoiceItemRow {
  id: string;
  serviceItemId: string | null;
  description: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  sortOrder: number;
}

export interface PaymentRow {
  id: string;
  amount: string;
  currency: 'TJS' | 'USD';
  exchangeRate: string;
  tjsEquivalent: string;
  method: 'cash' | 'card' | 'transfer' | 'insurance';
  referenceNumber: string | null;
  notes: string | null;
  takenAt: string;
  takenBy: { id: string; name: string };
  refundedAt: string | null;
  refunds: RefundRow[];
}

export interface RefundRow {
  id: string;
  amount: string;
  currency: 'TJS' | 'USD';
  tjsEquivalent: string;
  reason: string;
  refundedAt: string;
  // S15-PR15b — 2-aşama meta.
  approvalStatus?: 'pending' | 'approved' | 'rejected' | 'reversed';
  approvedAt?: string | null;
  rejectionReason?: string | null;
  reversedAt?: string | null;
  approvedBy?: { id: string; name: string } | null;
  requestedBy?: { id: string; name: string } | null;
  reversedBy?: { id: string; name: string } | null;
}

// S15-PR18 — Compliance pulse (dashboard widget).
export interface CompliancePulse {
  activeUnpaidEncounters: Array<{
    id: string;
    stage: string;
    stageUpdatedAt: string;
    patient: { id: string; mrn: string; firstName: string; lastName: string };
  }>;
  bypassActiveCount: number;
  bypassTotalToday: number;
}

// S15-PR15b — Pending refund queue row (yönetici onay paneli için).
export interface PendingRefundRow {
  id: string;
  amount: string;
  currency: 'TJS' | 'USD';
  reason: string;
  createdAt: string;
  payment: {
    id: string;
    invoice: { id: string; invoiceNumber: string };
  };
  requestedBy: { id: string; name: string };
}

export interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  patientId: string;
  status: 'open' | 'partial' | 'paid' | 'cancelled' | 'refunded' | 'pending_approval';
  currency: 'TJS' | 'USD';
  subtotal: string;
  discount: string;
  total: string;
  notes: string | null;
  surgeryId: string | null;
  procedureId: string | null;
  appointmentId: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  items: InvoiceItemRow[];
  payments: PaymentRow[];
  patient: PatientLite;
  surgery?: { id: string; type: string; performedAt: string } | null;
  procedure?: { id: string; type: string; performedAt: string } | null;
}

export interface InvoiceListResult {
  items: InvoiceRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OpenBalance {
  invoiceCount: number;
  totalTjsEquivalent: string;
  openTjsEquivalent: string;
}

export interface CashSnapshot {
  paymentCount: number;
  refundCount: number;
  payments: Array<{
    id: string;
    amount: string;
    currency: 'TJS' | 'USD';
    tjsEquivalent: string;
    method: 'cash' | 'card' | 'transfer' | 'insurance';
    takenAt: string;
    takenBy: { id: string; name: string };
    invoice: { id: string; invoiceNumber: string };
  }>;
  refunds: Array<{
    id: string;
    amount: string;
    currency: 'TJS' | 'USD';
    tjsEquivalent: string;
    reason: string;
    refundedAt: string;
    approvedBy?: { id: string; name: string };
    payment: {
      id: string;
      method: 'cash' | 'card' | 'transfer' | 'insurance';
      invoice: { id: string; invoiceNumber: string };
    };
  }>;
  totalTjs: string;
  totalUsd: string;
  totalTjsEquivalent: string;
  cashTjs: string;
  cashUsd: string;
  cardTjs: string;
  cardUsd: string;
  transferTjs: string;
  transferUsd: string;
  insuranceTjs: string;
  insuranceUsd: string;
  refundTjs: string;
  refundUsd: string;
  netTjsEquivalent: string;
}

export interface CashClosureRow {
  id: string;
  closedAt: string;
  closedBy: { id: string; name: string };
  totalTjs: string;
  totalUsd: string;
  totalTjsEquivalent: string;
  cashTjs: string;
  cashUsd: string;
  cardTjs: string;
  cardUsd: string;
  transferTjs: string;
  transferUsd: string;
  insuranceTjs: string;
  insuranceUsd: string;
  refundTjs: string;
  refundUsd: string;
  netTjsEquivalent: string;
  paymentCount: number;
  refundCount: number;
  notes: string | null;
}

export interface CashClosureList {
  items: CashClosureRow[];
  total: number;
  page: number;
  pageSize: number;
}

// R5 (#727) — Kasa kapatma taslağı (asistan hazırlar, yönetici finalize eder).
export interface CashDraftRow {
  id: string;
  status: 'draft' | 'finalized';
  preparedBy: { id: string; name: string } | null;
  preparedAt: string | null;
  totalTjs: string;
  totalUsd: string;
  totalTjsEquivalent: string;
  cashTjs: string;
  cashUsd: string;
  cardTjs: string;
  cardUsd: string;
  transferTjs: string;
  transferUsd: string;
  insuranceTjs: string;
  insuranceUsd: string;
  refundTjs: string;
  refundUsd: string;
  netTjsEquivalent: string;
  paymentCount: number;
  refundCount: number;
  notes: string | null;
}

// ----------- Loose router -----------

interface BillingRouter {
  listServiceItems: LooseQuery<{ category?: string; includeInactive?: boolean }, ServiceItemRow[]>;
  createServiceItem: LooseMutation<unknown, ServiceItemRow>;
  updateServiceItem: LooseMutation<unknown, ServiceItemRow>;
  softDeleteServiceItem: LooseMutation<{ id: string }, { ok: true }>;

  listInvoices: LooseQuery<
    {
      patientId?: string;
      status?: string;
      search?: string;
      fromDate?: string;
      toDate?: string;
      page?: number;
      pageSize?: number;
    },
    InvoiceListResult
  >;
  findInvoice: LooseQuery<{ id: string }, InvoiceRow>;
  listInvoicesByPatient: LooseQuery<{ patientId: string }, InvoiceRow[]>;
  openBalance: LooseQuery<{ patientId: string }, OpenBalance>;
  // #419b — güncel USD→TJS kuru (NBT cron); kayıt yoksa null.
  currentRate: LooseQuery<void, { rate: string; asOf: string; source: string } | null>;
  createInvoice: LooseMutation<unknown, InvoiceRow>;
  cancelInvoice: LooseMutation<{ id: string; reason: string }, InvoiceRow>;

  listPaymentsByInvoice: LooseQuery<{ invoiceId: string }, PaymentRow[]>;
  createPayment: LooseMutation<unknown, PaymentRow>;

  createRefund: LooseMutation<unknown, RefundRow>;
  // S15-PR15b — 2-aşamalı iade endpoint'leri.
  requestRefund: LooseMutation<unknown, RefundRow>;
  approveRefund: LooseMutation<{ refundId: string }, RefundRow>;
  rejectRefund: LooseMutation<{ refundId: string; rejectionReason: string }, RefundRow>;
  reverseRefund: LooseMutation<{ refundId: string }, RefundRow>;
  listPendingRefunds: LooseQuery<undefined | Record<string, never>, PendingRefundRow[]>;

  // S15-PR18 — "Önce öde" compliance pulse (dashboard).
  compliancePulse: LooseQuery<undefined | Record<string, never>, CompliancePulse>;

  cashSnapshot: LooseQuery<undefined | Record<string, never>, CashSnapshot>;
  listCashClosures: LooseQuery<
    { fromDate?: string; toDate?: string; page?: number; pageSize?: number },
    CashClosureList
  >;
  findCashClosure: LooseQuery<{ id: string }, CashClosureRow>;
  closeCashRegister: LooseMutation<{ notes?: string | null }, CashClosureRow>;
  // R5 (#727) — 2-aşama kapatma taslağı.
  currentCashDraft: LooseQuery<undefined | Record<string, never>, CashDraftRow | null>;
  prepareCashDraft: LooseMutation<{ notes?: string | null }, CashDraftRow>;
  finalizeCashDraft: LooseMutation<{ id: string }, CashClosureRow>;
  discardCashDraft: LooseMutation<{ id: string }, { discarded: boolean }>;
}

export const billingApi = trpc.billing as unknown as BillingRouter;
