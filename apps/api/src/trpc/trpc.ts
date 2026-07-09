import { HttpException } from '@nestjs/common';
import { TRPCError, initTRPC } from '@trpc/server';
import { ZodError } from 'zod';
import { hasPermission, type Permission } from '@airmed/contracts';
import { COSIGN_DIFF_SOURCES, computeFieldDiff, type FieldChange } from '../audit/cosign-diff';
import { toTrpcError } from './error-mapper';
import type { TrpcContext } from './trpc.context';

// SİS-1 — Klinik hatalar `messageKey` (+ `messageParams`) taşıyabilir; frontend
// `mapTrpcError` bunu aktif dilde t() ile basar. İki kaynak: (1) HttpException
// response objesi (`throw new BadRequestException({ messageKey, messageParams })`),
// (2) doğrudan TRPCError `cause` objesi.
function extractMessageKey(error: { cause?: unknown }): {
  messageKey?: string;
  messageParams?: Record<string, unknown>;
} {
  const cause = error.cause;
  if (cause instanceof HttpException) {
    const resp = cause.getResponse();
    if (resp && typeof resp === 'object' && 'messageKey' in resp) {
      const r = resp as { messageKey?: unknown; messageParams?: unknown };
      if (typeof r.messageKey === 'string') {
        return {
          messageKey: r.messageKey,
          messageParams:
            r.messageParams && typeof r.messageParams === 'object'
              ? (r.messageParams as Record<string, unknown>)
              : undefined,
        };
      }
    }
  }
  if (cause && typeof cause === 'object' && 'messageKey' in cause) {
    const c = cause as { messageKey?: unknown; messageParams?: unknown };
    if (typeof c.messageKey === 'string') {
      return {
        messageKey: c.messageKey,
        messageParams:
          c.messageParams && typeof c.messageParams === 'object'
            ? (c.messageParams as Record<string, unknown>)
            : undefined,
      };
    }
  }
  return {};
}

// #919 — prod'da beklenmeyen (INTERNAL_SERVER_ERROR) hata mesajını sabit
// generic string'e indirir. Ham Error mesajı (Prisma constraint = tablo/kolon
// adları; anonim `login` gibi publicProcedure'lardan dahi tetiklenebilir)
// istemciye sızmasın. Bilinçli 4xx'ler ve messageKey taşıyan i18n hataları
// korunur (kasıtlı; tablo/kolon içermez). Orijinal hata server tarafında kalır:
// trpc.module `onError` zaten error.cause'u Sentry'ye gönderir.
export function maskErrorMessage(code: string, message: string, isProduction: boolean): string {
  return isProduction && code === 'INTERNAL_SERVER_ERROR' ? 'Internal server error' : message;
}

const t = initTRPC.context<TrpcContext>().create({
  errorFormatter({ shape, error }) {
    const isDev = process.env.NODE_ENV !== 'production';
    const { messageKey, messageParams } = extractMessageKey(error);
    return {
      ...shape,
      message: maskErrorMessage(error.code, shape.message, !isDev),
      data: {
        ...shape.data,
        stack: isDev ? shape.data.stack : undefined,
        zodIssues: error.cause instanceof ZodError ? error.cause.issues : null,
        messageKey,
        messageParams,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * F4 — Impersonation token JWT `imp` claim ile işaretli; bu middleware
 * `imp` varsa TRPCError FORBIDDEN atar. `protectedProcedure` extension'ı
 * olarak (chain sonunda) hassas mutation'larda kullanılır: apiKey.create,
 * user.create, role assign, vb. Platform admin impersonation oturumunda
 * yeni uzun-ömürlü token üretemez, role değiştiremez.
 *
 * Denetim P0 2.4 — eskiden yalnız REST tarafında @BlockImpersonation()
 * vardı (tek endpoint); tRPC mutation'ları tamamen açıktı.
 */
const blockImpersonationMiddleware = t.middleware(async ({ ctx, next }) => {
  if (ctx.user?.imp) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Bu işlem impersonation oturumunda yapılamaz. Kendi hesabınızla giriş yapın.',
    });
  }
  return next();
});

export const protectedProcedure = t.procedure.use(
  async ({ ctx, next, type, path, getRawInput }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }
    const user = ctx.user;

    // #969 — cache'li tenant status (REST interceptor ile aynı; per-request
    // findUnique kalkar, suspend/delete gecikmesi ≤ TTL).
    const tenant = await ctx.prisma.getTenantStatusCached(user.tenantId);
    if (!tenant || tenant.deletedAt) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Tenant not available' });
    }
    if (tenant.status !== 'active' || tenant.suspendedAt) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Tenant suspended' });
    }

    return ctx.prisma.runWithTenant(user.tenantId, async (tx) => {
      ctx.tenantContext.setTenantId(user.tenantId);
      ctx.tenantContext.setTransaction(tx);

      // R1 (#723) — Co-sign diff: co-signable update path'lerinde mutasyon ÖNCESİ
      // satırı çek (sonra after ile karşılaştırılıp payload.diff'e yazılır). Doktor
      // co-sign ekranında hemşirenin "ne değiştirdiğini" alan-bazlı görür.
      // Best-effort: diff hatası mutasyonu asla kırmaz.
      const diffModel = type === 'mutation' ? COSIGN_DIFF_SOURCES[path] : undefined;
      let diffId: string | null = null;
      let beforeRow: Record<string, unknown> | null = null;
      if (diffModel) {
        try {
          const raw = (await getRawInput()) as { id?: unknown } | null;
          diffId = typeof raw?.id === 'string' ? raw.id : null;
          if (diffId) {
            const delegate = (
              ctx.prisma.scoped as unknown as Record<
                string,
                { findUnique: (a: unknown) => Promise<unknown> }
              >
            )[diffModel];
            beforeRow = (await delegate.findUnique({ where: { id: diffId } })) as Record<
              string,
              unknown
            > | null;
          }
        } catch {
          beforeRow = null;
        }
      }

      // Service layer throws NestJS HttpExceptions (NotFoundException,
      // ConflictException, BadRequestException, ...). tRPC catches those
      // inside the resolver wrapper and returns a non-ok MiddlewareResult
      // with `error.cause` set to the original — without remapping, every
      // 4xx surfaces as a 500. Only remap when cause is an HttpException;
      // for other failure modes (Zod input validation, custom TRPCError)
      // the original error already has the right code.
      const result = await next({ ctx: { ...ctx, user } });
      if (!result.ok) {
        if (result.error.cause instanceof HttpException) {
          throw toTrpcError(result.error.cause);
        }
        throw result.error;
      }

      // Auto-audit every successful mutation. Queries are skipped (parity with
      // the REST AuditInterceptor that only fires on POST/PATCH/PUT/DELETE).
      if (result.ok && type === 'mutation') {
        // R1 (#723) — Co-sign diff: before/after alan-bazlı değişiklik (varsa).
        let diff: FieldChange[] | undefined;
        if (diffModel && diffId && beforeRow) {
          try {
            const delegate = (
              ctx.prisma.scoped as unknown as Record<
                string,
                { findUnique: (a: unknown) => Promise<unknown> }
              >
            )[diffModel];
            const afterRow = (await delegate.findUnique({ where: { id: diffId } })) as Record<
              string,
              unknown
            > | null;
            const changes = computeFieldDiff(beforeRow, afterRow);
            if (changes.length > 0) diff = changes;
          } catch {
            diff = undefined;
          }
        }
        await ctx.audit.record({
          action: `trpc:${path}`,
          entityType: path.split('.')[0] || null,
          entityId: extractId(result.data),
          userId: user.sub,
          tenantId: user.tenantId,
          ip: ctx.req.ip ?? null,
          userAgent: ctx.req.get('user-agent') ?? null,
          payload: diff ? { path, type, diff } : { path, type },
        });
      }

      return result;
    });
  },
);

/**
 * Impersonation-blocked variant of protectedProcedure. Hassas mutation'lar
 * (apiKey.create, user.*, role.*, kalıcı silme) bunu kullanmalı. Aksi halde
 * platform admin başka kullanıcının kimliğinde yeni API anahtarı üretir veya
 * kullanıcı CRUD yapar — bu impersonation kapsamı dışı eylemler.
 */
export const sensitiveProcedure = protectedProcedure.use(blockImpersonationMiddleware);

/**
 * S3 — Permission-aware procedure factory. `permissions.ts` registry'sinden
 * tek permission key alır; user'ın roles'üyle eşleşme yoksa FORBIDDEN.
 *
 * Impersonation kontrolü dahil — `action:*` permission'ları hassas mutation
 * kategorisinde olduğu için sensitiveProcedure üstüne kurulur. Impersonation
 * altında kullanıcı yetkili rol bile olsa eylem reddedilir (ek savunma katmanı,
 * mevcut sensitiveProcedure davranışı).
 *
 * Kullanım:
 * ```ts
 * softDelete: permissionProcedure('action:patient.softDelete')
 *   .input(idInput)
 *   .mutation(async ({ input }) => { ... });
 * ```
 *
 * Migrasyon planı (S10 cleanup): mevcut `sensitiveProcedure` kullanımları tek
 * tek `permissionProcedure('action:...')`'a çevrilir. Eski API geçici tutulur.
 */
export const permissionProcedure = (perm: Permission) =>
  sensitiveProcedure.use(({ ctx, next }) => {
    // PermissionAssignment runtime: önce JWT'deki `effectivePerms` (bake'li
    // override+registry birleşimi); legacy token için undefined → registry
    // fallback. permission.guard.ts ile aynı semantik.
    const effectivePerms = (ctx.user as { effectivePerms?: string[] })?.effectivePerms;
    if (!hasPermission(ctx.user!.roles, perm, effectivePerms)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `${perm} yetkisi yok`,
      });
    }
    return next();
  });

function extractId(data: unknown): string | null {
  if (data && typeof data === 'object' && 'id' in data) {
    const id = (data as { id?: unknown }).id;
    if (typeof id === 'string') return id;
  }
  return null;
}
