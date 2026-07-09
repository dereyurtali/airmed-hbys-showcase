import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { userUpdateModesSchema } from './users.schemas';
import { UsersService } from './users.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ROLE_DOKTOR_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ROLE_HEMSIRE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const DOCTOR_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

type UserRow = {
  id: string;
  email: string;
  name: string;
  locale: string;
  phone: string | null;
  flags: Record<string, unknown> | null;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  userRoles: Array<{ role: { key: string; label: string } }>;
  doctorProfile: { id: string; specialty: string; type: string } | null;
};

describe('UsersService', () => {
  let service: UsersService;
  let scoped: {
    user: {
      create: jest.Mock;
      update: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    userRole: { create: jest.Mock };
    doctor: { create: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    role: { findFirst: jest.Mock };
  };
  let audit: { record: jest.Mock };
  const actor = { id: ACTOR_ID, roles: ['yonetici'] };

  function buildUserRow(overrides: Partial<UserRow> = {}): UserRow {
    return {
      id: USER_ID,
      email: 'doktor@klinik.tj',
      name: 'Dr. Test',
      locale: 'tr',
      phone: null,
      flags: null,
      status: 'active',
      mustChangePassword: true,
      lastLoginAt: null,
      createdAt: new Date('2026-06-01T08:00:00Z'),
      userRoles: [{ role: { key: 'doktor', label: 'Doktor' } }],
      doctorProfile: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    scoped = {
      user: {
        create: jest.fn(async ({ data }) => ({ id: USER_ID, ...data })),
        update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      userRole: { create: jest.fn().mockResolvedValue({}) },
      doctor: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      role: { findFirst: jest.fn() },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const prisma = { scoped } as unknown as PrismaService;
    const tenantContext = {
      requireTenantId: () => TENANT_ID,
    } as unknown as TenantContextService;

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantContextService, useValue: tenantContext },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  describe('create', () => {
    it('doktor rolünde User + UserRole + Doctor record yaratır', async () => {
      scoped.role.findFirst.mockResolvedValue({
        id: ROLE_DOKTOR_ID,
        key: 'doktor',
        isActive: true,
      });
      scoped.user.findFirst.mockResolvedValueOnce(null); // email check
      scoped.user.findFirst.mockResolvedValueOnce(buildUserRow()); // getById after create

      const result = await service.create(
        {
          email: 'doktor@klinik.tj',
          name: 'Dr. Test',
          roleKey: 'doktor',
          locale: 'tr',
          doctor: { specialty: 'Göz Hastalıkları', type: 'local' },
        },
        actor,
      );

      expect(scoped.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'doktor@klinik.tj',
            mustChangePassword: true,
            status: 'active',
          }),
        }),
      );
      expect(scoped.userRole.create).toHaveBeenCalledWith({
        data: { tenantId: TENANT_ID, userId: USER_ID, roleId: ROLE_DOKTOR_ID },
      });
      expect(scoped.doctor.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          userId: USER_ID,
          name: 'Dr. Test',
          specialty: 'Göz Hastalıkları',
          type: 'local',
        }),
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.created', entityId: USER_ID }),
      );
      expect(result.password).toHaveLength(12);
    });

    it('misafir doktorda User.flags.is_visiting_doctor otomatik true', async () => {
      scoped.role.findFirst.mockResolvedValue({
        id: ROLE_DOKTOR_ID,
        key: 'doktor',
        isActive: true,
      });
      scoped.user.findFirst.mockResolvedValueOnce(null);
      scoped.user.findFirst.mockResolvedValueOnce(buildUserRow());

      await service.create(
        {
          email: 'misafir@klinik.tj',
          name: 'Dr. Misafir',
          roleKey: 'doktor',
          locale: 'tr',
          doctor: { specialty: 'Retina', type: 'visiting' },
        },
        actor,
      );

      expect(scoped.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            flags: { is_visiting_doctor: true },
          }),
        }),
      );
      const auditCall = audit.record.mock.calls[0][0];
      expect(auditCall.payload.visitingDoctorAutoFlag).toBe(true);
    });

    // v0.4 — hemşire oluşturulurken flags.modes default ['genel','asistan'] set
    // edilmeli ki login'de mod seçici çıksın (yoksa hemşire mod'suz → seçici yok).
    it('hemşire rolünde flags.modes default [genel, asistan] set edilir', async () => {
      scoped.role.findFirst.mockResolvedValue({
        id: 'role-hemsire',
        key: 'hemsire',
        isActive: true,
      });
      scoped.user.findFirst.mockResolvedValueOnce(null);
      scoped.user.findFirst.mockResolvedValueOnce(buildUserRow());

      await service.create(
        { email: 'hemsire@klinik.tj', name: 'Hemşire Test', roleKey: 'hemsire', locale: 'tr' },
        actor,
      );

      expect(scoped.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ flags: { modes: ['genel', 'asistan'] } }),
        }),
      );
    });

    it('yerleşik doktorda flags set edilmez', async () => {
      scoped.role.findFirst.mockResolvedValue({
        id: ROLE_DOKTOR_ID,
        key: 'doktor',
        isActive: true,
      });
      scoped.user.findFirst.mockResolvedValueOnce(null);
      scoped.user.findFirst.mockResolvedValueOnce(buildUserRow());

      await service.create(
        {
          email: 'yerlesik@klinik.tj',
          name: 'Dr. Yerlesik',
          roleKey: 'doktor',
          locale: 'tr',
          doctor: { specialty: 'Genel', type: 'local' },
        },
        actor,
      );

      const userCreateCall = scoped.user.create.mock.calls[0][0];
      expect(userCreateCall.data.flags).toBeUndefined();
    });

    it('hemşire rolünde Doctor record yaratmaz', async () => {
      scoped.role.findFirst.mockResolvedValue({
        id: ROLE_HEMSIRE_ID,
        key: 'hemsire',
        isActive: true,
      });
      scoped.user.findFirst.mockResolvedValueOnce(null);
      scoped.user.findFirst.mockResolvedValueOnce(buildUserRow({ name: 'Hemşire Ayşe' }));

      await service.create(
        { email: 'h@klinik.tj', name: 'Hemşire Ayşe', roleKey: 'hemsire', locale: 'tr' },
        actor,
      );

      expect(scoped.userRole.create).toHaveBeenCalled();
      expect(scoped.doctor.create).not.toHaveBeenCalled();
    });

    it('duplicate e-postada ConflictException atar', async () => {
      scoped.role.findFirst.mockResolvedValue({
        id: ROLE_DOKTOR_ID,
        key: 'doktor',
        isActive: true,
      });
      scoped.user.findFirst.mockResolvedValueOnce({ id: 'existing' });

      await expect(
        service.create(
          {
            email: 'mevcut@klinik.tj',
            name: 'Y',
            roleKey: 'doktor',
            locale: 'tr',
            doctor: { specialty: 'X', type: 'local' },
          },
          actor,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('pasif rol seçilirse BadRequestException atar', async () => {
      scoped.role.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          { email: 'a@b.tj', name: 'A', roleKey: 'olcum_hemsiresi', locale: 'tr' },
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('resetPassword', () => {
    it('mustChangePassword=true + lockedUntil=null set eder ve audit yazar', async () => {
      scoped.user.findFirst.mockResolvedValue(buildUserRow());

      const { password } = await service.resetPassword({ id: USER_ID }, actor);

      expect(password).toHaveLength(12);
      expect(scoped.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: expect.objectContaining({
          mustChangePassword: true,
          failedLoginCount: 0,
          lockedUntil: null,
        }),
      });
      const auditCall = audit.record.mock.calls[0][0];
      expect(auditCall.action).toBe('user.password_reset');
      expect(JSON.stringify(auditCall)).not.toContain(password); // şifre log'a yazılmaz
    });

    it('kullanıcı yoksa NotFoundException', async () => {
      scoped.user.findFirst.mockResolvedValue(null);
      await expect(service.resetPassword({ id: USER_ID }, actor)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('deactivate', () => {
    it('kendi kendini pasifleştirmeyi reddeder', async () => {
      await expect(
        service.deactivate({ id: ACTOR_ID }, { id: ACTOR_ID, roles: ['yonetici'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(scoped.user.update).not.toHaveBeenCalled();
    });

    it('aktif kullanıcıyı inactive yapar', async () => {
      scoped.user.findFirst.mockResolvedValue(buildUserRow({ status: 'active' }));
      await service.deactivate({ id: USER_ID }, actor);
      expect(scoped.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { status: 'inactive' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.deactivated' }),
      );
    });

    it('zaten inactive ise update çağırmaz', async () => {
      scoped.user.findFirst.mockResolvedValue(buildUserRow({ status: 'inactive' }));
      await service.deactivate({ id: USER_ID }, actor);
      expect(scoped.user.update).not.toHaveBeenCalled();
    });

    // #1149 — durum tek kaynağı hesap: pasifleşince doktor roster kaydı da pasifleşir.
    it('doktor hesabı pasifleşince Doctor.isActive=false (deletedAt korunur)', async () => {
      scoped.user.findFirst.mockResolvedValue(
        buildUserRow({
          status: 'active',
          doctorProfile: { id: DOCTOR_ID, specialty: 'Retina', type: 'local' },
        }),
      );
      await service.deactivate({ id: USER_ID }, actor);
      expect(scoped.doctor.updateMany).toHaveBeenCalledWith({
        where: { id: DOCTOR_ID, deletedAt: null },
        data: { isActive: false },
      });
    });

    it('doktor profili olmayan kullanıcıda doctor.updateMany çağrılmaz', async () => {
      scoped.user.findFirst.mockResolvedValue(buildUserRow({ status: 'active' }));
      await service.deactivate({ id: USER_ID }, actor);
      expect(scoped.doctor.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('reactivate', () => {
    it('inactive kullanıcıyı active yapar', async () => {
      scoped.user.findFirst.mockResolvedValue(buildUserRow({ status: 'inactive' }));
      await service.reactivate({ id: USER_ID }, actor);
      expect(scoped.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { status: 'active', failedLoginCount: 0, lockedUntil: null },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.reactivated' }),
      );
    });

    // #1149 — hesap geri gelince roster kaydı da geri gelir.
    it('doktor hesabı yeniden aktifleşince Doctor.isActive=true', async () => {
      scoped.user.findFirst.mockResolvedValue(
        buildUserRow({
          status: 'inactive',
          doctorProfile: { id: DOCTOR_ID, specialty: 'Retina', type: 'local' },
        }),
      );
      await service.reactivate({ id: USER_ID }, actor);
      expect(scoped.doctor.updateMany).toHaveBeenCalledWith({
        where: { id: DOCTOR_ID, deletedAt: null },
        data: { isActive: true },
      });
    });
  });

  describe('updateModes', () => {
    const nurseRow = (flags: Record<string, unknown> | null = null) =>
      buildUserRow({
        userRoles: [{ role: { key: 'hemsire', label: 'Hemşire' } }],
        flags,
      });

    it('hemşire olmayan kullanıcıda BadRequestException atar', async () => {
      scoped.user.findFirst.mockResolvedValue(buildUserRow()); // doktor rolü
      await expect(
        service.updateModes({ id: USER_ID, modes: ['genel'] }, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(scoped.user.update).not.toHaveBeenCalled();
    });

    it('boş modes listesi Zod şemasında reddedilir', () => {
      const result = userUpdateModesSchema.safeParse({ id: USER_ID, modes: [] });
      expect(result.success).toBe(false);
    });

    it('flags merge-patch: diğer flag korunur, modes değişir + dedupe', async () => {
      scoped.user.findFirst.mockResolvedValue(nurseRow({ some_other_flag: true }));
      await service.updateModes({ id: USER_ID, modes: ['genel', 'olcum', 'genel'] }, actor);
      expect(scoped.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { flags: { some_other_flag: true, modes: ['genel', 'olcum'] } },
      });
    });

    it('audit user.modes_updated kaydı yazar', async () => {
      scoped.user.findFirst.mockResolvedValue(nurseRow({ modes: ['genel'] }));
      await service.updateModes({ id: USER_ID, modes: ['asistan'] }, actor);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'user.modes_updated',
          entityId: USER_ID,
          payload: { modes: ['asistan'] },
        }),
      );
    });
  });

  describe('update', () => {
    it("name değişimini hem User hem Doctor record'a uygular", async () => {
      scoped.user.findFirst.mockResolvedValue(
        buildUserRow({
          name: 'Eski',
          doctorProfile: { id: 'doc-1', specialty: 'Göz', type: 'local' },
        }),
      );
      await service.update({ id: USER_ID, name: 'Yeni Ad' }, actor);
      expect(scoped.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { name: 'Yeni Ad' },
      });
      expect(scoped.doctor.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { name: 'Yeni Ad' },
      });
    });

    it('hiçbir alan değişmediyse update çağırmaz', async () => {
      scoped.user.findFirst.mockResolvedValue(buildUserRow({ name: 'A', locale: 'tr' }));
      await service.update({ id: USER_ID, name: 'A', locale: 'tr' }, actor);
      expect(scoped.user.update).not.toHaveBeenCalled();
    });
  });
});
