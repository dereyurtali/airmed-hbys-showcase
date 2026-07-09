import { Injectable } from '@nestjs/common';
import { PERMISSIONS, type Role } from '@airmed/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import type { MatrixReadInput, MatrixToggleInput } from './permission.schemas';

// S14 — v0.1 permission matrix UI port. PermissionAssignment override CRUD.
//
// matrixRead: PERMISSIONS registry'den varsayılanları + tenant'daki override'ları
// birleştirir. UI rol × resource grid'i için kullanılır.
//
// matrixToggle: tek (rol, resource) için override yazar. allowed=true →
// varsayılan yetkili değilse ek erişim verir; allowed=false → varsayılan
// yetkili olsa bile reddeder.
//
// NOT: Runtime'da gerçek izin kontrolü hâlâ kod-bazlı (`hasPermission` registry).
// PermissionAssignment hook'unun runtime entegrasyonu ileri faz — şu an tablo
// sadece UI tarafından okunup yazılır (visibility audit).

export interface MatrixCell {
  roleKey: string;
  resource: string;
  defaultAllowed: boolean; // registry'den
  overrideAllowed: boolean | null; // null = override yok
  effectiveAllowed: boolean; // override varsa o, yoksa default
}

@Injectable()
export class PermissionMatrixService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async read(input: MatrixReadInput): Promise<MatrixCell[]> {
    const tenantId = this.tenantContext.requireTenantId();

    // Registry'den tüm resource'ları çıkar
    const allResources = Object.keys(PERMISSIONS).filter((r) => {
      if (input.resourcePrefix === 'all') return true;
      return r.startsWith(input.resourcePrefix);
    });

    // Override'ları çek
    const overrides = await this.prisma.scoped.permissionAssignment.findMany({
      where: { tenantId },
      select: { roleKey: true, resource: true, allowed: true },
    });
    const overrideMap = new Map<string, boolean>();
    for (const ov of overrides) {
      overrideMap.set(`${ov.roleKey}::${ov.resource}`, ov.allowed);
    }

    // Tüm rol × resource grid. v0.4 #565 — kanonik: DEFAULT_CLINIC_ROLES (10).
    // Yeni rol eklenince burayı da güncelle; aksi halde Yetkiler matrisi yeni
    // rol için satır üretmez (yönetici o rolün izinlerini override edemez).
    const ROLE_KEYS: readonly Role[] = [
      'yonetici',
      'yonetici_asistani',
      'doktor',
      'resepsiyon',
      'hemsire',
      'ameliyat_satis',
      'olcum_hemsiresi',
      'finans',
      'stok_satinalma',
      'eczane',
    ];

    const cells: MatrixCell[] = [];
    for (const resource of allResources) {
      const allowedRoles = PERMISSIONS[resource as keyof typeof PERMISSIONS] as readonly Role[];
      for (const roleKey of ROLE_KEYS) {
        const defaultAllowed = allowedRoles.includes(roleKey);
        const overrideAllowed = overrideMap.get(`${roleKey}::${resource}`) ?? null;
        const effectiveAllowed = overrideAllowed ?? defaultAllowed;
        cells.push({ roleKey, resource, defaultAllowed, overrideAllowed, effectiveAllowed });
      }
    }
    return cells;
  }

  async toggle(input: MatrixToggleInput) {
    const tenantId = this.tenantContext.requireTenantId();

    // Upsert: (tenant, role, resource) unique. Default davranışla aynı ise
    // (override = default), kaydı sil → veritabanı temiz kalır.
    const defaultAllowedRoles = PERMISSIONS[input.resource as keyof typeof PERMISSIONS] as
      readonly Role[] | undefined;
    const defaultAllowed = defaultAllowedRoles?.includes(input.roleKey as Role) ?? false;

    if (input.allowed === defaultAllowed) {
      // Override gerekmez — varsa sil
      await this.prisma.scoped.permissionAssignment.deleteMany({
        where: { tenantId, roleKey: input.roleKey, resource: input.resource },
      });
      return { roleKey: input.roleKey, resource: input.resource, override: null };
    }

    const existing = await this.prisma.scoped.permissionAssignment.findFirst({
      where: { tenantId, roleKey: input.roleKey, resource: input.resource },
    });

    const saved = existing
      ? await this.prisma.scoped.permissionAssignment.update({
          where: { id: existing.id },
          data: { allowed: input.allowed },
        })
      : await this.prisma.scoped.permissionAssignment.create({
          data: {
            tenantId,
            roleKey: input.roleKey,
            resource: input.resource,
            allowed: input.allowed,
          },
        });

    return { roleKey: saved.roleKey, resource: saved.resource, override: saved.allowed };
  }
}
