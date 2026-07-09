import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type PlatformRole } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { AdminPrismaService } from '../../prisma/admin-prisma.service';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { CreateAdminDto, UpdateAdminRoleDto } from './admins.dto';

// #946 (Feature 3) — Platform admin CRUD. Yeni admin ekleme/rol/deaktive/TOTP-
// reset artık CLI+DB yerine panelden. Cross-tenant → RLS-bypass admin client
// (#1065 — paylaşımlı AdminPrismaService, tek havuz).
// Yetki service-layer: list=assertReader, mutasyon=assertOwner (yalnız owner).

interface Actor {
  id: string;
  email: string;
  role: PlatformRole;
}
interface Ctx {
  ip: string | null;
  userAgent: string | null;
}

// Şifre/totpSecret ASLA dönmez.
const SAFE_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  totpVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

@Injectable()
export class AdminsService {
  constructor(
    private readonly audit: PlatformAuditService,
    private readonly admin: AdminPrismaService,
  ) {}

  private assertReader(a: Actor): void {
    if (
      a.role === 'platform_owner' ||
      a.role === 'platform_engineer' ||
      a.role === 'platform_support'
    )
      return;
    throw new ForbiddenException('Platform admin gerekiyor');
  }

  private assertOwner(a: Actor): void {
    if (a.role !== 'platform_owner')
      throw new ForbiddenException('Bu işlem yalnız platform_owner için');
  }

  private async assertNotLastOwner(): Promise<void> {
    const owners = await this.admin.platformAdmin.count({
      where: { role: 'platform_owner', isActive: true },
    });
    if (owners <= 1) throw new BadRequestException('En az bir aktif platform_owner kalmalı');
  }

  async list(actor: Actor) {
    this.assertReader(actor);
    return this.admin.platformAdmin.findMany({
      select: SAFE_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(dto: CreateAdminDto, actor: Actor, ctx: Ctx) {
    this.assertOwner(actor);
    const existing = await this.admin.platformAdmin.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) throw new BadRequestException('Bu e-posta zaten kayıtlı');

    // Geçici şifre (tenants.service ile aynı üretim); TOTP ilk login'de zorlanır.
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    const created = await this.admin.platformAdmin.create({
      data: { email: dto.email, name: dto.name, role: dto.role, passwordHash },
      select: SAFE_SELECT,
    });
    await this.audit.record({
      action: 'platform_admin.create',
      adminId: actor.id,
      email: actor.email,
      entityType: 'platform_admin',
      entityId: created.id,
      payload: { role: dto.role },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    // tempPassword TEK SEFERLİK döner (NewTenantPage tek-seferlik şifre kalıbı).
    return { admin: created, tempPassword };
  }

  async updateRole(id: string, dto: UpdateAdminRoleDto, actor: Actor, ctx: Ctx) {
    this.assertOwner(actor);
    const target = await this.admin.platformAdmin.findUnique({
      where: { id },
      select: { id: true, role: true, isActive: true },
    });
    if (!target) throw new NotFoundException('Admin bulunamadı');
    // Son owner'ı düşürme (min-1-owner invariant).
    if (target.role === 'platform_owner' && target.isActive && dto.role !== 'platform_owner') {
      await this.assertNotLastOwner();
    }
    const updated = await this.admin.platformAdmin.update({
      where: { id },
      data: { role: dto.role },
      select: SAFE_SELECT,
    });
    await this.audit.record({
      action: 'platform_admin.update_role',
      adminId: actor.id,
      email: actor.email,
      entityType: 'platform_admin',
      entityId: id,
      payload: { role: dto.role },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return updated;
  }

  async deactivate(id: string, actor: Actor, ctx: Ctx) {
    this.assertOwner(actor);
    if (id === actor.id) throw new BadRequestException('Kendinizi deaktive edemezsiniz');
    const target = await this.admin.platformAdmin.findUnique({
      where: { id },
      select: { id: true, role: true, isActive: true },
    });
    if (!target) throw new NotFoundException('Admin bulunamadı');
    if (target.role === 'platform_owner' && target.isActive) {
      await this.assertNotLastOwner();
    }
    const updated = await this.admin.platformAdmin.update({
      where: { id },
      data: { isActive: false },
      select: SAFE_SELECT,
    });
    // Tüm aktif oturumları iptal et → anında dışarı.
    await this.admin.platformAdminSession.updateMany({
      where: { adminId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      action: 'platform_admin.deactivate',
      adminId: actor.id,
      email: actor.email,
      entityType: 'platform_admin',
      entityId: id,
      payload: {},
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return updated;
  }

  async resetTotp(id: string, actor: Actor, ctx: Ctx) {
    this.assertOwner(actor);
    const target = await this.admin.platformAdmin.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('Admin bulunamadı');
    const updated = await this.admin.platformAdmin.update({
      where: { id },
      data: { totpSecret: null, totpVerifiedAt: null },
      select: SAFE_SELECT,
    });
    await this.audit.record({
      action: 'platform_admin.reset_totp',
      adminId: actor.id,
      email: actor.email,
      entityType: 'platform_admin',
      entityId: id,
      payload: {},
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return updated;
  }
}
