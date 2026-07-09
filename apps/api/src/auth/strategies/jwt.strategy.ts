import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload } from '../auth.types';
import { AdminPrismaService } from '../../prisma/admin-prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  // F4 — admin client (RLS bypass). Token doğrularken impersonation kaydı
  // başka bir tenant scope'unda olabilir; tenant filtresi siz olmadan
  // doğrudan id ile çekiyoruz. #1065 — paylaşımlı AdminPrismaService (tek havuz).
  constructor(
    config: ConfigService,
    private readonly admin: AdminPrismaService,
  ) {
    const accessSecret = config.get<string>('JWT_ACCESS_SECRET');
    if (!accessSecret) throw new Error('JWT_ACCESS_SECRET is not set');
    const impersonationSecret = config.get<string>('PLATFORM_IMPERSONATION_JWT_SECRET');
    if (!impersonationSecret) throw new Error('PLATFORM_IMPERSONATION_JWT_SECRET is not set');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // P0 2.3 — Dinamik secret: token'ın payload'una bakıp doğru secret'i
      // döner. `imp` claim varsa impersonation secret, yoksa normal access
      // secret. Manuel base64 decode passport-jwt sync callback şartından
      // (jwt.decode kütüphane bağımlılığı eklemek yerine kısa inline).
      secretOrKeyProvider: (_req, rawJwtToken, done) => {
        try {
          const parts = (rawJwtToken as string).split('.');
          if (parts.length !== 3) return done(null, accessSecret);
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
            imp?: unknown;
          };
          done(null, payload.imp ? impersonationSecret : accessSecret);
        } catch {
          // Decode hatası → access secret'a düş; verify zaten fail eder.
          done(null, accessSecret);
        }
      },
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (!payload.sub || !payload.tenantId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    if (payload.imp) {
      const row = await this.admin.tenantImpersonation.findUnique({
        where: { id: payload.imp.id },
        select: {
          endedAt: true,
          expiresAt: true,
          targetUserId: true,
          targetTenantId: true,
        },
      });
      if (!row) throw new UnauthorizedException('Impersonation not found');
      if (row.endedAt !== null) throw new UnauthorizedException('Impersonation revoked');
      if (row.expiresAt.getTime() <= Date.now()) {
        throw new UnauthorizedException('Impersonation expired');
      }
      // Token replay defense — JWT içinde claim edilen sub/tenantId, DB
      // satırının target ile birebir aynı olmalı; başka bir admin'in token'ını
      // tekrar üretip user-id'sini değiştirmiş bir saldırgan engellenir.
      if (row.targetUserId !== payload.sub || row.targetTenantId !== payload.tenantId) {
        throw new UnauthorizedException('Impersonation claim mismatch');
      }
    }

    return payload;
  }
}
