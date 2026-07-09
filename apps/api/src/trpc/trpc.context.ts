import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import type { AuditService } from '../audit/audit.service';
import type { JwtPayload } from '../auth/auth.types';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantContextService } from '../tenant/tenant-context.service';

export interface TrpcContext {
  req: CreateExpressContextOptions['req'];
  res: CreateExpressContextOptions['res'];
  user: JwtPayload | null;
  prisma: PrismaService;
  tenantContext: TenantContextService;
  audit: AuditService;
}

export function createTrpcContextFactory(
  jwt: JwtService,
  config: ConfigService,
  prisma: PrismaService,
  tenantContext: TenantContextService,
  audit: AuditService,
) {
  const accessSecret = config.get<string>('JWT_ACCESS_SECRET');
  if (!accessSecret) throw new Error('JWT_ACCESS_SECRET is not set');
  // P0 2.3 — Impersonation token'ları ayrı secret ile imzalanıyor. tRPC context
  // factory hem klinik hem impersonation token'larını doğrulayabilmeli (JwtStrategy
  // ile sync); aksi halde impersonation altında tRPC endpoint'leri 401 döner.
  const impersonationSecret = config.get<string>('PLATFORM_IMPERSONATION_JWT_SECRET');
  if (!impersonationSecret) throw new Error('PLATFORM_IMPERSONATION_JWT_SECRET is not set');

  return ({ req, res }: CreateExpressContextOptions): TrpcContext => {
    const auth = req.headers.authorization;
    let user: JwtPayload | null = null;
    if (auth?.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length);
      // Token payload'una bakıp doğru secret seç (verify edilmemiş decode;
      // imza kontrolü hemen ardından yapılıyor).
      let useImpersonationSecret = false;
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
            imp?: unknown;
          };
          useImpersonationSecret = Boolean(payload.imp);
        }
      } catch {
        // Decode hatası → access secret'a düş, verify zaten fail edecek.
      }
      try {
        user = jwt.verify<JwtPayload>(token, {
          secret: useImpersonationSecret ? impersonationSecret : accessSecret,
        });
      } catch {
        user = null;
      }
    }
    return { req, res, user, prisma, tenantContext, audit: audit };
  };
}
