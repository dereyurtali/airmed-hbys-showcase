import { Test } from '@nestjs/testing';
import { InvoiceService } from '../billing/invoice.service';
import { EncounterService } from '../encounter/encounter.service';
import { IolService } from '../iol/iol.service';
import { MessagingService } from '../messaging/messaging.service';
import { NotificationService } from '../notification/notification.service';
import { PatientDoctorService } from '../patient/patient-doctor.service';
import { PostOpService } from '../post-op/post-op.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { SurgeryService } from './surgery.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PATIENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DOCTOR_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SURGERY_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('SurgeryService — S15 ameliyat satışa devir', () => {
  let service: SurgeryService;
  let scoped: {
    surgery: { create: jest.Mock };
    patient: { findFirst: jest.Mock };
    doctor: { findFirst: jest.Mock };
    serviceItem: { findFirst: jest.Mock };
    invoiceItem: { findMany: jest.Mock };
    examination: { findFirst: jest.Mock };
  };
  let notifications: { createForRole: jest.Mock };
  let encounter: { findActiveByPatient: jest.Mock; advance: jest.Mock };
  let patientDoctor: {
    assignAuto: jest.Mock;
    isPatientAssignedToDoctorUser: jest.Mock;
  };

  beforeEach(async () => {
    patientDoctor = {
      assignAuto: jest.fn().mockResolvedValue(undefined),
      isPatientAssignedToDoctorUser: jest.fn().mockResolvedValue(true),
    };
    scoped = {
      surgery: { create: jest.fn(async ({ data }) => ({ id: SURGERY_ID, ...data })) },
      patient: { findFirst: jest.fn().mockResolvedValue({ id: PATIENT_ID }) },
      doctor: { findFirst: jest.fn().mockResolvedValue({ id: DOCTOR_ID }) },
      // Madde 5b — precondition kontrolü; mock null = bu cerrahi tipi için
      // katalog item yok, hard block atlanır (mevcut testler scope dışı).
      serviceItem: { findFirst: jest.fn().mockResolvedValue(null) },
      invoiceItem: { findMany: jest.fn().mockResolvedValue([]) },
      // #381 — surgery.create muayene uyarısı (warnings.noExamination) için lookup.
      examination: { findFirst: jest.fn().mockResolvedValue({ id: 'exam-1' }) },
    };
    notifications = { createForRole: jest.fn().mockResolvedValue([]) };
    encounter = {
      findActiveByPatient: jest.fn().mockResolvedValue({ id: 'enc-1', stage: 'in_exam' }),
      advance: jest.fn().mockResolvedValue({}),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SurgeryService,
        { provide: PrismaService, useValue: { scoped } },
        { provide: TenantContextService, useValue: { requireTenantId: () => TENANT_ID } },
        { provide: PostOpService, useValue: {} },
        { provide: MessagingService, useValue: {} },
        { provide: PatientDoctorService, useValue: patientDoctor },
        {
          provide: InvoiceService,
          useValue: { assertPaidSession: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: NotificationService, useValue: notifications },
        { provide: EncounterService, useValue: encounter },
        // Delta audit C-2 — SurgeryService.registerLens IolService.consumeForSurgery
        // çağırıyor; unit test'te no-op mock yeterli.
        {
          provide: IolService,
          useValue: { consumeForSurgery: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();
    service = moduleRef.get(SurgeryService);
  });

  function input(overrides: Record<string, unknown> = {}) {
    return {
      patientId: PATIENT_ID,
      doctorId: DOCTOR_ID,
      type: 'cataract_phaco',
      scheduledAt: '2026-06-10T09:00:00.000Z',
      ...overrides,
    } as never;
  }

  it('planlanan cerrahi → ameliyat_satis rolüne handoff bildirimi + ziyaret awaiting_surgery_sales', async () => {
    await service.create(input());
    expect(notifications.createForRole).toHaveBeenCalledWith(
      'ameliyat_satis',
      expect.objectContaining({ type: 'surgery_handoff' }),
    );
    expect(encounter.advance).toHaveBeenCalledWith({
      id: 'enc-1',
      toStage: 'awaiting_surgery_sales',
    });
  });

  it('aktif ziyaret yoksa bildirim yine atılır, advance çağrılmaz', async () => {
    encounter.findActiveByPatient.mockResolvedValue(null);
    await service.create(input());
    expect(notifications.createForRole).toHaveBeenCalled();
    expect(encounter.advance).not.toHaveBeenCalled();
  });

  it('performed (planned değil) cerrahide handoff atılmaz', async () => {
    await service.create(input({ status: 'performed', performedAt: '2026-06-10T10:00:00.000Z' }));
    expect(notifications.createForRole).not.toHaveBeenCalled();
  });

  describe('Karar 2 — misafir doktor own-patient scope', () => {
    const VISITING = { userId: 'user-visiting', flags: { is_visiting_doctor: true } };

    it('misafir doktor kendi atanmış hastasına ameliyat önerebilir', async () => {
      patientDoctor.isPatientAssignedToDoctorUser.mockResolvedValue(true);
      await expect(service.create(input(), VISITING)).resolves.toBeDefined();
      expect(patientDoctor.isPatientAssignedToDoctorUser).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        userId: 'user-visiting',
        patientId: PATIENT_ID,
      });
    });

    it('misafir doktor atanmamış hastaya ameliyat öneremez → 403', async () => {
      patientDoctor.isPatientAssignedToDoctorUser.mockResolvedValue(false);
      await expect(service.create(input(), VISITING)).rejects.toThrow(
        'Misafir doktor yalnız kendi hastasına',
      );
      // Scope ihlali ödeme kontrolünden önce → assertPaidSession çağrılmamalı.
      expect(scoped.surgery.create).not.toHaveBeenCalled();
    });

    it('yerleşik doktor (flag yok) için scope kontrolü atlanır', async () => {
      await service.create(input(), { userId: 'user-resident' });
      expect(patientDoctor.isPatientAssignedToDoctorUser).not.toHaveBeenCalled();
    });

    it('actor verilmezse (sistem çağrısı) scope kontrolü atlanır', async () => {
      await service.create(input());
      expect(patientDoctor.isPatientAssignedToDoctorUser).not.toHaveBeenCalled();
    });
  });
});
