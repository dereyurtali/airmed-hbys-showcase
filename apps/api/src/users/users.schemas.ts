import { z } from 'zod';

// 7 klinik rol — schema.prisma RoleKey enum ile birebir, packages/db/src/seed-helpers.ts'deki
// DEFAULT_CLINIC_ROLES ile aynı set. Yönetici buradan rol seçimi yapar; v0.3'te yeni rol
// ekleme/silme UI'sı yok (seed/migrasyon işi).
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

export const USER_STATUSES = ['active', 'inactive', 'locked', 'suspended'] as const;
export const userStatusSchema = z.enum(USER_STATUSES);

export const userListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  roleKey: roleKeySchema.optional(),
  status: userStatusSchema.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

const doctorSubSchema = z.object({
  specialty: z.string().trim().min(2, 'Uzmanlık en az 2 karakter').max(100),
  type: z.enum(['local', 'visiting']).default('local'),
});

export const userCreateSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email('Geçerli bir e-posta girin')
      .max(255)
      .transform((v) => v.toLowerCase()),
    name: z.string().trim().min(2, 'Ad en az 2 karakter').max(100),
    roleKey: roleKeySchema,
    locale: z.enum(['tr', 'ru', 'tg']).default('tr'),
    // Yalnız `doktor` rolünde zorunlu; diğer rollerde reddedilir (superRefine).
    doctor: doctorSubSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.roleKey === 'doktor' && !v.doctor) {
      ctx.addIssue({
        code: 'custom',
        path: ['doctor'],
        message: 'Doktor rolünde uzmanlık ve tip zorunlu',
      });
    }
    if (v.roleKey !== 'doktor' && v.doctor) {
      ctx.addIssue({
        code: 'custom',
        path: ['doctor'],
        message: 'Sadece doktor rolünde uzmanlık girilebilir',
      });
    }
  });
export type UserCreateInput = z.infer<typeof userCreateSchema>;

// Edit modu — sadece display alanları. Rol değişimi v0.3'te yok (Doctor binding
// karmaşası); e-posta da değiştirilemez (uniqueness + login).
export const userUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2, 'Ad en az 2 karakter').max(100).optional(),
  locale: z.enum(['tr', 'ru', 'tg']).optional(),
  // #1049 — personel profil telefonu. null = temizle; gönderilmezse dokunma.
  phone: z
    .string()
    .trim()
    .min(4)
    .max(30)
    .regex(/^(?=[^0-9]*\d)[+0-9 ()-]+$/, 'Telefon rakam ve +, boşluk, parantez içermeli')
    .optional()
    .nullable(),
});
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const userIdSchema = z.object({ id: z.string().uuid() });
export type UserIdInput = z.infer<typeof userIdSchema>;

// #1050 — Hemşire oturum modu adayları (v0.4 kanonik: Rol ≠ Nitelik ≠ Mod).
// flags.modes login mod seçicisini besler; en az 1 aday şart, yoksa hemşire
// mod'suz kalır → login seçici hiç çıkmaz (staging bug'ının tekrarı).
export const USER_MODES = ['genel', 'asistan', 'olcum'] as const;
export const userUpdateModesSchema = z.object({
  id: z.string().uuid(),
  modes: z.array(z.enum(USER_MODES)).min(1, 'En az bir mod adayı seçilmeli').max(3),
});
export type UserUpdateModesInput = z.infer<typeof userUpdateModesSchema>;
