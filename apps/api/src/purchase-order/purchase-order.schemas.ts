import { z } from 'zod';

// v0.4 #549 — Satın Alma Siparişi (PO) giriş şemaları. Model #548'de.
export const PO_DOMAINS = ['clinic', 'pharmacy'] as const;
export const PO_STATUSES = [
  'draft',
  'submitted',
  'pending_approval',
  'approved',
  'received',
  'cancelled',
] as const;
// #713 — PO mal kabul → stok köprüsü. Yalnız PO satırından FAITHFUL stok girişi
// yapılabilen tipler: `consumable` (düz availableQty artışı) + `pharmacy_product`
// (PharmacyBatch oluşturulur; lot/SKT nullable, salePrice=cost default). `iol_model`
// KASTEN YOK: IolLot `power`+`expiresAt`+`lotNumber` fiziksel kutudan gelir, PO
// satırından üretilemez → IOL tedariki kendi lot mal-kabul ekranından yapılır.
export const PO_REFERENCE_TYPES = ['consumable', 'pharmacy_product'] as const;

export const poItemInputSchema = z.object({
  itemName: z.string().min(1).max(200),
  referenceType: z.enum(PO_REFERENCE_TYPES).nullish(),
  referenceId: z.string().uuid().nullish(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
});
export type PoItemInput = z.infer<typeof poItemInputSchema>;

export const poCreateSchema = z.object({
  supplierId: z.string().uuid(),
  domain: z.enum(PO_DOMAINS).default('clinic'),
  currency: z.enum(['TJS', 'USD']).default('TJS'),
  notes: z.string().max(2000).nullish(),
  items: z.array(poItemInputSchema).min(1),
});
export type PoCreateInput = z.infer<typeof poCreateSchema>;

export const poListQuerySchema = z.object({
  domain: z.enum(PO_DOMAINS).optional(),
  status: z.enum(PO_STATUSES).optional(),
  supplierId: z.string().uuid().optional(),
  // Finans "Onay Bekleyen PO'lar" kuyruğu için kısayol.
  pendingApprovalOnly: z.boolean().optional(),
});
export type PoListQuery = z.infer<typeof poListQuerySchema>;

export const poReceiveSchema = z.object({
  id: z.string().uuid(),
  // Kalem bazlı kısmi mal kabul; verilmezse her kalem tam (quantity) alınır.
  items: z
    .array(z.object({ itemId: z.string().uuid(), receivedQty: z.number().int().nonnegative() }))
    .optional(),
});
export type PoReceiveInput = z.infer<typeof poReceiveSchema>;

export const poRejectSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().max(500).nullish(),
});
export type PoRejectInput = z.infer<typeof poRejectSchema>;
