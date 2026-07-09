import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { ClinicalListService } from './clinical-list.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PATIENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('ClinicalListService — R1 kalıcı problem + ilaç listesi', () => {
  let service: ClinicalListService;
  let scoped: {
    patientProblem: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    patientMedication: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    scoped = {
      patientProblem: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'pr-1' }),
        create: jest.fn(async ({ data }) => ({ id: 'pr-1', ...data })),
        update: jest.fn(async ({ data }) => ({ id: 'pr-1', ...data })),
      },
      patientMedication: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'med-1' }),
        create: jest.fn(async ({ data }) => ({ id: 'med-1', ...data })),
        update: jest.fn(async ({ data }) => ({ id: 'med-1', ...data })),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ClinicalListService,
        { provide: PrismaService, useValue: { scoped } },
        { provide: TenantContextService, useValue: { requireTenantId: () => TENANT_ID } },
      ],
    }).compile();
    service = moduleRef.get(ClinicalListService);
  });

  it('createProblem tenant + createdById + onsetDate parse eder', async () => {
    await service.createProblem(
      {
        patientId: PATIENT_ID,
        description: 'Glokom',
        icd10: 'H40',
        onsetDate: '2024-01-01T00:00:00.000Z',
      },
      USER_ID,
    );
    expect(scoped.patientProblem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT_ID,
        patientId: PATIENT_ID,
        description: 'Glokom',
        icd10: 'H40',
        createdById: USER_ID,
        onsetDate: expect.any(Date),
      }),
    });
  });

  it('resolveProblem status=resolved + resolvedAt set eder', async () => {
    await service.resolveProblem('pr-1');
    expect(scoped.patientProblem.update).toHaveBeenCalledWith({
      where: { id: 'pr-1' },
      data: expect.objectContaining({ status: 'resolved', resolvedAt: expect.any(Date) }),
    });
  });

  it('resolveProblem kayıt yoksa 404', async () => {
    scoped.patientProblem.findFirst.mockResolvedValue(null);
    await expect(service.resolveProblem('yok')).rejects.toBeInstanceOf(NotFoundException);
    expect(scoped.patientProblem.update).not.toHaveBeenCalled();
  });

  it('createMedication tenant + createdById set eder', async () => {
    await service.createMedication(
      { patientId: PATIENT_ID, name: 'Latanoprost', dose: '1 damla', frequency: 'gece' },
      USER_ID,
    );
    expect(scoped.patientMedication.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT_ID,
        patientId: PATIENT_ID,
        name: 'Latanoprost',
        dose: '1 damla',
        frequency: 'gece',
        createdById: USER_ID,
      }),
    });
  });

  it('stopMedication status=stopped + stoppedAt set eder', async () => {
    await service.stopMedication('med-1');
    expect(scoped.patientMedication.update).toHaveBeenCalledWith({
      where: { id: 'med-1' },
      data: expect.objectContaining({ status: 'stopped', stoppedAt: expect.any(Date) }),
    });
  });

  it('deleteProblem soft-delete (deletedAt set)', async () => {
    await service.deleteProblem('pr-1');
    expect(scoped.patientProblem.update).toHaveBeenCalledWith({
      where: { id: 'pr-1' },
      data: { deletedAt: expect.any(Date) },
    });
  });
});
