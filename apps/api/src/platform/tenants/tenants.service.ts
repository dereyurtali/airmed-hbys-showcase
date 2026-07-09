import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { DEFAULT_CLINIC_ROLES } from '@airmed/db';
import { Prisma } from '@prisma/client';
import { AdminPrismaService } from '../../prisma/admin-prisma.service';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { ImpersonationService } from '../impersonation/impersonation.service';
import {
  CreateTenantDto,
  SuspendTenantDto,
  TenantListQueryDto,
  UpdateTenantDto,
} from './tenants.dto';

// F3 Tenants yönetimi servisi (v0.2 dilimi).
//
// Tüm operasyonlar admin (postgres superuser) Prisma client'ı üzerinden çalışır
// — burası RLS dışı, platform admin'in cross-tenant erişimi var. JWT guard ve
// IP allowlist guard zaten controller seviyesinde uygulanıyor.
//
// Yetki (controller @PlatformRole ile uygulanır, servis double-check eder):
// - List / detail / stats: tüm platform admin
// - Create / update / suspend / reactivate: platform_owner + platform_engineer
// - Delete (soft): yalnız platform_owner
//
// Onboarding (createTenant):
// - Slug verilmezse name → ascii-kebab-case dönüştür
// - Tenant + 4 default role + ilk admin user + UserRole atama
// - Admin password verilmezse 16-char random; cevapta one-shot döndürülür
//
// Suspend mantığı:
// - tenants.status = 'suspended', suspend_reason/note/auto_reactivate set
// - Tenant'ın tüm aktif refresh token'larını revoke (login session'ları
//   düşmez ama refresh patlar; 15dk JWT TTL sonrası gerçek logout)

interface PlatformActor {
  id: string;
  email: string;
  role: 'platform_owner' | 'platform_engineer' | 'platform_support';
}

interface AuditContext {
  ip?: string | null;
  userAgent?: string | null;
}

const SUSPEND_REASON_ENUM = [
  'payment_overdue',
  'violation',
  'customer_request',
  'security_incident',
  'other',
] as const;

@Injectable()
export class PlatformTenantsService {
  // Tenant CRUD platform admin tarafından yapılır — RLS dışı bir admin client
  // gerekir (yeni tenant'ın roles/users tablolarına insert yaparken). PrismaService
  // (DATABASE_URL_APP, airmed_app, NOBYPASSRLS) burada işe yaramaz.
  // #1065 — paylaşımlı AdminPrismaService (tek havuz).
  constructor(
    private readonly audit: PlatformAuditService,
    private readonly impersonation: ImpersonationService,
    private readonly admin: AdminPrismaService,
  ) {}

  async list(q: TenantListQueryDto) {
    const where: Prisma.TenantWhereInput = {
      ...(q.includeDeleted ? {} : { deletedAt: null }),
      ...(q.status ? { status: q.status } : {}),
      ...(q.plan ? { plan: q.plan } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' as const } },
              { slug: { contains: q.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    return this.admin.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { users: true } },
      },
      // #1057 bonus — güvenlik tavanı. Gerçek cursor pagination (audit ekranı
      // deseni) TenantsListPage ile birlikte bilinçli ertelendi: pilot tek
      // tenant, tavana yaklaşınca (#1065 dikeyinde) sayfalama eklenecek.
      take: 200,
    });
  }

  async findById(id: string) {
    const t = await this.admin.tenant.findFirst({ where: { id } });
    if (!t) throw new NotFoundException('Tenant not found');
    return t;
  }

  async stats(id: string) {
    const tenant = await this.findById(id);
    const [userCount, patientCount, recentAppointmentCount, lastLogin] = await Promise.all([
      this.admin.user.count({ where: { tenantId: tenant.id, deletedAt: null } }),
      this.admin.patient.count({ where: { tenantId: tenant.id, deletedAt: null } }),
      this.admin.appointment.count({
        where: {
          tenantId: tenant.id,
          deletedAt: null,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
      this.admin.user.findFirst({
        where: { tenantId: tenant.id, lastLoginAt: { not: null } },
        orderBy: { lastLoginAt: 'desc' },
        select: { id: true, email: true, name: true, lastLoginAt: true },
      }),
    ]);
    return {
      tenant,
      stats: {
        userCount,
        patientCount,
        recentAppointmentCount,
        lastLogin,
      },
    };
  }

  // F7 — Admin UI: tenant detay sayfasında kullanıcı listesi + impersonate
  // butonları için. Sadece soft-delete edilmemiş kullanıcılar, role key'leri
  // dahil. Pilot ölçeği için tek seferde tüm liste (klinikte 5-20 user max).
  async listUsers(id: string) {
    const tenant = await this.findById(id);
    const users = await this.admin.user.findMany({
      where: { tenantId: tenant.id, deletedAt: null },
      orderBy: { email: 'asc' },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        lastLoginAt: true,
        userRoles: { select: { role: { select: { key: true } } } },
      },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      status: u.status,
      lastLoginAt: u.lastLoginAt,
      roles: u.userRoles.map((r) => r.role.key),
    }));
  }

  async create(
    input: CreateTenantDto,
    actor: PlatformActor,
    ctx: AuditContext,
  ): Promise<{
    tenant: Awaited<ReturnType<PlatformTenantsService['findById']>>;
    adminEmail: string;
    adminTempPassword: string;
  }> {
    this.assertWriter(actor);
    const slug = (input.slug ?? slugify(input.name)).trim().toLowerCase();
    if (!/^[a-z0-9-]{3,63}$/.test(slug)) {
      throw new BadRequestException('Generated slug invalid; provide one explicitly');
    }

    // Idempotency: slug çakışması → 409
    const existing = await this.admin.tenant.findUnique({ where: { slug } });
    if (existing) {
      throw new ConflictException('Slug already taken');
    }

    const tempPassword = input.adminPassword ?? generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    // Tek transaction: tenant + 4 role + admin user + UserRole
    const tenant = await this.admin.$transaction(async (tx) => {
      const t = await tx.tenant.create({
        data: {
          slug,
          name: input.name.trim(),
          plan: input.plan ?? 'pilot',
          locale: input.locale ?? 'tr',
          timezone: input.timezone ?? 'Asia/Dushanbe',
          status: 'active',
        },
      });

      // 7 klinik default rol — kanonik kaynak: @airmed/db DEFAULT_CLINIC_ROLES.
      // tx içinde olduğumuz için raw create (ensureClinicRoles PrismaClient
      // bekler, transaction client kabul etmez).
      for (const role of DEFAULT_CLINIC_ROLES) {
        await tx.role.create({
          data: {
            tenantId: t.id,
            key: role.key,
            label: role.label,
            isActive: role.isActive,
          },
        });
      }

      const yonetici = await tx.role.findFirstOrThrow({
        where: { tenantId: t.id, key: 'yonetici' },
      });
      const adminUser = await tx.user.create({
        data: {
          tenantId: t.id,
          email: input.adminEmail.trim().toLowerCase(),
          passwordHash,
          name: input.adminName.trim(),
          locale: t.locale,
          status: 'active',
          mustChangePassword: true,
          userRoles: { create: { tenantId: t.id, roleId: yonetici.id } },
        },
      });

      void adminUser;
      return t;
    });

    await this.audit.record({
      action: 'tenant.create',
      adminId: actor.id,
      email: actor.email,
      entityType: 'tenant',
      entityId: tenant.id,
      payload: { slug: tenant.slug, name: tenant.name, plan: tenant.plan },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return {
      tenant,
      adminEmail: input.adminEmail.trim().toLowerCase(),
      adminTempPassword: tempPassword,
    };
  }

  async update(id: string, input: UpdateTenantDto, actor: PlatformActor, ctx: AuditContext) {
    this.assertWriter(actor);
    await this.findById(id);
    const updated = await this.admin.tenant.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.plan !== undefined ? { plan: input.plan } : {}),
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.settings !== undefined
          ? { settings: input.settings as Prisma.InputJsonValue }
          : {}),
        ...(input.featureFlags !== undefined
          ? { featureFlags: input.featureFlags as Prisma.InputJsonValue }
          : {}),
      },
    });
    await this.audit.record({
      action: 'tenant.update',
      adminId: actor.id,
      email: actor.email,
      entityType: 'tenant',
      entityId: id,
      payload: input as unknown as Prisma.InputJsonValue,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return updated;
  }

  async suspend(id: string, input: SuspendTenantDto, actor: PlatformActor, ctx: AuditContext) {
    this.assertWriter(actor);
    const tenant = await this.findById(id);
    if (tenant.status === 'suspended') {
      throw new ConflictException('Tenant already suspended');
    }
    if (!SUSPEND_REASON_ENUM.includes(input.reason)) {
      throw new BadRequestException('Invalid suspend reason');
    }
    const autoReactivateAt = input.autoReactivateAt ? new Date(input.autoReactivateAt) : null;
    if (autoReactivateAt && Number.isNaN(autoReactivateAt.getTime())) {
      throw new BadRequestException('autoReactivateAt must be ISO-8601');
    }

    const result = await this.admin.$transaction(async (tx) => {
      const updated = await tx.tenant.update({
        where: { id },
        data: {
          status: 'suspended',
          suspendedAt: new Date(),
          suspendReason: input.reason,
          suspendNote: input.note ?? null,
          autoReactivateAt,
        },
      });
      // Tüm aktif refresh token'ları revoke
      await tx.refreshToken.updateMany({
        where: { tenantId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return updated;
    });

    await this.audit.record({
      action: 'tenant.suspend',
      adminId: actor.id,
      email: actor.email,
      entityType: 'tenant',
      entityId: id,
      payload: {
        reason: input.reason,
        note: input.note ?? null,
        autoReactivateAt: input.autoReactivateAt ?? null,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    // F4 — Suspended tenant'a karşı aktif impersonation token'ları reddet.
    // Best-effort; impersonation servisindeki hata tenant suspend'i geri
    // sarmaz (audit + token revoke zaten tamamlandı).
    await this.impersonation.onTenantSuspended(id);
    return result;
  }

  async reactivate(id: string, actor: PlatformActor, ctx: AuditContext) {
    this.assertWriter(actor);
    const tenant = await this.findById(id);
    if (tenant.status !== 'suspended') {
      throw new ConflictException('Tenant is not suspended');
    }
    const updated = await this.admin.tenant.update({
      where: { id },
      data: {
        status: 'active',
        suspendedAt: null,
        suspendReason: null,
        suspendNote: null,
        autoReactivateAt: null,
      },
    });
    await this.audit.record({
      action: 'tenant.reactivate',
      adminId: actor.id,
      email: actor.email,
      entityType: 'tenant',
      entityId: id,
      payload: {},
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return updated;
  }

  // -------------------- helpers --------------------

  private assertWriter(actor: PlatformActor): void {
    if (actor.role === 'platform_owner' || actor.role === 'platform_engineer') return;
    throw new ForbiddenException(
      'Yalnızca platform_owner ve platform_engineer tenant değişikliği yapabilir',
    );
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ıİ]/g, 'i')
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

function generateTempPassword(): string {
  // 16 byte → 24 char base64 — kullanıcı-dostu için 16 hex char (8 byte) yeterli.
  return crypto.randomBytes(8).toString('hex');
}
