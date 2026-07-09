import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { PatientDoctorService } from './patient-doctor.service';
import { PatientService } from './patient.service';
import { parseMrn } from './verhoeff';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PATIENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('PatientService', () => {
  let service: PatientService;
  let scoped: {
    patient: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    tenant: {
      findUniqueOrThrow: jest.Mock;
    };
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    scoped = {
      patient: {
        create: jest.fn(async ({ data }) => ({ id: PATIENT_ID, ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: PATIENT_ID, deletedAt: null, phone: '+9921234' }),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(async ({ data }) => ({ id: PATIENT_ID, ...data })),
      },
      // S13 — nextMrn() tenant.mrn_prefix okur ve mrn_counters'a UPSERT atar
      tenant: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ mrnPrefix: 'TD', timezone: 'Asia/Dushanbe' }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ last_seq: 1 }]),
    };
    const prisma = { scoped } as unknown as PrismaService;
    const tenantContext = {
      requireTenantId: () => TENANT_ID,
      getTenantId: () => TENANT_ID,
    } as unknown as TenantContextService;

    const patientDoctor = {
      assignAuto: jest.fn().mockResolvedValue(undefined),
      assignManual: jest.fn().mockResolvedValue(undefined),
      patientIdsForDoctorUser: jest.fn().mockResolvedValue([]),
    } as unknown as PatientDoctorService;

    const moduleRef = await Test.createTestingModule({
      providers: [
        PatientService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantContextService, useValue: tenantContext },
        { provide: PatientDoctorService, useValue: patientDoctor },
      ],
    }).compile();
    service = moduleRef.get(PatientService);
  });

  function baseInput(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      firstName: 'Ali',
      lastName: 'Veli',
      birthDate: '1980-01-01',
      gender: 'male' as const,
      phone: '+992111111111',
      ...overrides,
    };
  }

  it('S13 — generates new-format MRN: <prefix(2)><yy(2)><check(1)><seq(5)>', async () => {
    scoped.patient.findMany.mockResolvedValueOnce([]); // duplicate phone empty
    scoped.patient.findMany.mockResolvedValueOnce([]); // duplicate name+dob empty
    const result = await service.create(baseInput());
    expect(result.mrn).toMatch(/^TD\d{8}$/);
    const parsed = parseMrn(result.mrn);
    expect(parsed).not.toBeNull();
    expect(parsed?.valid).toBe(true);
    expect(parsed?.prefix).toBe('TD');
    expect(parsed?.seq).toBe(1);
  });

  it('S13 — boş mrn_prefix → 400 (klinik onboarding eksik)', async () => {
    scoped.tenant.findUniqueOrThrow.mockResolvedValueOnce({
      mrnPrefix: '',
      timezone: 'Asia/Dushanbe',
    });
    scoped.patient.findMany.mockResolvedValueOnce([]);
    scoped.patient.findMany.mockResolvedValueOnce([]);
    await expect(service.create(baseInput())).rejects.toThrow(/MRN ön eki tanımlı değil/);
  });

  it('derives phoneLast4 from the trailing 4 digits of phone', async () => {
    scoped.patient.findMany.mockResolvedValue([]);
    const result = await service.create(baseInput({ phone: '+992-111 222 3344' }));
    expect(result.phoneLast4).toBe('3344');
  });

  it('throws ConflictException when a phone duplicate exists and force is false', async () => {
    scoped.patient.findMany.mockResolvedValueOnce([{ id: 'existing-id' }]); // phone match
    scoped.patient.findMany.mockResolvedValueOnce([]);
    await expect(service.create(baseInput())).rejects.toBeInstanceOf(ConflictException);
  });

  it('skips the duplicate check when force=true', async () => {
    scoped.patient.findMany.mockResolvedValue([{ id: 'existing-id' }]);
    await expect(service.create(baseInput(), true)).resolves.toMatchObject({
      mrn: expect.any(String),
    });
  });

  it('recomputes phoneLast4 when update changes phone', async () => {
    await service.update(PATIENT_ID, { phone: '+1 555 0000 9876' });
    expect(scoped.patient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phoneLast4: '9876' }),
      }),
    );
  });

  it('softDelete sets deletedAt and not a hard delete', async () => {
    await service.softDelete(PATIENT_ID);
    expect(scoped.patient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { deletedAt: expect.any(Date) },
      }),
    );
  });

  it('throws NotFoundException when findById misses', async () => {
    scoped.patient.findFirst.mockResolvedValueOnce(null);
    await expect(service.findById(PATIENT_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list builds an OR filter across firstName/lastName/phoneLast4/mrn for search', async () => {
    scoped.patient.findMany.mockResolvedValueOnce([]);
    scoped.patient.count.mockResolvedValueOnce(0);
    await service.list({ search: 'ali', page: 1, pageSize: 50 });
    const call = scoped.patient.findMany.mock.calls[0][0];
    expect(call.where.OR).toEqual([
      { firstName: { contains: 'ali', mode: 'insensitive' } },
      { lastName: { contains: 'ali', mode: 'insensitive' } },
      { phoneLast4: { contains: 'ali' } },
      { mrn: { contains: 'ali' } },
    ]);
  });

  // S15 — Asistan hemşire: aktif session (actingDoctorUserId) ile hasta scope'u
  // asiste edilen doktorun User.id'sine göre yapılır; session yoksa scope yok.
  describe('asistan hemşire acting-doctor scope', () => {
    function patientDoctorMock(): jest.Mock {
      return (service as unknown as { patientDoctor: PatientDoctorService }).patientDoctor
        .patientIdsForDoctorUser as jest.Mock;
    }

    it('list: actingDoctorUserId set ise scope asiste edilen doktora (hemşireye değil)', async () => {
      patientDoctorMock().mockResolvedValueOnce(['p-scoped']);
      scoped.patient.findMany.mockResolvedValueOnce([{ id: 'p-scoped' }]);
      scoped.patient.count.mockResolvedValueOnce(1);
      await service.list(
        { page: 1, pageSize: 50 },
        { userId: 'nurse-1', roles: ['hemsire'], actingDoctorUserId: 'doc-9' },
      );
      expect(patientDoctorMock()).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'doc-9' }),
      );
      const call = scoped.patient.findMany.mock.calls[0][0];
      expect(call.where.id).toEqual({ in: ['p-scoped'] });
    });

    it('list: hemşire + session yok → scope uygulanmaz (tüm hastalar)', async () => {
      scoped.patient.findMany.mockResolvedValueOnce([]);
      scoped.patient.count.mockResolvedValueOnce(0);
      await service.list({ page: 1, pageSize: 50 }, { userId: 'nurse-1', roles: ['hemsire'] });
      expect(patientDoctorMock()).not.toHaveBeenCalled();
      const call = scoped.patient.findMany.mock.calls[0][0];
      expect(call.where.id).toBeUndefined();
    });

    it('findById: asiste edilen doktora atanmamış hasta → NotFound (sızıntı yok)', async () => {
      patientDoctorMock().mockResolvedValueOnce(['other-patient']);
      await expect(
        service.findById(PATIENT_ID, {
          userId: 'nurse-1',
          roles: ['hemsire'],
          actingDoctorUserId: 'doc-9',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(patientDoctorMock()).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'doc-9' }),
      );
    });
  });
});
