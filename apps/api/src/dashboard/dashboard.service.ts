import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import type { GetLayoutInput, SaveLayoutInput, WidgetCell } from './dashboard.schemas';

// S14 — v0.1 dashboard widget framework port. Layout service.
//
// Lookup öncelik:
//   1) tenant + roleKey + (userId set) — kullanıcı kişisel override
//   2) tenant + roleKey + (userId null) — tenant-içi rol default'u
//   3) (yok) — frontend defaults.ts kullanır
//
// Save şu an sadece tenant default'u (userId null) için yazar. Per-user
// drag-to-reorder ileri faz.

export interface DashboardLayoutDTO {
  roleKey: string;
  widgets: WidgetCell[];
  isPersonal: boolean;
  source: 'user' | 'role' | 'default';
}

@Injectable()
export class DashboardLayoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Kullanıcı için layout getir. Per-user override yoksa rol default'una düş;
   * o da yoksa source='default' döner ve frontend defaults.ts devreye girer.
   */
  async getLayout(input: GetLayoutInput, userId: string): Promise<DashboardLayoutDTO> {
    const tenantId = this.tenantContext.requireTenantId();

    // 1) personal override
    const personal = await this.prisma.scoped.dashboardLayout.findFirst({
      where: { tenantId, roleKey: input.roleKey, userId },
    });
    if (personal) {
      return {
        roleKey: input.roleKey,
        widgets: this.parseWidgets(personal.widgets),
        isPersonal: true,
        source: 'user',
      };
    }

    // 2) tenant role default
    const roleDefault = await this.prisma.scoped.dashboardLayout.findFirst({
      where: { tenantId, roleKey: input.roleKey, userId: null },
    });
    if (roleDefault) {
      return {
        roleKey: input.roleKey,
        widgets: this.parseWidgets(roleDefault.widgets),
        isPersonal: false,
        source: 'role',
      };
    }

    // 3) DB'de hiç kayıt yok — frontend default
    return {
      roleKey: input.roleKey,
      widgets: [],
      isPersonal: false,
      source: 'default',
    };
  }

  /**
   * Tenant role default'unu yaz (yetki: yönetici). Per-user override
   * `saveUserLayout` ileri fazda.
   */
  async saveRoleDefault(input: SaveLayoutInput): Promise<DashboardLayoutDTO> {
    const tenantId = this.tenantContext.requireTenantId();
    const widgets = input.widgets as Prisma.InputJsonValue;

    // Upsert: (tenant, role, userId=null) tekil. Migration'da unique partial
    // index var, bu yüzden findFirst + create/update pattern kullanıyoruz.
    const existing = await this.prisma.scoped.dashboardLayout.findFirst({
      where: { tenantId, roleKey: input.roleKey, userId: null },
    });

    const saved = existing
      ? await this.prisma.scoped.dashboardLayout.update({
          where: { id: existing.id },
          data: { widgets },
        })
      : await this.prisma.scoped.dashboardLayout.create({
          data: { tenantId, roleKey: input.roleKey, userId: null, widgets },
        });

    return {
      roleKey: input.roleKey,
      widgets: this.parseWidgets(saved.widgets),
      isPersonal: false,
      source: 'role',
    };
  }

  private parseWidgets(value: Prisma.JsonValue): WidgetCell[] {
    if (!Array.isArray(value)) return [];
    return value as WidgetCell[];
  }
}
