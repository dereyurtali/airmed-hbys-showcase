import { z } from 'zod';
import { protectedProcedure, router } from '../trpc';

const SUPPORTED_LOCALES = ['tr', 'ru', 'tg'] as const;

// #1051 — bio Prisma JsonValue; tRPC inference'ında recursive tip (TS2589)
// yaratıyor → açık wire tipi (DoctorRow deseni, doctor.service).
type DoctorBioDto = { tr?: string; ru?: string; tg?: string } | null;

// #1051 — self-service profil. Yönetici kullanıcı yönetiminden (userAdmin)
// ayrıdır: kullanıcı YALNIZ kendini görür/düzenler ve yalnız telefon + dil
// değiştirebilir (ad/rol/mod yönetici-kontrollü kalır).
const updateMeSchema = z.object({
  // Personel telefonu — boş string = temizle (null'a çevrilir).
  phone: z
    .string()
    .trim()
    .max(30)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional(),
});

export const userRouterFactory = () =>
  router({
    setLocale: protectedProcedure
      .input(z.object({ locale: z.enum(SUPPORTED_LOCALES) }))
      .mutation(async ({ ctx, input }) => {
        await ctx.prisma.user.update({
          where: { id: ctx.user.sub },
          data: { locale: input.locale },
        });
        return { locale: input.locale };
      }),

    // #1051 — kendi profili: kimlik + roller (etiketli) + aktif mod (JWT'den) +
    // doktorsa hasta-facing profil özeti. Salt-okuma; RLS-scoped.
    me: protectedProcedure.query(async ({ ctx }) => {
      const user = await ctx.prisma.scoped.user.findUniqueOrThrow({
        where: { id: ctx.user.sub },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          locale: true,
          status: true,
          userRoles: { select: { role: { select: { key: true, label: true } } } },
          doctorProfile: {
            select: {
              id: true,
              specialty: true,
              type: true,
              title: true,
              bio: true,
              languages: true,
              publicProfile: true,
              photoKey: true,
            },
          },
        },
      });
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        locale: user.locale,
        status: user.status,
        roles: user.userRoles.map((ur) => ur.role),
        mode: ctx.user.mode ?? null,
        doctor: user.doctorProfile
          ? { ...user.doctorProfile, bio: user.doctorProfile.bio as DoctorBioDto }
          : null,
      };
    }),

    // #1051 — yalnız telefon güncellenir (ad yönetici-kontrollü). Audit'li.
    updateMe: protectedProcedure.input(updateMeSchema).mutation(async ({ ctx, input }) => {
      if (input.phone !== undefined) {
        await ctx.prisma.scoped.user.update({
          where: { id: ctx.user.sub },
          data: { phone: input.phone },
        });
        await ctx.audit.record({
          action: 'user.self_updated',
          entityType: 'user',
          entityId: ctx.user.sub,
          userId: ctx.user.sub,
          tenantId: ctx.user.tenantId,
        });
      }
      return { ok: true as const };
    }),
  });
