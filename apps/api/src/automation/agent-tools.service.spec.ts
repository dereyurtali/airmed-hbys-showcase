import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { AppointmentService } from '../appointment/appointment.service';
import { AvailabilityService } from '../appointment/availability.service';
import { DoctorService } from '../doctor/doctor.service';
import { PatientService } from '../patient/patient.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentToolsService, type ToolContext } from './agent-tools.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const CONV_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const PATIENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DOCTOR_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

describe('AgentToolsService', () => {
  let service: AgentToolsService;
  let availability: { freeSlots: jest.Mock };
  let appointments: { create: jest.Mock };
  let patients: { create: jest.Mock };
  let scoped: {
    patient: { findFirst: jest.Mock };
    agentConversation: { update: jest.Mock };
    agentAction: { create: jest.Mock };
  };

  const ctx = (): ToolContext => ({
    tenantId: TENANT_ID,
    conversation: {
      id: CONV_ID,
      channel: 'whatsapp',
      contactPhone: '+992001234567',
      patientId: null,
    },
    trace: [],
    handoff: { requested: false, reason: '' },
  });

  beforeEach(async () => {
    availability = {
      freeSlots: jest.fn().mockResolvedValue({
        doctors: [
          {
            doctorId: DOCTOR_ID,
            name: 'Dr. Test',
            specialty: 'Katarakt',
            slots: ['2027-06-01T04:00:00.000Z'],
          },
        ],
      }),
    };
    appointments = {
      create: jest.fn().mockResolvedValue({ id: 'aaaaaaaa-1111-1111-1111-111111111111' }),
    };
    patients = {
      create: jest.fn().mockResolvedValue({
        id: PATIENT_ID,
        mrn: 'TD26700042',
        firstName: 'Ali',
        lastName: 'Veli',
      }),
    };
    scoped = {
      patient: { findFirst: jest.fn().mockResolvedValue(null) },
      agentConversation: { update: jest.fn().mockResolvedValue({}) },
      agentAction: { create: jest.fn().mockResolvedValue({}) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentToolsService,
        { provide: AvailabilityService, useValue: availability },
        { provide: AppointmentService, useValue: appointments },
        { provide: PatientService, useValue: patients },
        { provide: DoctorService, useValue: { list: jest.fn().mockResolvedValue({ items: [] }) } },
        { provide: PrismaService, useValue: { scoped } },
      ],
    }).compile();
    service = moduleRef.get(AgentToolsService);
  });

  it('musaitlik_sorgula: slotları Duşanbe saatiyle formatlar', async () => {
    const result = await service.execute(ctx(), {
      id: 't1',
      name: 'musaitlik_sorgula',
      input: { dateFrom: '2027-06-01T00:00:00+05:00', dateTo: '2027-06-02T00:00:00+05:00' },
    });
    expect(result.isError).toBeUndefined();
    expect(result.output).toContain('Dr. Test');
    expect(result.output).toContain('01.06.2027 09:00'); // 04:00Z = 09:00 Duşanbe
  });

  it('geçersiz input zod hatası olarak modele döner (exception değil)', async () => {
    const result = await service.execute(ctx(), {
      id: 't1',
      name: 'musaitlik_sorgula',
      input: { dateFrom: 'yarın' },
    });
    expect(result.isError).toBe(true);
    expect(result.output).toContain('Geçersiz tool input');
  });

  // #1051 — doktor tanıtımı: yalnız publicProfile=true doktorda unvan/bio/diller.
  it('doktor_listesi: publicProfile=true doktorda unvan+bio+diller döner', async () => {
    const doctorsList = service['doctors'] as unknown as { list: jest.Mock };
    doctorsList.list.mockResolvedValue({
      items: [
        {
          id: DOCTOR_ID,
          name: 'Dr. Yayında',
          specialty: 'Katarakt',
          type: 'local',
          publicProfile: true,
          title: 'Prof. Dr.',
          bio: { tr: 'Katarakt uzmanı.', ru: '', tg: '' },
          languages: ['Türkçe', 'Rusça'],
        },
      ],
    });
    const result = await service.execute(ctx(), { id: 't1', name: 'doktor_listesi', input: {} });
    expect(result.output).toContain('unvan: Prof. Dr.');
    expect(result.output).toContain('tanıtım: Katarakt uzmanı.');
    expect(result.output).toContain('konuştuğu diller: Türkçe, Rusça');
  });

  it('doktor_listesi: publicProfile=false doktorda tanıtım verisi SIZMAZ', async () => {
    const doctorsList = service['doctors'] as unknown as { list: jest.Mock };
    doctorsList.list.mockResolvedValue({
      items: [
        {
          id: DOCTOR_ID,
          name: 'Dr. Gizli',
          specialty: 'Retina',
          type: 'local',
          publicProfile: false,
          title: 'Doç. Dr.',
          bio: { tr: 'Gizli tanıtım.' },
          languages: ['Almanca'],
        },
      ],
    });
    const result = await service.execute(ctx(), { id: 't1', name: 'doktor_listesi', input: {} });
    expect(result.output).toContain('Dr. Gizli');
    expect(result.output).not.toContain('Doç. Dr.');
    expect(result.output).not.toContain('Gizli tanıtım.');
    expect(result.output).not.toContain('Almanca');
  });

  it('hasta_bul_veya_olustur: telefonla eşleşince mevcut hastayı döner + konuşmaya bağlar', async () => {
    scoped.patient.findFirst.mockResolvedValue({
      id: PATIENT_ID,
      mrn: 'TD26700042',
      firstName: 'Ali',
      lastName: 'Veli',
    });
    const c = ctx();
    const result = await service.execute(c, {
      id: 't1',
      name: 'hasta_bul_veya_olustur',
      input: { firstName: 'Ali', lastName: 'Veli', birthDate: '1990-01-01', gender: 'male' },
    });
    expect(result.output).toContain('Mevcut hasta bulundu');
    expect(result.output).toContain(PATIENT_ID);
    expect(patients.create).not.toHaveBeenCalled();
    expect(scoped.agentConversation.update).toHaveBeenCalledWith({
      where: { id: CONV_ID },
      data: { patientId: PATIENT_ID },
    });
    expect(scoped.agentAction.create.mock.calls[0][0].data.type).toBe('patient_matched');
    expect(c.conversation.patientId).toBe(PATIENT_ID);
  });

  it('hasta_bul_veya_olustur: eşleşme yoksa kanal telefonuyla yeni kayıt açar', async () => {
    const result = await service.execute(ctx(), {
      id: 't1',
      name: 'hasta_bul_veya_olustur',
      input: { firstName: 'Ali', lastName: 'Veli', birthDate: '1990-01-01', gender: 'male' },
    });
    expect(result.output).toContain('Yeni hasta kaydı');
    const input = patients.create.mock.calls[0][0];
    expect(input.phone).toBe('+992001234567');
    expect(input.leadSource).toBe('whatsapp');
    expect(scoped.agentAction.create.mock.calls[0][0].data.type).toBe('patient_created');
  });

  it('randevu_olustur: servis çağrısı + appointment_created aksiyonu', async () => {
    const result = await service.execute(ctx(), {
      id: 't1',
      name: 'randevu_olustur',
      input: {
        patientId: PATIENT_ID,
        doctorId: DOCTOR_ID,
        startsAt: '2027-06-01T09:00:00+05:00',
      },
    });
    expect(result.output).toContain('Randevu oluşturuldu');
    const created = appointments.create.mock.calls[0][0];
    expect(created.patientId).toBe(PATIENT_ID);
    expect(created.source).toBe('whatsapp');
    expect(new Date(created.endsAt).getTime() - new Date(created.startsAt).getTime()).toBe(
      15 * 60 * 1000,
    );
    expect(scoped.agentAction.create.mock.calls[0][0].data.type).toBe('appointment_created');
  });

  it('randevu çakışması (ConflictException) isError olarak modele döner', async () => {
    appointments.create.mockRejectedValue(new ConflictException('Time slot already booked'));
    const result = await service.execute(ctx(), {
      id: 't1',
      name: 'randevu_olustur',
      input: { patientId: PATIENT_ID, doctorId: DOCTOR_ID, startsAt: '2027-06-01T09:00:00+05:00' },
    });
    expect(result.isError).toBe(true);
    expect(result.output).toContain('Time slot already booked');
  });

  it('insana_devret: ctx.handoff set edilir + handoff aksiyonu loglanır', async () => {
    const c = ctx();
    const result = await service.execute(c, {
      id: 't1',
      name: 'insana_devret',
      input: { reason: 'Tıbbi soru' },
    });
    expect(c.handoff).toEqual({ requested: true, reason: 'Tıbbi soru' });
    expect(result.output).toContain('Devir kaydedildi');
    expect(scoped.agentAction.create.mock.calls[0][0].data.type).toBe('handoff');
  });

  it("her çağrı trace'e yazılır", async () => {
    const c = ctx();
    await service.execute(c, { id: 't1', name: 'doktor_listesi', input: {} });
    expect(c.trace).toHaveLength(1);
    expect(c.trace[0].name).toBe('doktor_listesi');
    expect(c.trace[0].isError).toBe(false);
  });
});
