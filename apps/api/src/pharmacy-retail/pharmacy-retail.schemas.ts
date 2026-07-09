import { z } from 'zod';

// v0.4 #552 — Eczane perakende (POS) giriş şemaları. Modeller #551'de.

const currency = z.enum(['TJS', 'USD']);
const paymentMethod = z.enum(['cash', 'card', 'transfer', 'insurance']);

// --- Ürün katalog ---
export const productCreateSchema = z.object({
  code: z.string().trim().min(1).max(50),
  barcode: z.string().trim().max(64).optional().nullable(),
  name: z.string().trim().min(1).max(200),
  nameRu: z.string().trim().max(200).optional().nullable(),
  nameTg: z.string().trim().max(200).optional().nullable(),
  category: z.string().trim().max(60).optional().nullable(),
  unit: z.string().trim().max(30).optional().nullable(),
  requiresPrescription: z.boolean().default(false),
});
export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export const productUpdateSchema = productCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
export const productListQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  includeInactive: z.boolean().default(false),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

// --- Parti (lot/SKT/fiyat) — mal kabul ---
export const batchCreateSchema = z.object({
  productId: z.string().uuid(),
  lotNumber: z.string().trim().max(100).optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  costPrice: z.number().nonnegative().optional().nullable(),
  salePrice: z.number().nonnegative(),
  currency: currency.default('TJS'),
  quantity: z.number().int().nonnegative().default(0),
  supplierId: z.string().uuid().optional().nullable(),
});
export type BatchCreateInput = z.infer<typeof batchCreateSchema>;
export const batchAdjustSchema = z.object({
  id: z.string().uuid(),
  delta: z.number().int(),
  reason: z.string().max(200).optional().nullable(),
});
export type BatchAdjustInput = z.infer<typeof batchAdjustSchema>;

// --- POS satış ---
export const saleItemSchema = z.object({
  productId: z.string().uuid(),
  batchId: z.string().uuid().optional().nullable(),
  itemName: z.string().trim().min(1).max(200),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  // #790 — eczacının manuel eşlediği reçete kalemi metni (muadil/kısmi audit izi).
  prescriptionItemLabel: z.string().trim().max(200).optional().nullable(),
});

// #790 — eczacı reçeteyi dağıttıkça durumu işaretler (kısmi = bazı kalemler kaldı).
export const prescriptionDispenseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['partial', 'dispensed']),
});
export type PrescriptionDispenseInput = z.infer<typeof prescriptionDispenseSchema>;
export const saleCreateSchema = z.object({
  items: z.array(saleItemSchema).min(1),
  isAnonymous: z.boolean().default(true),
  patientId: z.string().uuid().optional().nullable(),
  prescriptionId: z.string().uuid().optional().nullable(),
  discount: z.number().nonnegative().default(0),
  currency: currency.default('TJS'),
  paymentMethod: paymentMethod.default('cash'),
  // v0.4.2 Karar 9 — POS indirimi ara-toplamın %10'unu aşarsa süpervizör
  // (yönetici/finans) onayı zorunlu. İstemci e-posta+şifre geçirir; service
  // bcrypt + rol ile doğrular (async kuyruk değil, inline). Yoksa %10 cap.
  supervisorOverride: z
    .object({ email: z.string().email(), password: z.string().min(1) })
    .optional(),
});
export type SaleCreateInput = z.infer<typeof saleCreateSchema>;
export const saleListQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cashClosureId: z.string().uuid().optional(),
});
export type SaleListQuery = z.infer<typeof saleListQuerySchema>;

// --- İade ---
export const returnCreateSchema = z.object({
  saleId: z.string().uuid(),
  reason: z.string().max(500).optional().nullable(),
  items: z
    .array(
      z.object({
        saleItemId: z.string().uuid(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
});
export type ReturnCreateInput = z.infer<typeof returnCreateSchema>;

// --- Kasa (gün sonu) ---
export const cashOpenSchema = z.object({
  openingFloat: z.number().nonnegative().default(0),
  currency: currency.default('TJS'),
});
export type CashOpenInput = z.infer<typeof cashOpenSchema>;
export const cashCloseSchema = z.object({
  id: z.string().uuid(),
  countedAmount: z.number().nonnegative(),
  notes: z.string().max(1000).optional().nullable(),
});
export type CashCloseInput = z.infer<typeof cashCloseSchema>;

// --- Rapor ---
export const reportQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;
