import { z } from 'zod';

// S17 — Klinik bilgi yönetimi Zod şemaları.
// `name` zorunlu (Tenant.name NOT NULL); diğerleri opsiyonel.
// `slug` ve `mrnPrefix` immutable — bu endpoint üzerinden değiştirilmez.

const optionalString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

// #1048 — Klinik mesai saatleri. Gün null = klinik o gün kapalı. Ayar hiç
// yoksa availability.service'teki hardcoded fallback (Pzt-Cum 09-18, Cmt
// 09-14, Paz kapalı) geçerli kalır — bu yüzden alan bütünüyle opsiyonel.
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const workingDaySchema = z
  .object({
    start: z.string().regex(HHMM, 'start must be HH:MM'),
    end: z.string().regex(HHMM, 'end must be HH:MM'),
  })
  .refine((v) => v.start < v.end, { message: 'start must be before end', path: ['end'] })
  .nullable();

export const workingHoursSchema = z.object({
  mon: workingDaySchema,
  tue: workingDaySchema,
  wed: workingDaySchema,
  thu: workingDaySchema,
  fri: workingDaySchema,
  sat: workingDaySchema,
  sun: workingDaySchema,
});

export type WorkingHours = z.infer<typeof workingHoursSchema>;

// Settings JSON'undan workingHours okuma — clinic-settings.service (get) ve
// availability.service (freeSlots) paylaşır. Bozuk/eksik veri = undefined
// (fallback'e düş); asla throw etmez, DB'deki eski JSON'u kırmaz.
export function extractWorkingHours(settings: unknown): WorkingHours | undefined {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return undefined;
  const scheduling = (settings as { scheduling?: unknown }).scheduling;
  if (!scheduling || typeof scheduling !== 'object' || Array.isArray(scheduling)) return undefined;
  const raw = (scheduling as { workingHours?: unknown }).workingHours;
  const parsed = workingHoursSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

// Madde 1 + 4 — randevu planlama ayarları. Tenant.settings JSON kolonunda
// 'scheduling' anahtarı altında saklanır.
//  - defaultAppointmentMinutes: yeni randevu form'unda bitiş saati varsayılan
//    hesabı (5-240 dk).
//  - postOpFreeMonths: ameliyat sonrası X ay içindeki kontrol randevuları
//    ücretsiz (0-12 ay; 0 = devre dışı). Tahsilat akışında kullanılır
//    (uygulama ayrı PR).
//  - workingHours (#1048): klinik mesai penceresi — availability.freeSlots
//    varsayılan pencere hesabı + takvim grid saat aralığı. null = ayarı sil
//    (hardcoded fallback'e dön).
export const schedulingSettingsSchema = z
  .object({
    workingHours: workingHoursSchema.nullable().optional(),
    defaultAppointmentMinutes: z
      .number()
      .int('Tam sayı olmalı')
      .min(5, 'En az 5 dakika')
      .max(240, 'En fazla 240 dakika')
      .nullable()
      .optional(),
    postOpFreeMonths: z
      .number()
      .int('Tam sayı olmalı')
      .min(0, 'En az 0 ay')
      .max(12, 'En fazla 12 ay')
      .nullable()
      .optional(),
  })
  .optional();
export type SchedulingSettings = z.infer<typeof schedulingSettingsSchema>;

export const clinicSettingsUpdateSchema = z.object({
  name: z.string().trim().min(2, 'Klinik adı en az 2 karakter').max(255),
  legalName: optionalString(255),
  address: optionalString(500),
  phone: optionalString(50),
  email: z
    .string()
    .trim()
    .email('Geçersiz e-posta')
    .max(255)
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  taxId: optionalString(50),
  scheduling: schedulingSettingsSchema,
  // #361 — Mutlak indirim tavanı (%). Tenant.settings.maxApprovableDiscountPercent.
  // null = default'a (%30) dön. 0..100; onayla bile aşılamaz.
  maxApprovableDiscountPercent: z
    .number()
    .min(0, 'En az %0')
    .max(100, 'En fazla %100')
    .nullable()
    .optional(),
});

export type ClinicSettingsUpdateInput = z.infer<typeof clinicSettingsUpdateSchema>;
