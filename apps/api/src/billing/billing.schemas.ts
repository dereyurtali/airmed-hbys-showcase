import { z } from 'zod';

// S11b — Billing modülü Zod şemaları.
// Karar tutanağı: docs/audits/2026-05-28-tahsilat-modul-tasarimi.md

export const CURRENCIES = ['TJS', 'USD'] as const;
export const currencySchema = z.enum(CURRENCIES);
export type CurrencyKey = (typeof CURRENCIES)[number];

export const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'insurance'] as const;
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);

export const SERVICE_CATEGORIES = [
  'examination',
  'surgery',
  'procedure',
  'lab',
  'measurement',
  'other',
] as const;
export const serviceCategorySchema = z.enum(SERVICE_CATEGORIES);

export const INVOICE_STATUSES = [
  'open',
  'partial',
  'paid',
  'cancelled',
  'refunded',
  // S14 — v0.1 indirim onayı port: rol cap'ini aşan indirim onay beklerken
  'pending_approval',
] as const;
export const invoiceStatusSchema = z.enum(INVOICE_STATUSES);

// Decimal as string for precision (Prisma.Decimal). 2 ondalık basamak max.
const decimalString = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'invalid decimal (positive, max 2 places)');

// 4 ondalık basamak (kur — örn. 1 USD = 10.9234 TJS)
const exchangeRateString = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'invalid exchange rate (positive, max 4 places)');

// =============================================================================
// ServiceItem (hizmet kataloğu)
// =============================================================================

// Madde 5 — ServiceItem.preconditions JSON yapısı.
// Üç bağımsız kural:
//   1. Yaş limit (minAge/maxAge) — hasta uygun değilse uyarı (sonraki PR'da
//      cerrahi seçiminde hard block uygulanır).
//   2. Zorunlu hizmet kodları — bu hizmet seçilmeden önce hastanın aynı gün
//      tamamlamış olması gereken kodlar (cerrahide ölçüm zorunluluğu).
//   3. Yaş bazlı otomatik indirim — eşik üstü hastalara fatura kesilirken
//      otomatik % iskonto.
export const servicePreconditionsSchema = z
  .object({
    minAge: z.number().int().min(0).max(150).nullable().optional(),
    maxAge: z.number().int().min(0).max(150).nullable().optional(),
    requiredServiceCodes: z
      .array(
        z
          .string()
          .regex(/^[A-Z0-9_]+$/)
          .max(50),
      )
      .max(20)
      .optional(),
    ageDiscount: z
      .object({
        minAge: z.number().int().min(0).max(150),
        percent: z.number().min(0).max(100),
      })
      .nullable()
      .optional(),
  })
  .optional();
export type ServicePreconditions = z.infer<typeof servicePreconditionsSchema>;

// #362 — kategori-özel yapısal metadata (gating DEĞİL). Cerrahi kataloğu için
// ServiceItem'a taşınan alanlar: alt-grup (Katarakt/Refraktif/…), lens tipi,
// malzeme listesi. Diğer kategorilerde boş bırakılır.
export const serviceMetadataSchema = z
  .object({
    surgeryGroup: z.string().trim().max(50).optional(),
    lens: z.string().trim().max(50).nullable().optional(),
    materials: z.array(z.string().trim().max(120)).max(30).optional(),
  })
  .optional();
export type ServiceMetadata = z.infer<typeof serviceMetadataSchema>;

export const serviceItemCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'code en az 2 karakter')
    .max(50)
    .regex(/^[A-Z0-9_]+$/, 'code yalnız büyük harf + rakam + _'),
  name: z.string().trim().min(1).max(200),
  nameRu: z.string().trim().max(200).optional().nullable(),
  nameTg: z.string().trim().max(200).optional().nullable(),
  category: serviceCategorySchema,
  defaultPrice: decimalString,
  defaultCurrency: currencySchema.default('TJS'),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  preconditions: servicePreconditionsSchema,
  metadata: serviceMetadataSchema,
});

export const serviceItemUpdateSchema = serviceItemCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const serviceItemListQuerySchema = z.object({
  category: serviceCategorySchema.optional(),
  includeInactive: z.boolean().default(false),
});

export const serviceItemIdSchema = z.object({ id: z.string().uuid() });

export type ServiceItemCreateInput = z.infer<typeof serviceItemCreateSchema>;
export type ServiceItemUpdateInput = z.infer<typeof serviceItemUpdateSchema>;
export type ServiceItemListQuery = z.infer<typeof serviceItemListQuerySchema>;

// =============================================================================
// Invoice + InvoiceItem
// =============================================================================

const invoiceItemInputSchema = z.object({
  serviceItemId: z.string().uuid().optional().nullable(),
  description: z.string().trim().min(1).max(300),
  quantity: z.coerce.number().int().min(1).max(1000).default(1),
  unitPrice: decimalString,
});

export const invoiceCreateSchema = z.object({
  patientId: z.string().uuid(),
  currency: currencySchema.default('TJS'),
  discount: decimalString.default('0'),
  // S14 — Kullanıcının rol cap'ini aşan indirim için onay gerekçesi (min 10
  // karakter). UI cap'i önceden bilir ve kullanıcıdan ister; backend defansif
  // olarak doğrular.
  discountReason: z.string().trim().min(10).max(500).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  surgeryId: z.string().uuid().optional().nullable(),
  procedureId: z.string().uuid().optional().nullable(),
  appointmentId: z.string().uuid().optional().nullable(),
  items: z.array(invoiceItemInputSchema).min(1, 'en az 1 kalem zorunlu'),
});

export const invoiceUpdateSchema = z.object({
  discount: decimalString.optional(),
  discountReason: z.string().trim().min(10).max(500).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  items: z.array(invoiceItemInputSchema).min(1).optional(),
});

export const invoiceCancelSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(10, 'sebep en az 10 karakter').max(500),
});

export const invoiceIdSchema = z.object({ id: z.string().uuid() });

export const invoiceListQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  status: invoiceStatusSchema.optional(),
  // #401 — Server-side arama: fatura no veya hasta adı/MRN. Eskiden yalnız ilk
  // 50 client-side filtreleniyordu → eski faturalar bulunamıyordu.
  search: z.string().trim().min(1).max(100).optional(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>;
export type InvoiceUpdateInput = z.infer<typeof invoiceUpdateSchema>;
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

// =============================================================================
// Payment
// =============================================================================

export const paymentCreateSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: decimalString,
  currency: currencySchema,
  // Eğer invoice currency != payment currency → kur zorunlu
  // (servis tarafında doğrulanır; burada string format check)
  exchangeRate: exchangeRateString.optional(),
  method: paymentMethodSchema,
  referenceNumber: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  // Geriye dönük kayıt için (örn. dünkü tahsilat geç girildi)
  takenAt: z.string().datetime().optional(),
});

export const paymentIdSchema = z.object({ id: z.string().uuid() });

export const paymentListByInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
});

export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;

// =============================================================================
// Refund
// =============================================================================

export const refundCreateSchema = z.object({
  paymentId: z.string().uuid(),
  amount: decimalString,
  reason: z.string().trim().min(10, 'sebep en az 10 karakter').max(500),
});

export const refundIdSchema = z.object({ id: z.string().uuid() });

// S15-PR15b — Reject + reverse + approve şemaları.
export const refundApproveSchema = z.object({ refundId: z.string().uuid() });
export const refundRejectSchema = z.object({
  refundId: z.string().uuid(),
  rejectionReason: z.string().trim().min(10, 'red sebebi en az 10 karakter').max(500),
});
export const refundReverseSchema = z.object({ refundId: z.string().uuid() });

export type RefundCreateInput = z.infer<typeof refundCreateSchema>;
export type RefundApproveInput = z.infer<typeof refundApproveSchema>;
export type RefundRejectInput = z.infer<typeof refundRejectSchema>;
export type RefundReverseInput = z.infer<typeof refundReverseSchema>;

// =============================================================================
// CashRegister (Z-raporu)
// =============================================================================

export const cashRegisterCloseSchema = z.object({
  // Sayman fiziksel sayım ile teyit eder (opsiyonel; rapor üretirken not'a eklenir)
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const cashRegisterIdSchema = z.object({ id: z.string().uuid() });

export const cashRegisterListQuerySchema = z.object({
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// "Bugünün özeti" — kapanmamış (cashRegisterClosureId NULL) Payment+Refund'ların
// güncel agregeleri (sayman kapatmadan önce görür).
export const currentSnapshotSchema = z.object({});

export type CashRegisterCloseInput = z.infer<typeof cashRegisterCloseSchema>;
export type CashRegisterListQuery = z.infer<typeof cashRegisterListQuerySchema>;
