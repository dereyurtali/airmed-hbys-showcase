import { createHash } from 'crypto';
import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AdminPrismaService } from '../prisma/admin-prisma.service';
import { PrismaService } from '../prisma/prisma.service';

// A10 dış API auth servisi.
//
// Akış:
//   1. Authorization header "ApiKey <plaintext>" formatında olmalı.
//   2. plaintext = "ak_{tenantSlug}_{64-hex}" regex'ine uymalı.
//   3. SHA-256 hex → DB lookup (api_keys.key_hash @unique) airmed_bg (BYPASSRLS)
//      admin client ile — tenant belirlenmeden. api_keys RLS policy'si #958'de
//      strict tenant isolation'a (fail-closed) daraltıldı; BYPASSRLS lookup'ı
//      etkilemez. WITH CHECK admin CRUD'da tenant context ister.
//   4. Validate: isActive + revokedAt + expiresAt.
//   5. Tenant aktiflik (status='active', deletedAt=null, suspendedAt=null).
//   6. lastUsedAt best-effort update (fire-and-forget, hata yutulur).
//
// #958 kararı: eski fail-open (GUC NULL → tüm satırlar) 72 RLS tablosunun tekil
// istisnasıydı. airmed_bg (BYPASSRLS, #916) auth lookup'ı üstlenince fail-open'a
// gerek kalmadı → policy strict tenant isolation'a daraltıldı (fail-closed;
// WITH CHECK admin CRUD'da cross-tenant insert'i hala engeller — defense in depth).

const KEY_FORMAT_REGEX = /^ak_[a-z0-9-]+_[0-9a-f]{64}$/;
const AUTH_PREFIX = 'ApiKey ';

export interface AuthenticatedApiKey {
  id: string;
  tenantId: string;
  scopes: string[];
  prefix: string;
}

@Injectable()
export class ApiKeyAuthService {
  private readonly logger = new Logger(ApiKeyAuthService.name);

  // #958 — auth lookup (key_hash → tenant) tenant belirlenmeden çalışır; doğası
  // gereği cross-tenant/privileged. airmed_bg (BYPASSRLS) admin client ile
  // yapılır → api_keys RLS'i fail-open olmak zorunda değil. Fallback (airmed_bg
  // aktif değilse) DATABASE_URL superuser, o da BYPASSRLS → her hâlde çalışır.
  // #1065 — paylaşımlı AdminPrismaService (tek havuz).
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminPrismaService,
  ) {}

  async authenticate(authorizationHeader: string | undefined): Promise<AuthenticatedApiKey> {
    if (!authorizationHeader || !authorizationHeader.startsWith(AUTH_PREFIX)) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }
    const plaintext = authorizationHeader.slice(AUTH_PREFIX.length).trim();
    if (!KEY_FORMAT_REGEX.test(plaintext)) {
      throw new UnauthorizedException('Malformed API key');
    }

    const keyHash = createHash('sha256').update(plaintext).digest('hex');

    // #958 — privileged cross-tenant lookup: airmed_bg (BYPASSRLS) admin client
    // ile key_hash (@unique) tek satır çeker. Strict RLS policy (fail-closed)
    // bunu engellemez (BYPASSRLS). Transaction yok.
    const row = await this.admin.apiKey.findUnique({
      where: { keyHash },
      select: {
        id: true,
        tenantId: true,
        scopes: true,
        prefix: true,
        isActive: true,
        revokedAt: true,
        expiresAt: true,
      },
    });
    if (!row) {
      throw new UnauthorizedException('Invalid API key');
    }
    if (!row.isActive || row.revokedAt) {
      throw new UnauthorizedException('Key revoked');
    }
    if (row.expiresAt && row.expiresAt < new Date()) {
      throw new UnauthorizedException('Key expired');
    }

    const tenant = await this.admin.tenant.findUnique({
      where: { id: row.tenantId },
      select: { status: true, suspendedAt: true, deletedAt: true },
    });
    if (!tenant || tenant.deletedAt) {
      throw new ForbiddenException('Tenant unavailable');
    }
    if (tenant.status !== 'active' || tenant.suspendedAt) {
      throw new ForbiddenException('Tenant unavailable');
    }

    // best-effort lastUsedAt update. Aynı RLS gevşekliği SELECT için var;
    // UPDATE için WITH CHECK tenant context ister → tenant scoped olarak
    // ayrı transaction'da yapıyoruz, başarısız olursa yutuyoruz.
    this.touchLastUsedAt(row.id, row.tenantId).catch((err) => {
      this.logger.warn(`lastUsedAt touch failed for ${row.id}: ${(err as Error).message}`);
    });

    return {
      id: row.id,
      tenantId: row.tenantId,
      scopes: row.scopes,
      prefix: row.prefix,
    };
  }

  private async touchLastUsedAt(keyId: string, tenantId: string): Promise<void> {
    await this.prisma.runWithTenant(tenantId, async (tx) => {
      await tx.apiKey.update({
        where: { id: keyId },
        data: { lastUsedAt: new Date() },
      });
    });
  }
}
