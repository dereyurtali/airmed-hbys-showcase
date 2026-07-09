import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { AuthService } from '../../auth/auth.service';
import { buildSetCookieHeader } from '../../auth/cookie.util';
import { protectedProcedure, publicProcedure, router } from '../trpc';

const loginInput = z.object({
  tenantSlug: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9-]+$/),
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
  // v0.4 (#539) — Girişte seçilen çalışma modu (hemşire: genel/asistan/olcum vb.).
  // Atlanırsa: tek/sıfır modlu kullanıcı klasik girer; >1 modlu kullanıcı için
  // yanıt `needsModeSelection` döner (istemci modu seçip tekrar gönderir, #540).
  mode: z.string().min(1).max(32).optional(),
});

export const authRouterFactory = (auth: AuthService) =>
  router({
    login: publicProcedure.input(loginInput).mutation(async ({ input, ctx }) => {
      try {
        const result = await auth.login(
          input.tenantSlug,
          input.email,
          input.password,
          ctx.req.ip,
          ctx.req.get('user-agent') ?? undefined,
          input.mode,
        );
        // İki fazlı giriş: mod seçimi gerekiyorsa token verilmez, uygun modlar
        // döner; istemci modu seçip tekrar login eder (cookie set edilmez).
        if ('needsModeSelection' in result) {
          return { needsModeSelection: true as const, availableModes: result.availableModes };
        }
        ctx.res.appendHeader('Set-Cookie', buildSetCookieHeader(result.refreshToken));
        return {
          accessToken: result.accessToken,
          mustChangePassword: result.mustChangePassword,
        };
      } catch (err) {
        throw toTrpcError(err);
      }
    }),

    me: protectedProcedure.query(async ({ ctx }) => {
      const profile = await ctx.prisma.scoped.user.findUnique({
        where: { id: ctx.user.sub },
        select: { locale: true, name: true },
      });
      return {
        sub: ctx.user.sub,
        tenantId: ctx.user.tenantId,
        email: ctx.user.email,
        roles: ctx.user.roles,
        locale: profile?.locale ?? 'tr',
        name: profile?.name ?? null,
      };
    }),
  });

function toTrpcError(err: unknown): TRPCError {
  const message = err instanceof Error ? err.message : 'Authentication failed';
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: number }).status;
    if (status === 401) return new TRPCError({ code: 'UNAUTHORIZED', message });
    if (status === 403) return new TRPCError({ code: 'FORBIDDEN', message });
    if (status === 404) return new TRPCError({ code: 'NOT_FOUND', message });
  }
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
}
