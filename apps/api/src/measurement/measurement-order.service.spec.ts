import { Test } from '@nestjs/testing';
import { InvoiceService } from '../billing/invoice.service';
import { EncounterService } from '../encounter/encounter.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { SyncGateway } from '../sync/sync.gateway';
import { TenantContextService } from '../tenant/tenant-context.service';
import { MeasurementService } from './measurement.service';
import { MeasurementOrderService } from './measurement-order.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PATIENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ENCOUNTER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ORDER_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const DOCTOR_USER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const SERVICE_ITEM = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

describe('MeasurementOrderService', () => {
  let service: MeasurementOrderService;
  let scoped: {
    measurementOrder: { create: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
    measurement: { update: jest.Mock };
    doctor: { findFirst: jest.Mock };
    user: { findMany: jest.Mock };
    patient: { findFirst: jest.Mock };
  };
  let measurements: { create: jest.Mock };
  let notifications: { create: jest.Mock; createForRole: jest.Mock };
  let invoice: { assertPaidSession: jest.Mock };
  let encounters: { advance: jest.Mock };

  beforeEach(async () => {
    scoped = {
      measurementOrder: {
        create: jest.fn(async ({ data }) => ({ id: ORDER_ID, ...data })),
        findFirst: jest.fn(),
        update: jest.fn(async ({ data }) => ({ id: ORDER_ID, ...data })),
      },
      measurement: { update: jest.fn().mockResolvedValue({}) },
      doctor: { findFirst: jest.fn().mockResolvedValue({ id: 'doc-1' }) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]) },
      patient: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    measurements = { create: jest.fn(async () => ({ id: 'meas-1' })) };
    notifications = { create: jest.fn(), createForRole: jest.fn() };
    invoice = { assertPaidSession: jest.fn().mockResolvedValue(undefined) };
    encounters = { advance: jest.fn().mockResolvedValue({}) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MeasurementOrderService,
        { provide: PrismaService, useValue: { scoped } },
        { provide: TenantContextService, useValue: { requireTenantId: () => TENANT_ID } },
        { provide: MeasurementService, useValue: measurements },
        { provide: NotificationService, useValue: notifications },
        { provide: InvoiceService, useValue: invoice },
        { provide: EncounterService, useValue: encounters },
        // S15-PR12 — SyncGateway mock (broadcast no-op'lar)
        {
          provide: SyncGateway,
          useValue: {
            broadcastMeasurementReady: jest.fn(),
            broadcastMeasurementOrdered: jest.fn(),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(MeasurementOrderService);
  });

  const actor = { id: DOCTOR_USER, roles: ['doktor'] };

  describe('createOrder', () => {
    it('ücretli (serviceItemIds dolu) → awaiting_payment + kasaya yönlendirme + resepsiyon bildirimi', async () => {
      const order = await service.createOrder(
        {
          encounterId: ENCOUNTER_ID,
          patientId: PATIENT_ID,
          requestedTypes: ['biometry'],
          serviceItemIds: [SERVICE_ITEM],
          notes: null,
        },
        actor,
      );
      expect(order.status).toBe('awaiting_payment');
      expect(order.requiresPayment).toBe(true);
      expect(encounters.advance).toHaveBeenCalledWith({
        id: ENCOUNTER_ID,
        toStage: 'awaiting_measurement_payment',
      });
      expect(notifications.createForRole).toHaveBeenCalledWith(
        'resepsiyon',
        expect.objectContaining({ type: 'measurement_payment_due' }),
      );
    });

    it('ücretsiz → requested + ölçüm odasına + hemşire bildirimi', async () => {
      const order = await service.createOrder(
        {
          encounterId: ENCOUNTER_ID,
          patientId: PATIENT_ID,
          requestedTypes: ['visual_acuity'],
          serviceItemIds: [],
          notes: null,
        },
        actor,
      );
      expect(order.status).toBe('requested');
      expect(encounters.advance).toHaveBeenCalledWith({
        id: ENCOUNTER_ID,
        toStage: 'in_measurement',
      });
      expect(notifications.createForRole).toHaveBeenCalledWith(
        'hemsire',
        expect.objectContaining({ type: 'measurement_ordered' }),
      );
      // #363 — kilitli istasyondaki olcum_hemsiresi de bildirilir.
      expect(notifications.createForRole).toHaveBeenCalledWith(
        'olcum_hemsiresi',
        expect.objectContaining({ type: 'measurement_ordered' }),
      );
    });
  });

  describe('fulfill', () => {
    it('ölçüm yaratır, fulfilled yapar, doktora bildirim, encounter measurement_ready', async () => {
      scoped.measurementOrder.findFirst.mockResolvedValue({
        id: ORDER_ID,
        patientId: PATIENT_ID,
        orderedById: DOCTOR_USER,
        encounterId: ENCOUNTER_ID,
        requiresPayment: false,
      });
      const updated = await service.fulfill(
        {
          orderId: ORDER_ID,
          measurements: [{ type: 'biometry', eyeSide: 'ou', values: {}, notes: null }],
        },
        { id: 'nurse-1', roles: ['hemsire'] },
      );
      // #1063 — order bağı create opts'unda; kayıt başına ikinci UPDATE yok.
      expect(measurements.create).toHaveBeenCalledWith(
        expect.objectContaining({ patientId: PATIENT_ID }),
        expect.anything(),
        { measurementOrderId: ORDER_ID },
      );
      expect(scoped.measurement.update).not.toHaveBeenCalled();
      expect(updated.status).toBe('fulfilled');
      expect(encounters.advance).toHaveBeenCalledWith({
        id: ENCOUNTER_ID,
        toStage: 'measurement_ready',
      });
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ recipientUserId: DOCTOR_USER, type: 'measurement_ready' }),
      );
    });

    it('ücretli sipariş fulfill ederken ödeme kapısı kontrol edilir', async () => {
      scoped.measurementOrder.findFirst.mockResolvedValue({
        id: ORDER_ID,
        patientId: PATIENT_ID,
        orderedById: DOCTOR_USER,
        encounterId: null,
        requiresPayment: true,
      });
      await service.fulfill(
        {
          orderId: ORDER_ID,
          measurements: [{ type: 'biometry', eyeSide: 'ou', values: {}, notes: null }],
        },
        { id: 'nurse-1', roles: ['hemsire'] },
      );
      expect(invoice.assertPaidSession).toHaveBeenCalledWith(PATIENT_ID, 'measurement');
    });
  });

  describe('R2 (#724) — ertele/geri al + resepsiyona bildir', () => {
    it('defer: aktif talebi deferred yapar + sebebi nota ekler', async () => {
      scoped.measurementOrder.findFirst.mockResolvedValue({
        id: ORDER_ID,
        status: 'requested',
        notes: null,
      });
      await service.defer({ orderId: ORDER_ID, reason: 'Hasta gelmedi' });
      expect(scoped.measurementOrder.update).toHaveBeenCalledWith({
        where: { id: ORDER_ID },
        data: expect.objectContaining({
          status: 'deferred',
          notes: expect.stringContaining('Hasta gelmedi'),
        }),
      });
    });

    it('defer: aktif olmayan talep ertelenemez', async () => {
      scoped.measurementOrder.findFirst.mockResolvedValue({ id: ORDER_ID, status: 'fulfilled' });
      await expect(service.defer({ orderId: ORDER_ID, reason: 'sebep' })).rejects.toThrow();
      expect(scoped.measurementOrder.update).not.toHaveBeenCalled();
    });

    it('resume: deferred talebi requested yapar (ücretsiz)', async () => {
      scoped.measurementOrder.findFirst.mockResolvedValue({
        id: ORDER_ID,
        status: 'deferred',
        requiresPayment: false,
      });
      await service.resume(ORDER_ID);
      expect(scoped.measurementOrder.update).toHaveBeenCalledWith({
        where: { id: ORDER_ID },
        data: { status: 'requested' },
      });
    });

    it('resume: ücretli deferred talebi awaiting_payment yapar', async () => {
      scoped.measurementOrder.findFirst.mockResolvedValue({
        id: ORDER_ID,
        status: 'deferred',
        requiresPayment: true,
      });
      await service.resume(ORDER_ID);
      expect(scoped.measurementOrder.update).toHaveBeenCalledWith({
        where: { id: ORDER_ID },
        data: { status: 'awaiting_payment' },
      });
    });

    it('notifyReceptionForPayment: ödeme-bekleyen talepte resepsiyona bildirim', async () => {
      scoped.measurementOrder.findFirst.mockResolvedValue({
        id: ORDER_ID,
        status: 'awaiting_payment',
        patientId: PATIENT_ID,
      });
      scoped.patient.findFirst.mockResolvedValue({ firstName: 'Ali', lastName: 'V', mrn: 'M1' });
      await service.notifyReceptionForPayment(ORDER_ID);
      expect(notifications.createForRole).toHaveBeenCalledWith(
        'resepsiyon',
        expect.objectContaining({ type: 'measurement_payment_due' }),
      );
    });
  });
});
