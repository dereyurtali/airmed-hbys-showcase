import { z } from 'zod';

// S14 — v0.1 dashboard widget framework port. Zod şemaları.
// widgets JSON: [{ key, x, y, w, h, config? }]
// key = registry'deki widget tanımına atıf (apps/web/src/components/dashboard/registry.ts)

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

export const widgetCellSchema = z.object({
  key: z.string().min(1).max(100), // registry key, örn 'dashboard.todayAppointments'
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(99),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(12),
  config: z.record(z.unknown()).optional(),
});

export const widgetsSchema = z.array(widgetCellSchema).max(50);

export const getLayoutInputSchema = z.object({
  roleKey: roleKeySchema,
});

export const saveLayoutInputSchema = z.object({
  roleKey: roleKeySchema,
  widgets: widgetsSchema,
});

export type WidgetCell = z.infer<typeof widgetCellSchema>;
export type GetLayoutInput = z.infer<typeof getLayoutInputSchema>;
export type SaveLayoutInput = z.infer<typeof saveLayoutInputSchema>;
