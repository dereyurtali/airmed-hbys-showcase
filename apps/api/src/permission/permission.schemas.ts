import { z } from 'zod';

// S14 — v0.1 permission matrix port. PermissionAssignment override CRUD için.
// PERMISSIONS registry (apps/api/src/auth/permissions.ts) varsayılan davranışı
// belirler; PermissionAssignment tablosu opsiyonel override sağlar.
//
// İlk port: page:* override. action:* override ileri faz.

export const ROLE_KEYS = [
  'yonetici',
  'yonetici_asistani',
  'doktor',
  'resepsiyon',
  'hemsire',
  'ameliyat_satis',
  'olcum_hemsiresi',
  // v0.4 #565 — 3 yeni rol (kanonik: DEFAULT_CLINIC_ROLES). Yeni rol eklenince
  // bu liste de güncellenmeli; drift = rol UI'dan atanamaz / matriste çıkmaz.
  'finans',
  'stok_satinalma',
  'eczane',
] as const;
export const roleKeySchema = z.enum(ROLE_KEYS);

export const matrixReadInputSchema = z.object({
  resourcePrefix: z.enum(['page:', 'action:', 'view:', 'all']).default('all'),
});

export const matrixToggleInputSchema = z.object({
  roleKey: roleKeySchema,
  resource: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^(page|action|view):[a-zA-Z0-9._-]+$/,
      'resource format: page:x | action:x.y | view:x.y',
    ),
  allowed: z.boolean(),
});

export type MatrixToggleInput = z.infer<typeof matrixToggleInputSchema>;
export type MatrixReadInput = z.infer<typeof matrixReadInputSchema>;
