import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InvoiceService } from '../billing/invoice.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { EncounterService } from './encounter.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PATIENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const APPT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ENCOUNTER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const DOCTOR_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const DOCTOR_USER_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

describe('EncounterService', () => {
  let service: EncounterService;
  let scoped: {
    encounter: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    doctor: { findFirst: jest.Mock };
    appointment: { findFirst: jest.Mock; update: jest.Mock };
  };
  let invoice: { hasPaidSession: jest.Mock; assertPaidSession: jest.Mock };

  beforeEach(async () => {
    scoped = {
      encounter: {
        create: jest.fn(async ({ data }) => ({ id: ENCOUNTER_ID, ...data })),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
      },
      doctor: { findFirst: jest.fn().mockResolvedValue({ id: DOCTOR_ID }) },
      appointment: {
        findFirst: jest.fn().mockResolvedValue({ status: 'checked_in', doctorId: DOCTOR_ID }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    invoice = {
      hasPaidSession: jest.fn().mockResolvedValue(false),
      assertPaidSession: jest.fn().mockResolvedValue(undefined),
    };

    const prisma = { scoped } as unknown as PrismaService;
    const tenantContext = {
      requireTenantId: () => TENANT_ID,
    } as unknown as TenantContextService;

    const moduleRef = await Test.createTestingModule({
      providers: [
        EncounterService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantContextService, useValue: tenantContext },
        { provide: InvoiceService, useValue: invoice },
      ],
    }).compile();
    service = moduleRef.get(EncounterService);
  });

  describe('open', () => {
    it('initialStation=examination + muayene ödenmemiş → awaiting_exam_payment', async () => {
      invoice.hasPaidSession.mockResolvedValue(false);
      const result = await service.open({
        patientId: PATIENT_ID,
        appointmentId: APPT_ID,
        initialStation: 'examination',
      });
      expect(result.stage).toBe('awaiting_exam_payment');
      expect(scoped.encounter.create).toHaveBeenCalled();
    });

    it('initialStation=examination + muayene ödenmiş → waiting_doctor', async () => {
      invoice.hasPaidSession.mockResolvedValue(true);
      const result = await service.open({
        patientId: PATIENT_ID,
        appointmentId: APPT_ID,
        initialStation: 'examination',
      });
      expect(result.stage).toBe('waiting_doctor');
    });

    // Madde 6 — initialStation default 'measurement' (walk-in akış).
    it('initialStation default (measurement) + ölçüm ödenmemiş → awaiting_measurement_payment', async () => {
      invoice.hasPaidSession.mockResolvedValue(false);
      const result = await service.open({ patientId: PATIENT_ID });
      expect(result.stage).toBe('awaiting_measurement_payment');
      expect(invoice.hasPaidSession).toHaveBeenCalledWith(PATIENT_ID, 'measurement');
    });

    it('initialStation=measurement explicit + ölçüm ödenmiş → in_measurement', async () => {
      invoice.hasPaidSession.mockResolvedValue(true);
      const result = await service.open({
        patientId: PATIENT_ID,
        initialStation: 'measurement',
      });
      expect(result.stage).toBe('in_measurement');
    });

    it('aynı randevu için açık ziyaret varsa onu döner (idempotent)', async () => {
      scoped.encounter.findFirst.mockResolvedValue({ id: ENCOUNTER_ID, stage: 'waiting_doctor' });
      const result = await service.open({ patientId: PATIENT_ID, appointmentId: APPT_ID });
      expect(result.id).toBe(ENCOUNTER_ID);
      expect(scoped.encounter.create).not.toHaveBeenCalled();
    });
  });

  describe('advance', () => {
    it('yasal geçişte stage günceller', async () => {
      scoped.encounter.findFirst.mockResolvedValue({
        id: ENCOUNTER_ID,
        stage: 'waiting_doctor',
        patientId: PATIENT_ID,
        appointmentId: APPT_ID,
      });
      const result = await service.advance({ id: ENCOUNTER_ID, toStage: 'in_exam' });
      expect(result.stage).toBe('in_exam');
    });

    it('yasadışı geçişte BadRequest atar', async () => {
      scoped.encounter.findFirst.mockResolvedValue({
        id: ENCOUNTER_ID,
        stage: 'registered',
        patientId: PATIENT_ID,
        appointmentId: null,
      });
      await expect(
        service.advance({ id: ENCOUNTER_ID, toStage: 'measurement_ready' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('awaiting_exam_payment → waiting_doctor ödeme kapısını uygular', async () => {
      scoped.encounter.findFirst.mockResolvedValue({
        id: ENCOUNTER_ID,
        stage: 'awaiting_exam_payment',
        patientId: PATIENT_ID,
        appointmentId: null,
      });
      invoice.assertPaidSession.mockRejectedValue(new ForbiddenException('ödenmedi'));
      await expect(
        service.advance({ id: ENCOUNTER_ID, toStage: 'waiting_doctor' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(invoice.assertPaidSession).toHaveBeenCalledWith(PATIENT_ID, 'examination');
    });

    it('in_exam geçişinde bağlı randevuyu in_progress yapar', async () => {
      scoped.encounter.findFirst.mockResolvedValue({
        id: ENCOUNTER_ID,
        stage: 'waiting_doctor',
        patientId: PATIENT_ID,
        appointmentId: APPT_ID,
      });
      await service.advance({ id: ENCOUNTER_ID, toStage: 'in_exam' });
      expect(scoped.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'in_progress' } }),
      );
    });
  });

  describe('startExamByAppointment', () => {
    it('randevuya bağlı ziyaret yoksa NotFound', async () => {
      scoped.encounter.findFirst.mockResolvedValue(null);
      await expect(service.startExamByAppointment(APPT_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('ziyareti bulur ve in_exam asamasina ilerletir', async () => {
      scoped.encounter.findFirst
        .mockResolvedValueOnce({ id: ENCOUNTER_ID }) // startExamByAppointment lookup
        .mockResolvedValueOnce({
          id: ENCOUNTER_ID,
          stage: 'waiting_doctor',
          patientId: PATIENT_ID,
          appointmentId: APPT_ID,
        }); // advance → requireEncounter
      const result = await service.startExamByAppointment(APPT_ID);
      expect(result.stage).toBe('in_exam');
    });
  });

  describe('findMyWorklist', () => {
    it('User.id → Doctor.id çözer ve kuyruğu döner', async () => {
      scoped.encounter.findMany.mockResolvedValue([{ id: ENCOUNTER_ID, stage: 'waiting_doctor' }]);
      const result = await service.findMyWorklist(DOCTOR_USER_ID, {});
      expect(scoped.doctor.findFirst).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });

    it('doktor profili yoksa boş liste döner (hata değil)', async () => {
      scoped.doctor.findFirst.mockResolvedValue(null);
      const result = await service.findMyWorklist(DOCTOR_USER_ID, {});
      expect(result).toEqual([]);
      expect(scoped.encounter.findMany).not.toHaveBeenCalled();
    });

    it('#1152 — acil + VIP hastayı kuyruğun başına alır (acil > VIP > kalan)', async () => {
      scoped.encounter.findMany.mockResolvedValue([
        { id: 'normal', stage: 'waiting_doctor', isUrgent: false, patient: { tags: [] } },
        { id: 'vip', stage: 'waiting_doctor', isUrgent: false, patient: { tags: ['vip'] } },
        { id: 'urgent', stage: 'in_measurement', isUrgent: true, patient: { tags: ['vip'] } },
      ]);
      const result = await service.findMyWorklist(DOCTOR_USER_ID, {});
      expect(result.map((r) => r.id)).toEqual(['urgent', 'vip', 'normal']);
    });
  });
});
