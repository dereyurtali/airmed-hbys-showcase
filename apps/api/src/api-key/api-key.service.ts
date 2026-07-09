import { createHash, randomBytes } from 'crypto';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { ApiKeyCreateInput, ApiKeyUpdateInput } from './api-key.schemas';

// A10 ApiKey servisi — yonetici-only CRUD.
//
// Yetki: tüm metodlar yalnızca "yonetici" rolüne açık. RFP'de "API key yönetimi
// yönetici yetkisi" yazılı; yonetici_asistani bu kapsamda DEĞİL (anahtar
// üretmek = tenant verisine dış erişim açmak, sahip kararı).
//
// Anahtar üretim:
//   plaintext = "ak_{tenantSlug}_{randomHex(64)}"
//   keyHash   = SHA-256(plaintext) (hex)
//   prefix    = plaintext.substring(0, 20)  // tenant slug görünür kalır
// Plaintext sadece create response'unda döner; bir daha asla okunamaz.
//
// Rotate: aynı kaydı update etmez — yeni key plaintext üretir, eski kaydın
// revokedAt ve isActive set edilir; yeni kayıt aynı name/scopes/rateLimit ile.
// Bu sayede audit log'da "anahtar değişti" izlenebilir.

interface Actor {
  id: string;
  roles: readonly string[];
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

@Injectable()
export class ApiKeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async create(input: ApiKeyCreateInput, actor: Actor) {
    this.assertAdmin(actor);
    const tenantId = this.tenantContext.requireTenantId();
    const tenant = await this.prisma.scoped.tenant.findUnique({
      where: { id: tenantId },
      select: { slug: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const { plaintext, keyHash, prefix } = generateKey(tenant.slug);

    const record = await this.prisma.scoped.apiKey.create({
      data: {
        tenantId,
        name: input.name,
        keyHash,
        prefix,
        scopes: input.scopes,
        rateLimit: input.rateLimit,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        createdById: actor.id,
      },
    });

    return { record, plaintext };
  }

  async list(actor: Actor) {
    this.assertAdmin(actor);
    return this.prisma.scoped.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async findById(id: string, actor: Actor) {
    this.assertAdmin(actor);
    const key = await this.prisma.scoped.apiKey.findFirst({
      where: { id },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!key) throw new NotFoundException('API key not found');
    return key;
  }

  async update(id: string, input: ApiKeyUpdateInput, actor: Actor) {
    this.assertAdmin(actor);
    await this.findById(id, actor); // exists?

    return this.prisma.scoped.apiKey.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.scopes !== undefined ? { scopes: input.scopes } : {}),
        ...(input.rateLimit !== undefined ? { rateLimit: input.rateLimit } : {}),
        ...(input.expiresAt !== undefined
          ? { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
  }

  // Revoke: anahtarı pasifleştirir + revokedAt damgalar. Soft, geri alınamaz.
  async revoke(id: string, actor: Actor) {
    this.assertAdmin(actor);
    const current = await this.findById(id, actor);
    if (current.revokedAt) return current; // idempotent

    return this.prisma.scoped.apiKey.update({
      where: { id },
      data: { isActive: false, revokedAt: new Date() },
    });
  }

  // Rotate: eski kaydı revoke et, aynı name/scopes/rateLimit ile yeni kayıt aç.
  async rotate(id: string, actor: Actor) {
    this.assertAdmin(actor);
    const old = await this.findById(id, actor);
    if (old.revokedAt) {
      throw new ForbiddenException('Cannot rotate a revoked key — create a new one instead');
    }
    await this.revoke(id, actor);
    return this.create(
      {
        name: old.name,
        scopes: old.scopes as ApiKeyCreateInput['scopes'],
        rateLimit: old.rateLimit,
        expiresAt: old.expiresAt ? old.expiresAt.toISOString() : null,
      },
      actor,
    );
  }

  private assertAdmin(actor: Actor): void {
    if (!actor.roles.includes('yonetici')) {
      throw new ForbiddenException('Only yonetici can manage API keys');
    }
  }
}

// Format "ak_{tenantSlug}_{randomHex(64)}". Tenant slug görünmesi UI'da hangi
// klinik için olduğunu bir bakışta belli ediyor; gizli kısım randomHex(64).
function generateKey(tenantSlug: string): { plaintext: string; keyHash: string; prefix: string } {
  const plaintext = `ak_${tenantSlug}_${randomBytes(32).toString('hex')}`;
  const keyHash = sha256Hex(plaintext);
  const prefix = plaintext.substring(0, 20);
  return { plaintext, keyHash, prefix };
}
