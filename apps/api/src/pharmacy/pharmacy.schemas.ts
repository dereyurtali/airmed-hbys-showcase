import { z } from 'zod';

// E3 Eczane / Optikçi — Zod şemaları.
// Reçete öğeleri (drug vs eyewear) JSON; backend tarafı tip-bağımsız kabul
// eder, frontend doğrulama yapar. v1: gönderim = sentAt timestamp + audit log.

export const SUPPLIER_CATEGORIES = ['pharmacy', 'optic', 'other'] as const;
export const supplierCategorySchema = z.enum(SUPPLIER_CATEGORIES);

export const PRESCRIPTION_TYPES = ['drug', 'eyewear'] as const;
export const prescriptionTypeSchema = z.enum(PRESCRIPTION_TYPES);

const phone = z
  .string()
  .max(20)
  .regex(/^(?=[^0-9]*\d)?[+0-9 ()-]*$/, 'invalid phone')
  .optional()
  .nullable();

// --- Supplier ---

export const supplierCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: supplierCategorySchema,
  contactPhone: phone,
  contactEmail: z.string().email().max(255).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export const supplierUpdateSchema = supplierCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const supplierListQuerySchema = z.object({
  category: supplierCategorySchema.optional(),
  includeInactive: z.boolean().default(false),
  search: z.string().trim().min(1).max(100).optional(),
});

// --- Prescription ---

export const prescriptionItemSchema = z.record(z.unknown());

export const prescriptionCreateSchema = z.object({
  patientId: z.string().uuid(),
  type: prescriptionTypeSchema,
  supplierId: z.string().uuid().optional().nullable(),
  items: z.array(prescriptionItemSchema).min(1).max(50),
  notes: z.string().max(2000).optional().nullable(),
});

export const prescriptionUpdateSchema = z.object({
  type: prescriptionTypeSchema.optional(),
  supplierId: z.string().uuid().optional().nullable(),
  items: z.array(prescriptionItemSchema).min(1).max(50).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

export const prescriptionListQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  type: prescriptionTypeSchema.optional(),
  sentOnly: z.boolean().optional(),
});

export const prescriptionIdSchema = z.object({ id: z.string().uuid() });

export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>;
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>;
export type SupplierListQuery = z.infer<typeof supplierListQuerySchema>;
export type PrescriptionCreateInput = z.infer<typeof prescriptionCreateSchema>;
export type PrescriptionUpdateInput = z.infer<typeof prescriptionUpdateSchema>;
export type PrescriptionListQuery = z.infer<typeof prescriptionListQuerySchema>;
