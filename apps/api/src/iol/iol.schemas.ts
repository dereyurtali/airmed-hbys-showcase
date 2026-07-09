import { z } from 'zod';

// C1 IOL Inventory — Zod şemaları.
//
// 3 entity: IolModel (marka + model), IolLot (lot + diyopter + stok), Movement.
// Lot oluştururken eldeki başlangıç qty 0; receive movement ile artırılır.

export const IOL_MOVEMENT_TYPES = ['receive', 'consume', 'adjust', 'return', 'expire'] as const;
export const iolMovementTypeSchema = z.enum(IOL_MOVEMENT_TYPES);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expiresAt must be YYYY-MM-DD');

// --- Model ---

// #382 — lensType + minQty API/UI'dan set edilebilir (eskiden UI'dan eklenen her
// model 'monofocal' kalıyordu → tip-bazlı raporlar yalnız seed için doğruydu).
export const IOL_LENS_TYPES = ['monofocal', 'trifocal', 'edof', 'toric'] as const;
export const iolLensTypeSchema = z.enum(IOL_LENS_TYPES);

export const iolModelCreateSchema = z.object({
  brand: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  lensType: iolLensTypeSchema.default('monofocal'),
  minQty: z.coerce.number().int().min(0).default(0),
});

export const iolModelUpdateSchema = z.object({
  brand: z.string().trim().min(1).max(100).optional(),
  model: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
  lensType: iolLensTypeSchema.optional(),
  minQty: z.coerce.number().int().min(0).optional(),
});

export const iolModelListQuerySchema = z.object({
  includeInactive: z.boolean().default(false),
  search: z.string().trim().min(1).max(100).optional(),
});

// --- Lot ---

export const iolLotCreateSchema = z.object({
  modelId: z.string().uuid(),
  lotNumber: z.string().trim().min(1).max(100),
  power: z.coerce.number().min(-30).max(50), // diyopter aralığı
  expiresAt: isoDate,
  initialQuantity: z.coerce.number().int().min(0).default(0),
  supplier: z.string().max(150).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const iolLotUpdateSchema = z.object({
  lotNumber: z.string().trim().min(1).max(100).optional(),
  power: z.coerce.number().min(-30).max(50).optional(),
  expiresAt: isoDate.optional(),
  supplier: z.string().max(150).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const iolLotListQuerySchema = z.object({
  modelId: z.string().uuid().optional(),
  expiringWithinDays: z.coerce.number().int().min(1).max(365).optional(),
  lowStockThreshold: z.coerce.number().int().min(0).optional(),
  includeEmpty: z.boolean().default(true),
});

// --- Movement (manuel stok hareketi: receive / adjust / return / expire) ---
// `consume` movement'ı sadece B1 entegrasyonu üzerinden oluşur (sonraki PR).

export const iolMovementCreateSchema = z.object({
  lotId: z.string().uuid(),
  type: z.enum(['receive', 'adjust', 'return', 'expire']),
  quantity: z.coerce
    .number()
    .int()
    .refine((n) => n !== 0, 'quantity must not be zero'),
  notes: z.string().max(500).optional().nullable(),
});

export const iolIdSchema = z.object({ id: z.string().uuid() });

export type IolModelCreateInput = z.infer<typeof iolModelCreateSchema>;
export type IolModelUpdateInput = z.infer<typeof iolModelUpdateSchema>;
export type IolModelListQuery = z.infer<typeof iolModelListQuerySchema>;
export type IolLotCreateInput = z.infer<typeof iolLotCreateSchema>;
export type IolLotUpdateInput = z.infer<typeof iolLotUpdateSchema>;
export type IolLotListQuery = z.infer<typeof iolLotListQuerySchema>;
export type IolMovementCreateInput = z.infer<typeof iolMovementCreateSchema>;
