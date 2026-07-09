import { z } from 'zod';

// S14 — v0.1 indirim onayı port. Zod şemaları.
// Karar: /Users/alid/.claude/plans/bunlar-n-hepsini-uygun-bir-joyful-melody.md

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const approvalStatusSchema = z.enum(APPROVAL_STATUSES);
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_DECISIONS = ['approved', 'rejected'] as const;
export const approvalDecisionSchema = z.enum(APPROVAL_DECISIONS);
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

const decimalString = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'invalid decimal (positive, max 2 places)');

const percentString = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'invalid percent (0..100, max 2 places)')
  .refine((v) => Number(v) >= 0 && Number(v) <= 100, 'percent must be between 0 and 100');

// İndirim onayı request — service.requestForInvoice / requestForSurgery'den
// çağrılır; doğrudan API'ye expose edilmiyor (her zaman invoice/surgery
// create akışından otomatik tetiklenir).
export const discountApprovalRequestSchema = z
  .object({
    invoiceId: z.string().uuid().optional().nullable(),
    surgeryId: z.string().uuid().optional().nullable(),
    discountPercent: percentString,
    discountAmount: decimalString,
    reason: z.string().trim().min(10, 'sebep en az 10 karakter').max(500),
  })
  .refine(
    (v) => Boolean(v.invoiceId) || Boolean(v.surgeryId),
    'invoiceId veya surgeryId en az biri zorunlu',
  );

// Review — yonetici / yonetici_asistani aksiyonu.
export const discountApprovalReviewSchema = z.object({
  id: z.string().uuid(),
  decision: approvalDecisionSchema,
  note: z.string().trim().max(500).optional().nullable(),
});

// List filtreleri — pending dashboard widget'ı ve ApprovalsPage için.
export const discountApprovalListQuerySchema = z.object({
  status: approvalStatusSchema.optional(),
  scope: z.enum(['invoice', 'surgery', 'all']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const discountApprovalIdSchema = z.object({ id: z.string().uuid() });

// R5 (#727) — "Eskale et": yönetici asistanı bekleyen onayı yöneticilere iletir.
// note opsiyonel (asistan bağlam ekleyebilir; onayın kendi reason'ı zaten var).
export const discountApprovalEscalateSchema = z.object({
  id: z.string().uuid(),
  note: z.string().trim().max(500).optional().nullable(),
});

export type DiscountApprovalRequestInput = z.infer<typeof discountApprovalRequestSchema>;
export type DiscountApprovalReviewInput = z.infer<typeof discountApprovalReviewSchema>;
export type DiscountApprovalListQuery = z.infer<typeof discountApprovalListQuerySchema>;
export type DiscountApprovalEscalateInput = z.infer<typeof discountApprovalEscalateSchema>;
