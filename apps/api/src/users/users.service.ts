import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuditService } from '../audit/audit.service';
import { generateStrongPassword } from '../auth/password.util';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import type {
  UserCreateInput,
  UserIdInput,
  UserListQuery,
  UserUpdateInput,
  UserUpdateModesInput,
} from './users.schemas';

const BCRYPT_COST = 12;

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  locale: true,
  // #1049 — personel profil telefonu
  phone: true,
  // #1050 — mod adayları (flags.modes) + doktor nitelikleri detay UI'da gösterilir
  flags: true,
  status: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  userRoles: {
    select: {
      role: { select: { key: true, label: true } },
    },
  },
  doctorProfile: { select: { id: true, specialty: true, type: true } },
} as const;

// #1050 — Açık DTO: `flags` Prisma'da JsonValue (özyinelemeli tip) döner;
// tRPC AppRouter inference'ını TS2589'a itmemek için wire tipi burada
// sabitlenir (doctor.service.DoctorRow ile aynı desen).
export interface UserFlagsDto {
  modes?: string[];
  is_visiting_doctor?: boolean;
  can_see_all_patients?: boolean;
  [key: string]: unknown;
}

export interface UserAdminDto {
  id: string;
  email: string;
  name: string;
  locale: string;
  phone: string | null;
  flags: UserFlagsDto | null;
  status: 'active' | 'inactive' | 'locked' | 'suspended';
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  userRoles: Array<{ role: { key: string; label: string } }>;
  doctorProfile: { id: string; specialty: string; type: string } | null;
}

type Actor = { id: string; roles: readonly string[] };

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async list({ search, roleKey, status, page, pageSize }: UserListQuery) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' as const } },
              { name: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(roleKey ? { userRoles: { some: { role: { key: roleKey } } } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.scoped.user.findMany({
        where,
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: USER_SELECT,
      }),
      this.prisma.scoped.user.count({ where }),
    ]);
    return { items: items as UserAdminDto[], total, page, pageSize };
  }

  async getById(id: string): Promise<UserAdminDto> {
    const user = await this.prisma.scoped.user.findFirst({
      where: { id, deletedAt: null },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('Kullanıcı bulunamadı');
    return user as UserAdminDto;
  }

  async create(input: UserCreateInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();

    const role = await this.prisma.scoped.role.findFirst({
      where: { key: input.roleKey, isActive: true },
      select: { id: true, key: true, isActive: true },
    });
    if (!role) {
      throw new BadRequestException(
        `Rol bulunamadı veya pasif: ${input.roleKey} (klinik ayarlarından aktive edin)`,
      );
    }

    const existing = await this.prisma.scoped.user.findFirst({
      where: { email: input.email, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Bu e-posta ile bir kullanıcı zaten var');
    }

    const password = generateStrongPassword();
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    // Misafir doktor seçilirse User.flags.is_visiting_doctor otomatik true:
    // hasta listesi sıkı izolasyon (PatientService.list visiting flag'ine bakıp
    // sadece Surgery.doctorId üzerinden hastaları döndürür). Yönetici sonradan
    // DoctorFlagsToggle (S8 PR #190) ile bu flag'i değiştirebilir.
    const isVisitingDoctor = input.roleKey === 'doktor' && input.doctor?.type === 'visiting';

    // v0.4 — yeni kullanıcı flags. Doktor: misafir niteliği. Hemşire/ölçüm: oturum
    // modu adayları (login mod seçici bunlara bakar; göç migration'ı 2a/2c ile aynı
    // varsayılan). Hemşire → Genel+Asistan; olcum_hemsiresi → kilitli Ölçüm kiosk.
    // Yoksa hemşire mod'suz oluşur → login'de mod seçeneği çıkmaz (#: staging bug).
    const flags: { is_visiting_doctor?: boolean; modes?: string[] } = {};
    if (isVisitingDoctor) flags.is_visiting_doctor = true;
    if (input.roleKey === 'hemsire') flags.modes = ['genel', 'asistan'];
    else if (input.roleKey === 'olcum_hemsiresi') flags.modes = ['olcum'];

    // TenantInterceptor zaten request'i tenant-scoped transaction içine sarıyor;
    // prisma.scoped (= tx) üzerinde ardışık call'lar atomik (rollback edilebilir).
    const tx = this.prisma.scoped;
    const created = await tx.user.create({
      data: {
        tenantId,
        email: input.email,
        name: input.name,
        locale: input.locale,
        passwordHash,
        status: 'active',
        mustChangePassword: true,
        flags: Object.keys(flags).length > 0 ? flags : undefined,
      },
    });
    await tx.userRole.create({
      data: { tenantId, userId: created.id, roleId: role.id },
    });
    if (input.roleKey === 'doktor' && input.doctor) {
      await tx.doctor.create({
        data: {
          tenantId,
          userId: created.id,
          name: input.name,
          specialty: input.doctor.specialty,
          type: input.doctor.type,
          contactEmail: input.email,
          isActive: true,
        },
      });
    }

    await this.audit.record({
      action: 'user.created',
      entityType: 'user',
      entityId: created.id,
      userId: actor.id,
      tenantId,
      payload: {
        email: input.email,
        roleKey: input.roleKey,
        name: input.name,
        ...(isVisitingDoctor ? { visitingDoctorAutoFlag: true } : {}),
      },
    });

    const safe = await this.getById(created.id);
    return { user: safe, password };
  }

  async update(input: UserUpdateInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    const existing = await this.getById(input.id);

    const data: Prisma.UserUpdateInput = {};
    if (input.name !== undefined && input.name !== existing.name) data.name = input.name;
    if (input.locale !== undefined && input.locale !== existing.locale) data.locale = input.locale;
    // #1049 — personel telefonu (null = temizle)
    if (input.phone !== undefined && input.phone !== existing.phone) data.phone = input.phone;

    if (Object.keys(data).length === 0) return existing;

    await this.prisma.scoped.user.update({ where: { id: input.id }, data });

    // Doktor profili kullanıcının `name` alanını ayna olarak tutar — UI tutarlılığı.
    if (data.name && existing.doctorProfile) {
      await this.prisma.scoped.doctor.update({
        where: { id: existing.doctorProfile.id },
        data: { name: input.name },
      });
    }

    await this.audit.record({
      action: 'user.updated',
      entityType: 'user',
      entityId: input.id,
      userId: actor.id,
      tenantId,
      payload: { changed: Object.keys(data) },
    });

    return this.getById(input.id);
  }

  /**
   * #1050 — Hemşire mod adayları (flags.modes) düzenleme. Yalnız hemşire
   * rolündeki kullanıcıda anlamlı; diğer rollerde 400 (mod kavramı yok).
   * Merge-patch: diğer flag'lere (is_visiting_doctor vb.) DOKUNMAZ —
   * doctor.service.updateDoctorUserFlags ile aynı desen. JWT `mode` login'de
   * seçilir; değişiklik kullanıcının sonraki login'inde etkili olur.
   */
  async updateModes(input: UserUpdateModesInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    const existing = await this.getById(input.id);

    const isNurse = existing.userRoles.some((ur) => ur.role.key === 'hemsire');
    if (!isNurse) {
      throw new BadRequestException(
        'Mod adayları yalnız hemşire rolündeki kullanıcıda düzenlenebilir',
      );
    }

    const modes = Array.from(new Set(input.modes));
    const current = (existing.flags ?? {}) as Record<string, unknown>;
    const next: Prisma.InputJsonValue = { ...current, modes };

    await this.prisma.scoped.user.update({
      where: { id: input.id },
      data: { flags: next },
    });

    await this.audit.record({
      action: 'user.modes_updated',
      entityType: 'user',
      entityId: input.id,
      userId: actor.id,
      tenantId,
      payload: { modes },
    });

    return this.getById(input.id);
  }

  async resetPassword({ id }: UserIdInput, actor: Actor): Promise<{ password: string }> {
    const tenantId = this.tenantContext.requireTenantId();
    await this.getById(id); // 404 if not found / cross-tenant

    const password = generateStrongPassword();
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    await this.prisma.scoped.user.update({
      where: { id },
      data: {
        passwordHash,
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    await this.audit.record({
      action: 'user.password_reset',
      entityType: 'user',
      entityId: id,
      userId: actor.id,
      tenantId,
      // Şifreyi LOGLAMIYORUZ — sadece hangi user'a reset yapıldığı denetlenir.
    });

    return { password };
  }

  async deactivate({ id }: UserIdInput, actor: Actor) {
    if (id === actor.id) {
      throw new BadRequestException('Kendinizi pasifleştiremezsiniz');
    }
    const tenantId = this.tenantContext.requireTenantId();
    const existing = await this.getById(id);
    if (existing.status === 'inactive') return existing;

    await this.prisma.scoped.user.update({
      where: { id },
      data: { status: 'inactive' },
    });

    // #1149 — Doktorun durumu hesap tarafından yönetilir (tek kaynak). Hesap
    // pasifleşince klinik roster kaydı da pasifleşir (deletedAt'e DOKUNMA →
    // reactivate geri getirir; kalıcı silme ayrı softDelete akışı).
    await this.syncDoctorActive(existing.doctorProfile?.id, false);

    await this.audit.record({
      action: 'user.deactivated',
      entityType: 'user',
      entityId: id,
      userId: actor.id,
      tenantId,
    });

    return this.getById(id);
  }

  async reactivate({ id }: UserIdInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    const existing = await this.getById(id);
    if (existing.status === 'active') return existing;

    await this.prisma.scoped.user.update({
      where: { id },
      data: { status: 'active', failedLoginCount: 0, lockedUntil: null },
    });

    // #1149 — Hesap yeniden aktifleşince klinik roster kaydı da geri gelir.
    // Kalıcı silinmiş (deletedAt set) doktora dokunmaz: updateMany filtresi
    // deletedAt: null ister → yanlışlıkla resurrect yok.
    await this.syncDoctorActive(existing.doctorProfile?.id, true);

    await this.audit.record({
      action: 'user.reactivated',
      entityType: 'user',
      entityId: id,
      userId: actor.id,
      tenantId,
    });

    return this.getById(id);
  }

  // #1149 — Hesap durumunu doktorun klinik roster durumuna (Doctor.isActive)
  // aynalar. deletedAt'e DOKUNMAZ (kalıcı silme ayrı akış); updateMany +
  // deletedAt: null filtresi kalıcı silinmiş kaydı korur.
  private async syncDoctorActive(doctorId: string | undefined, isActive: boolean): Promise<void> {
    if (!doctorId) return;
    await this.prisma.scoped.doctor.updateMany({
      where: { id: doctorId, deletedAt: null },
      data: { isActive },
    });
  }
}
