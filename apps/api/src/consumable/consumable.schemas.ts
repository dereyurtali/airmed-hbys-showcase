import { z } from 'zod';

// #372 — Consumable (genel sarf/ilaç stok) CRUD + stok düzeltme + tüketim.
// IolLot 3-state'ten farklı: tek availableQty/reservedQty alanı, lot/parti yok
// (C-serisi çekirdek). category: 'supply' (sarf) | 'drug' (ilaç).

export const consumableCategorySchema = z.enum(['supply', 'drug']);

export const consumableCreateSchema = z.object({
  name: z.string().trim().min(1).max(150),
  code: z.string().trim().max(40).optional().nullable(),
  category: consumableCategorySchema.default('supply'),
  unit: z.string().trim().max(30).optional().nullable(),
  availableQty: z.coerce.number().int().min(0).default(0),
  minQty: z.coerce.number().int().min(0).default(0),
});

export const consumableUpdateSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  code: z.string().trim().max(40).optional().nullable(),
  category: consumableCategorySchema.optional(),
  unit: z.string().trim().max(30).optional().nullable(),
  minQty: z.coerce.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

// Stok düzeltme: delta (+/-). receive=+, consume/expire=-, adjust=±.
export const consumableAdjustSchema = z.object({
  id: z.string().uuid(),
  delta: z.coerce
    .number()
    .int()
    .refine((v) => v !== 0, 'delta 0 olamaz'),
  reason: z.string().trim().max(200).optional().nullable(),
});

export const consumableListQuerySchema = z.object({
  includeInactive: z.boolean().default(false),
  category: consumableCategorySchema.optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

// Prosedür/ameliyat sonrası sarf düşümü için kullanılan satır.
export const consumableUsageSchema = z.object({
  consumableId: z.string().uuid(),
  qty: z.coerce.number().int().min(1),
});

export type ConsumableCreateInput = z.infer<typeof consumableCreateSchema>;
export type ConsumableUpdateInput = z.infer<typeof consumableUpdateSchema>;
export type ConsumableAdjustInput = z.infer<typeof consumableAdjustSchema>;
export type ConsumableListQuery = z.infer<typeof consumableListQuerySchema>;
export type ConsumableUsage = z.infer<typeof consumableUsageSchema>;
