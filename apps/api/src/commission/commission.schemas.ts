import { z } from 'zod';
import { PROCEDURE_TYPES } from '../procedure/procedure.schemas';

// E2 Doktor Hakediş — v0.2 dilimi Zod şemaları.

export const COMMISSION_RULE_TYPES = ['per_surgery', 'percentage'] as const;
export const commissionRuleTypeSchema = z.enum(COMMISSION_RULE_TYPES);

export const COMMISSION_ENTRY_STATUSES = ['pending', 'approved', 'paid', 'cancelled'] as const;
export const commissionEntryStatusSchema = z.enum(COMMISSION_ENTRY_STATUSES);

export const COMMISSION_SOURCE_TYPES = ['surgery', 'procedure'] as const;
export const commissionSourceTypeSchema = z.enum(COMMISSION_SOURCE_TYPES);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
// Servis tarafında numerik validasyon yapılıyor; burası yalnızca string format.
const decimalString = z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'invalid decimal (max 2 places)');

// --- Rule ---

export const commissionRuleCreateSchema = z.object({
  doctorId: z.string().uuid().optional().nullable(),
  type: commissionRuleTypeSchema,
  value: decimalString,
  currency: z.string().trim().min(3).max(3).default('USD'),
  applicableSurgeryTypes: z.array(z.string().trim().min(1).max(100)).default([]),
  applicableProcedureTypes: z.array(z.enum(PROCEDURE_TYPES)).default([]),
  priority: z.coerce.number().int().min(0).max(1000).default(0),
  validFrom: isoDate,
  validTo: isoDate.optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export const commissionRuleUpdateSchema = z.object({
  type: commissionRuleTypeSchema.optional(),
  value: decimalString.optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  applicableSurgeryTypes: z.array(z.string().trim().min(1).max(100)).optional(),
  applicableProcedureTypes: z.array(z.enum(PROCEDURE_TYPES)).optional(),
  priority: z.coerce.number().int().min(0).max(1000).optional(),
  validFrom: isoDate.optional(),
  validTo: isoDate.optional().nullable(),
  isActive: z.boolean().optional(),
  notes: z.string().max(1000).optional().nullable(),
});

export const commissionRuleListQuerySchema = z.object({
  doctorId: z.string().uuid().optional(),
  includeInactive: z.boolean().default(false),
});

// --- Entry ---

// Surgery veya procedure tamamlandığında admin tarafından tetiklenir. Yalnız
// PERCENTAGE kuralı seçilirse baseAmount zorunlu (B3 snapshot v0.3'e ertelendi).
export const commissionCalculateSchema = z.object({
  sourceType: commissionSourceTypeSchema,
  sourceId: z.string().uuid(),
  // PERCENTAGE için zorunlu, PER_SURGERY için yoksayılır.
  baseAmount: decimalString.optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  // Kural seçimi otomatik olur; admin override edebilir.
  ruleIdOverride: z.string().uuid().optional(),
});

export const commissionEntryListQuerySchema = z.object({
  doctorId: z.string().uuid().optional(),
  status: commissionEntryStatusSchema.optional(),
  fromDate: isoDate.optional(),
  toDate: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const commissionApproveSchema = z.object({ id: z.string().uuid() });
export const commissionRejectSchema = z.object({
  id: z.string().uuid(),
  rejectionReason: z.string().trim().min(1).max(500),
});
export const commissionMarkPaidSchema = z.object({
  id: z.string().uuid(),
  paidMethod: z.string().trim().min(1).max(50),
  paidAt: z.string().datetime().optional(),
});

export const commissionIdSchema = z.object({ id: z.string().uuid() });

export const commissionMonthlySummaryQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export type CommissionRuleCreateInput = z.infer<typeof commissionRuleCreateSchema>;
export type CommissionRuleUpdateInput = z.infer<typeof commissionRuleUpdateSchema>;
export type CommissionRuleListQuery = z.infer<typeof commissionRuleListQuerySchema>;
export type CommissionCalculateInput = z.infer<typeof commissionCalculateSchema>;
export type CommissionEntryListQuery = z.infer<typeof commissionEntryListQuerySchema>;
export type CommissionRejectInput = z.infer<typeof commissionRejectSchema>;
export type CommissionMarkPaidInput = z.infer<typeof commissionMarkPaidSchema>;
export type CommissionMonthlySummaryQuery = z.infer<typeof commissionMonthlySummaryQuerySchema>;
