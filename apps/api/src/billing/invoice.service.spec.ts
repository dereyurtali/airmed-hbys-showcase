import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { DiscountApprovalService } from './approval/approval.service';
import { RatesService } from './rates.service';
import { InvoiceService } from './invoice.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PATIENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SURGERY_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ACTOR_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('InvoiceService', () => {
  let service: InvoiceService;
  let scoped: {
    invoice: { findFirst: jest.Mock };
    encounter: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    scoped = {
      invoice: { findFirst: jest.fn().mockResolvedValue(null) },
      encounter: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    // #923 — create() fatura numarasını invoice_counters $queryRaw atomik UPSERT ile üretir.
    (scoped as unknown as { $queryRaw: jest.Mock }).$queryRaw = jest
      .fn()
      .mockResolvedValue([{ last_seq: 1 }]);
    const prisma = { scoped } as unknown as PrismaService;
    const tenantContext = {
      requireTenantId: () => TENANT_ID,
    } as unknown as TenantContextService;
    const approvals = {
      isWithinSelfLimit: jest.fn().mockReturnValue(true),
      selfLimitFor: jest.fn().mockReturnValue(100),
      absoluteMaxDiscountPercent: jest.fn().mockResolvedValue(100),
      request: jest.fn(),
    } as unknown as DiscountApprovalService;
    const rates = {
      snapshotRateToTjs: jest.fn(),
      getCurrentRate: jest.fn().mockResolvedValue(null),
    } as unknown as RatesService;

    const moduleRef = await Test.createTestingModule({
      providers: [
        InvoiceService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantContextService, useValue: tenantContext },
        { provide: DiscountApprovalService, useValue: approvals },
        { provide: RatesService, useValue: rates },
      ],
    }).compile();
    service = moduleRef.get(InvoiceService);
  });

  // S12c — "Önce öde, sonra hizmet" kuralının kapı kontrolü.
  describe('assertPaidSession (S12c)', () => {
    it('aktif emergency bypass varsa kontrolü atlar (Break Glass)', async () => {
      scoped.encounter.findFirst.mockResolvedValueOnce({ id: 'enc-1' });
      await expect(service.assertPaidSession(PATIENT_ID, 'examination')).resolves.toBeUndefined();
      // Bypass varken invoice sorgusu yapılmamalı
      expect(scoped.invoice.findFirst).not.toHaveBeenCalled();
    });

    it('bugün paid/partial invoice yoksa ForbiddenException atar', async () => {
      scoped.encounter.findFirst.mockResolvedValueOnce(null);
      scoped.invoice.findFirst.mockResolvedValueOnce(null);
      await expect(service.assertPaidSession(PATIENT_ID, 'examination')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('bugün paid invoice varsa geçer', async () => {
      scoped.encounter.findFirst.mockResolvedValueOnce(null);
      scoped.invoice.findFirst.mockResolvedValueOnce({ id: 'inv-1' });
      await expect(service.assertPaidSession(PATIENT_ID, 'examination')).resolves.toBeUndefined();
    });

    it('invoice sorgusu hastayı, paid/partial status ve aynı gün filtresini koyar', async () => {
      scoped.encounter.findFirst.mockResolvedValueOnce(null);
      scoped.invoice.findFirst.mockResolvedValueOnce({ id: 'inv-1' });
      await service.assertPaidSession(PATIENT_ID, 'measurement');
      const call = scoped.invoice.findFirst.mock.calls[0][0];
      expect(call.where.patientId).toBe(PATIENT_ID);
      expect(call.where.status).toEqual({ in: ['paid', 'partial'] });
      expect(call.where.createdAt.gte).toBeInstanceOf(Date);
      // ServiceItem kategori filtresi geçerli kategoriyle eşlenmiş
      expect(call.where.items.some.serviceItem.category).toBe('measurement');
    });
  });

  // hasPaidSession assertPaidSession'ın boolean varyantı — istisna atmaz.
  describe('hasPaidSession', () => {
    it('paid invoice yoksa false döner (istisna atmaz)', async () => {
      scoped.invoice.findFirst.mockResolvedValueOnce(null);
      await expect(service.hasPaidSession(PATIENT_ID, 'examination')).resolves.toBe(false);
    });

    it('paid invoice varsa true döner', async () => {
      scoped.invoice.findFirst.mockResolvedValueOnce({ id: 'inv-1' });
      await expect(service.hasPaidSession(PATIENT_ID, 'lab')).resolves.toBe(true);
    });
  });

  // S12a — Cerrahi bağlı invoice yalnız SURGERY_BILLING_ROLES tarafından.
  // assertSurgeryBindingAllowed private — `create` üzerinden test ediyoruz.
  describe('assertSurgeryBindingAllowed (S12a — create path)', () => {
    function baseInput(surgeryId?: string) {
      return {
        patientId: PATIENT_ID,
        currency: 'TJS' as const,
        items: [{ description: 'Konsültasyon', quantity: 1, unitPrice: '100' }],
        discount: '0',
        ...(surgeryId ? { surgeryId } : {}),
      };
    }

    beforeEach(() => {
      // Patient existence check — geçsin
      (scoped as unknown as { patient: { findFirst: jest.Mock } }).patient = {
        findFirst: jest.fn().mockResolvedValue({ id: PATIENT_ID }),
      };
      // create + items + findUniqueOrThrow — assertion'a kadar gelmemesi için
      // surgeryId-set akışlarda hata önce atılır; surgeryId-yok akışı için
      // create mock'ları nominal olarak set edilir.
      (
        scoped as unknown as { invoice: { create: jest.Mock; findUniqueOrThrow: jest.Mock } }
      ).invoice.create = jest.fn().mockResolvedValue({ id: 'inv-new' });
      (
        scoped as unknown as { invoice: { findUniqueOrThrow: jest.Mock } }
      ).invoice.findUniqueOrThrow = jest.fn().mockResolvedValue({ id: 'inv-new' });
      (scoped as unknown as { invoiceItem: { createMany: jest.Mock } }).invoiceItem = {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      };
    });

    it('surgeryId yoksa rol kontrolü uygulanmaz (plain fatura herkesçe)', async () => {
      await expect(
        service.create(baseInput(), { id: ACTOR_ID, roles: ['resepsiyon'] }),
      ).resolves.toBeDefined();
    });

    it('surgeryId varsa resepsiyon → ForbiddenException', async () => {
      await expect(
        service.create(baseInput(SURGERY_ID), { id: ACTOR_ID, roles: ['resepsiyon'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('surgeryId varsa ameliyat_satis → geçer', async () => {
      await expect(
        service.create(baseInput(SURGERY_ID), { id: ACTOR_ID, roles: ['ameliyat_satis'] }),
      ).resolves.toBeDefined();
    });

    it('surgeryId varsa yonetici → geçer', async () => {
      await expect(
        service.create(baseInput(SURGERY_ID), { id: ACTOR_ID, roles: ['yonetici'] }),
      ).resolves.toBeDefined();
    });

    it('surgeryId varsa yonetici_asistani → geçer', async () => {
      await expect(
        service.create(baseInput(SURGERY_ID), { id: ACTOR_ID, roles: ['yonetici_asistani'] }),
      ).resolves.toBeDefined();
    });

    it('surgeryId varsa actor.roles undefined → test bypass (geçer)', async () => {
      await expect(service.create(baseInput(SURGERY_ID), { id: ACTOR_ID })).resolves.toBeDefined();
    });
  });

  // computeTotals private — `create` üzerinden discount kuralları test edilir.
  describe('computeTotals (create üzerinden)', () => {
    beforeEach(() => {
      (scoped as unknown as { patient: { findFirst: jest.Mock } }).patient = {
        findFirst: jest.fn().mockResolvedValue({ id: PATIENT_ID }),
      };
      (
        scoped as unknown as { invoice: { create: jest.Mock; findUniqueOrThrow: jest.Mock } }
      ).invoice.create = jest.fn().mockResolvedValue({ id: 'inv-new' });
      (
        scoped as unknown as { invoice: { findUniqueOrThrow: jest.Mock } }
      ).invoice.findUniqueOrThrow = jest.fn().mockResolvedValue({ id: 'inv-new' });
      (scoped as unknown as { invoiceItem: { createMany: jest.Mock } }).invoiceItem = {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      };
    });

    it('negatif iskonto → BadRequest', async () => {
      await expect(
        service.create(
          {
            patientId: PATIENT_ID,
            currency: 'TJS' as const,
            items: [{ description: 'X', quantity: 1, unitPrice: '100' }],
            discount: '-1',
          },
          { id: ACTOR_ID, roles: ['yonetici'] },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('iskonto > subtotal → BadRequest', async () => {
      await expect(
        service.create(
          {
            patientId: PATIENT_ID,
            currency: 'TJS' as const,
            items: [{ description: 'X', quantity: 2, unitPrice: '50' }],
            discount: '101',
          },
          { id: ACTOR_ID, roles: ['yonetici'] },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('mantıklı iskonto geçer (100 * 2 - 25 = 175)', async () => {
      const createSpy = (scoped as unknown as { invoice: { create: jest.Mock } }).invoice.create;
      await service.create(
        {
          patientId: PATIENT_ID,
          currency: 'TJS' as const,
          items: [{ description: 'X', quantity: 2, unitPrice: '100' }],
          discount: '25',
        },
        { id: ACTOR_ID, roles: ['yonetici'] },
      );
      const data = createSpy.mock.calls[0][0].data;
      expect(data.subtotal.toString()).toBe('200');
      expect(data.total.toString()).toBe('175');
    });
  });
});
