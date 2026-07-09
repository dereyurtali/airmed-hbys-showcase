import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantContextService } from '../tenant/tenant-context.service';
import type { StorageService } from '../storage/storage.service';
import { DoctorService } from './doctor.service';

// #1047 — VisitingWindow CRUD + Doctor.type ↔ flags.is_visiting_doctor senkronu.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const DOCTOR_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const USER_ID = 'uuuuuuuu-uuuu-uuuu-uuuu-uuuuuuuuuuuu';
const WINDOW_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

interface ScopedMock {
  doctor: {
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  user: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  visitingWindow: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };
}

function makeService(overrides?: {
  doctor?: Partial<Record<'type' | 'userId', unknown>>;
  windowOverlap?: boolean;
}) {
  const scoped: ScopedMock = {
    doctor: {
      findFirst: jest.fn().mockResolvedValue({
        id: DOCTOR_ID,
        userId: USER_ID,
        type: 'local',
        availabilities: [],
        user: { flags: null },
        ...overrides?.doctor,
      }),
      update: jest.fn().mockResolvedValue({ id: DOCTOR_ID }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ flags: null }),
      update: jest.fn().mockResolvedValue({ id: USER_ID }),
    },
    visitingWindow: {
      findFirst: jest.fn().mockResolvedValue(overrides?.windowOverlap ? { id: WINDOW_ID } : null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest
        .fn()
        .mockImplementation((args: { data: unknown }) =>
          Promise.resolve({ id: WINDOW_ID, ...(args.data as object) }),
        ),
      delete: jest.fn().mockResolvedValue({ id: WINDOW_ID }),
    },
  };
  const prisma = { scoped } as unknown as PrismaService;
  const tenantContext = {
    requireTenantId: jest.fn().mockReturnValue(TENANT_ID),
  } as unknown as TenantContextService;
  const storage = {
    buildScopedKey: jest.fn().mockReturnValue('t/doctors/d/x.png'),
    saveBuffer: jest.fn().mockResolvedValue(undefined),
    readStream: jest.fn(),
    exists: jest.fn().mockResolvedValue(true),
    remove: jest.fn().mockResolvedValue(undefined),
  } as unknown as StorageService;
  return { service: new DoctorService(prisma, tenantContext, storage), scoped, storage };
}

const iso = (s: string) => new Date(s).toISOString();

describe('DoctorService — VisitingWindow CRUD (#1047)', () => {
  it('addVisitingWindow: pencere oluşturur (tenant + tarih alanları doğru)', async () => {
    const { service, scoped } = makeService();
    await service.addVisitingWindow({
      doctorId: DOCTOR_ID,
      startsAt: iso('2027-06-01T00:00:00Z'),
      endsAt: iso('2027-06-08T00:00:00Z'),
      notes: 'Haziran ziyareti',
    });
    expect(scoped.visitingWindow.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT_ID,
        doctorId: DOCTOR_ID,
        notes: 'Haziran ziyareti',
      }),
    });
  });

  it('addVisitingWindow: örtüşen pencere reddedilir (400)', async () => {
    const { service, scoped } = makeService({ windowOverlap: true });
    await expect(
      service.addVisitingWindow({
        doctorId: DOCTOR_ID,
        startsAt: iso('2027-06-01T00:00:00Z'),
        endsAt: iso('2027-06-08T00:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(scoped.visitingWindow.create).not.toHaveBeenCalled();
  });

  it('listVisitingWindows: aktif+gelecek pencereler (endsAt > from)', async () => {
    const { service, scoped } = makeService();
    await service.listVisitingWindows({ doctorId: DOCTOR_ID, from: iso('2027-06-01T00:00:00Z') });
    expect(scoped.visitingWindow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { doctorId: DOCTOR_ID, endsAt: { gt: new Date('2027-06-01T00:00:00Z') } },
        orderBy: { startsAt: 'asc' },
      }),
    );
  });

  it('findVisitingWindowsInRange: overlap sorgusu + doktor adı içerir', async () => {
    const { service, scoped } = makeService();
    await service.findVisitingWindowsInRange({
      dateFrom: iso('2027-06-01T00:00:00Z'),
      dateTo: iso('2027-07-01T00:00:00Z'),
    });
    expect(scoped.visitingWindow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          startsAt: { lt: new Date('2027-07-01T00:00:00Z') },
          endsAt: { gt: new Date('2027-06-01T00:00:00Z') },
        },
        include: { doctor: { select: { id: true, name: true } } },
      }),
    );
  });

  it('deleteVisitingWindow: yoksa NotFoundException', async () => {
    const { service, scoped } = makeService();
    scoped.visitingWindow.findFirst.mockResolvedValue(null);
    await expect(service.deleteVisitingWindow(WINDOW_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(scoped.visitingWindow.delete).not.toHaveBeenCalled();
  });
});

describe('DoctorService — findById linkli user iletişimi (#1149)', () => {
  // Hesaplı doktorda kimlik/iletişim tek kaynağı hesap. Klinik ekran ad/telefon/
  // e-posta/durum'u user'dan readonly gösterir → select bu alanları düşürmemeli.
  it('findById: user select ad/telefon/e-posta/durum + flags içerir', async () => {
    const { service, scoped } = makeService();
    await service.findById(DOCTOR_ID);
    expect(scoped.doctor.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          user: {
            select: { flags: true, name: true, phone: true, email: true, status: true },
          },
        }),
      }),
    );
  });

  it('findById: doktor yoksa NotFoundException', async () => {
    const { service, scoped } = makeService();
    scoped.doctor.findFirst.mockResolvedValue(null);
    await expect(service.findById(DOCTOR_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DoctorService — Doctor.type ↔ is_visiting_doctor senkronu (#1047)', () => {
  it('updateFlags(is_visiting_doctor=true): user flag + Doctor.type=visiting', async () => {
    const { service, scoped } = makeService({ doctor: { type: 'local' } });
    await service.updateDoctorUserFlags(DOCTOR_ID, { is_visiting_doctor: true });
    expect(scoped.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { flags: expect.objectContaining({ is_visiting_doctor: true }) },
      }),
    );
    expect(scoped.doctor.update).toHaveBeenCalledWith({
      where: { id: DOCTOR_ID },
      data: { type: 'visiting' },
    });
  });

  it('updateFlags(is_visiting_doctor=false): visiting → local indirilir', async () => {
    const { service, scoped } = makeService({ doctor: { type: 'visiting' } });
    await service.updateDoctorUserFlags(DOCTOR_ID, { is_visiting_doctor: false });
    expect(scoped.doctor.update).toHaveBeenCalledWith({
      where: { id: DOCTOR_ID },
      data: { type: 'local' },
    });
  });

  it('updateFlags(is_visiting_doctor=false): referral tipe DOKUNMAZ', async () => {
    const { service, scoped } = makeService({ doctor: { type: 'referral' } });
    await service.updateDoctorUserFlags(DOCTOR_ID, { is_visiting_doctor: false });
    expect(scoped.doctor.update).not.toHaveBeenCalled();
  });

  it('updateFlags(can_see_all_patients): tip senkronu tetiklenmez', async () => {
    const { service, scoped } = makeService({ doctor: { type: 'local' } });
    await service.updateDoctorUserFlags(DOCTOR_ID, { can_see_all_patients: true });
    expect(scoped.doctor.update).not.toHaveBeenCalled();
  });

  it('update(type=visiting): user.flags.is_visiting_doctor senkronlanır', async () => {
    const { service, scoped } = makeService({ doctor: { type: 'local' } });
    await service.update(DOCTOR_ID, { type: 'visiting' });
    expect(scoped.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_ID },
        data: { flags: expect.objectContaining({ is_visiting_doctor: true }) },
      }),
    );
  });

  it('update(type=local): flag silinir; userId yoksa senkron atlanır', async () => {
    const { service, scoped } = makeService({ doctor: { type: 'visiting', userId: null } });
    await service.update(DOCTOR_ID, { type: 'local' });
    expect(scoped.user.update).not.toHaveBeenCalled();
  });
});
