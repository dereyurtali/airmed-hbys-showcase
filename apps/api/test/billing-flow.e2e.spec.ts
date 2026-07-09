import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import { Prisma } from '@prisma/client';
import { ConfigModule } from '@nestjs/config';
import { ClsModule, ClsService } from 'nestjs-cls';
import { BillingModule } from '../src/billing/billing.module';
import { InvoiceService } from '../src/billing/invoice.service';
import { PaymentService } from '../src/billing/payment.service';
import { RefundService } from '../src/billing/refund.service';
import { CashRegisterService } from '../src/billing/cash-register.service';
import { ServiceItemService } from '../src/billing/service-item.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextService } from '../src/tenant/tenant-context.service';
import { TenantModule } from '../src/tenant/tenant.module';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';

// S11b — Billing service'leri entegrasyon testi (uçtan uca akış).
// Bu test NestJS DI ile service'leri yükler, RLS tenant context'i manuel set eder.
//
// Kapsanan senaryolar:
//   1. ServiceItem CRUD (katalog yönetimi)
//   2. Invoice oluştur (kalemli) + total hesaplama
//   3. Tam ödeme → status 'paid'
//   4. Kısmi ödeme → status 'partial'
//   5. USD/TJS çoklu döviz (kur kaydı + tjsEquivalent)
//   6. Refund (kısmi + tam) → status 'partial'/'refunded'
//   7. CashRegister snapshot + close → Z-raporu
//   8. Overpayment red (open balance > attempted)

describe('S11b — Billing flow (Invoice + Payment + Refund + CashRegister)', () => {
  let app: INestApplication;
  let admin: PrismaClient;
  let fixtures: IsolationFixtures;

  let invoiceService: InvoiceService;
  let paymentService: PaymentService;
  let refundService: RefundService;
  let cashRegisterService: CashRegisterService;
  let serviceItemService: ServiceItemService;
  let tenantContext: TenantContextService;
  let prismaService: PrismaService;
  let cls: ClsService;

  const actorId = '11111111-aaaa-bbbb-cccc-ee00000000aa'; // demo user
  const adminActorId = '11111111-aaaa-bbbb-cccc-ee00000000ab';

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

    // Test actor user'larını yarat (FK için)
    await admin.user.upsert({
      where: { id: actorId },
      update: {},
      create: {
        id: actorId,
        tenantId: fixtures.tenantA.id,
        email: 'billing-actor@a.tj',
        passwordHash: 'x',
        name: 'Billing Actor',
        status: 'active',
      },
    });
    await admin.user.upsert({
      where: { id: adminActorId },
      update: {},
      create: {
        id: adminActorId,
        tenantId: fixtures.tenantA.id,
        email: 'billing-admin@a.tj',
        passwordHash: 'x',
        name: 'Billing Admin',
        status: 'active',
      },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        // BillingModule → NotificationModule → SyncModule → SyncService(ConfigService).
        // Tam app'te ConfigModule global; elle-compose'da açıkça import edilmeli yoksa
        // SyncService ConfigService'i çözemez (messaging/sync-worker e2e ile aynı pattern).
        ConfigModule.forRoot({ isGlobal: true }),
        ClsModule.forRoot({ global: true, middleware: { mount: true } }),
        TenantModule,
        PrismaModule,
        BillingModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    invoiceService = moduleRef.get(InvoiceService);
    paymentService = moduleRef.get(PaymentService);
    refundService = moduleRef.get(RefundService);
    cashRegisterService = moduleRef.get(CashRegisterService);
    serviceItemService = moduleRef.get(ServiceItemService);
    tenantContext = moduleRef.get(TenantContextService);
    prismaService = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
  });

  afterAll(async () => {
    // Cleanup billing rows (FK order: refund → payment → invoiceItem → invoice → serviceItem)
    await admin.refund.deleteMany({});
    await admin.payment.deleteMany({});
    await admin.cashRegisterClosure.deleteMany({});
    await admin.invoiceItem.deleteMany({});
    await admin.invoice.deleteMany({});
    await admin.serviceItem.deleteMany({});
    await admin.user.deleteMany({ where: { id: { in: [actorId, adminActorId] } } });
    await app.close();
    await admin.$disconnect();
  });

  /**
   * Helper: tenant A scope'unda transaction içinde service çağrısı yap.
   * (Normal interceptor'ı manuel taklit ediyoruz; CLS context + tenant id +
   * scoped tx manuel set.)
   */
  const withTenant = async <T>(fn: () => Promise<T>): Promise<T> => {
    return cls.run(() =>
      prismaService.runWithTenant(fixtures.tenantA.id, async (tx) => {
        tenantContext.setTenantId(fixtures.tenantA.id);
        tenantContext.setTransaction(tx);
        return fn();
      }),
    );
  };

  describe('ServiceItem CRUD', () => {
    let examItemId: string;

    it('admin creates examination service item', async () => {
      const item = await withTenant(() =>
        serviceItemService.create(
          {
            code: 'EXAM_BASIC',
            name: 'Muayene',
            category: 'examination',
            defaultPrice: '200.00',
            defaultCurrency: 'TJS',
            sortOrder: 1,
          },
          { id: adminActorId },
        ),
      );
      expect(item.code).toBe('EXAM_BASIC');
      expect(item.defaultPrice.toString()).toBe('200');
      examItemId = item.id;
    });

    it('duplicate code → conflict', async () => {
      await expect(
        withTenant(() =>
          serviceItemService.create(
            {
              code: 'EXAM_BASIC',
              name: 'Muayene 2',
              category: 'examination',
              defaultPrice: '300.00',
              defaultCurrency: 'TJS',
              sortOrder: 1,
            },
            { id: adminActorId },
          ),
        ),
      ).rejects.toThrow(/already exists/);
    });

    it('list returns active items ordered', async () => {
      const list = await withTenant(() => serviceItemService.list({ includeInactive: false }));
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.find((i) => i.id === examItemId)).toBeDefined();
    });

    it('soft delete sets isActive=false', async () => {
      await withTenant(() => serviceItemService.softDelete(examItemId));
      const list = await withTenant(() => serviceItemService.list({ includeInactive: false }));
      expect(list.find((i) => i.id === examItemId)).toBeUndefined();
    });

    // Ücretsiz hizmet (örn. paket içi postop kontrol) defaultPrice=0 ile kaydedilebilir.
    it('defaultPrice=0 ücretsiz hizmet için kabul edilir', async () => {
      const item = await withTenant(() =>
        serviceItemService.create(
          {
            code: 'POSTOP_FREE',
            name: 'Postop Kontrol (paket içi)',
            category: 'examination',
            defaultPrice: '0',
            defaultCurrency: 'TJS',
            sortOrder: 99,
          },
          { id: adminActorId },
        ),
      );
      expect(item.code).toBe('POSTOP_FREE');
      expect(item.defaultPrice.toString()).toBe('0');
    });

    it('negatif defaultPrice → BadRequest (cannot be negative)', async () => {
      await expect(
        withTenant(() =>
          serviceItemService.create(
            {
              code: 'BAD_NEGATIVE',
              name: 'Negatif',
              category: 'examination',
              defaultPrice: '-1',
              defaultCurrency: 'TJS',
              sortOrder: 100,
            },
            { id: adminActorId },
          ),
        ),
      ).rejects.toThrow(/cannot be negative/);
    });
  });

  describe('Invoice + Payment flow (TJS)', () => {
    let invoiceId: string;

    it('creates invoice with 2 items → total = 5800 TJS', async () => {
      const invoice = await withTenant(() =>
        invoiceService.create(
          {
            patientId: fixtures.tenantA.patientId,
            currency: 'TJS',
            discount: '0',
            items: [
              { description: 'Katarakt ameliyatı', quantity: 1, unitPrice: '5000.00' },
              { description: 'IOL lens primi', quantity: 1, unitPrice: '800.00' },
            ],
          },
          { id: actorId },
        ),
      );
      expect(invoice.subtotal.toString()).toBe('5800');
      expect(invoice.total.toString()).toBe('5800');
      expect(invoice.status).toBe('open');
      expect(invoice.invoiceNumber).toMatch(/^\d{4}-\d{4}$/);
      expect(invoice.items.length).toBe(2);
      invoiceId = invoice.id;
    });

    it('partial payment 2000 TJS → status partial', async () => {
      const payment = await withTenant(() =>
        paymentService.create(
          {
            invoiceId,
            amount: '2000.00',
            currency: 'TJS',
            method: 'cash',
          },
          { id: actorId },
        ),
      );
      expect(payment.tjsEquivalent.toString()).toBe('2000');
      const invoice = await withTenant(() => invoiceService.findById(invoiceId));
      expect(invoice.status).toBe('partial');
    });

    it('USD payment with exchangeRate → tjsEquivalent computed', async () => {
      // 200 USD * 11 = 2200 TJS karşılığı (invoice TJS olduğu için)
      const payment = await withTenant(() =>
        paymentService.create(
          {
            invoiceId,
            amount: '200.00',
            currency: 'USD',
            exchangeRate: '11.00',
            method: 'card',
            referenceNumber: 'POS-12345',
          },
          { id: actorId },
        ),
      );
      expect(payment.tjsEquivalent.toString()).toBe('2200');
      expect(payment.exchangeRate.toString()).toBe('11');
      const invoice = await withTenant(() => invoiceService.findById(invoiceId));
      // Hâlâ açık: 5800 - 2000 - 2200 = 1600 TJS
      expect(invoice.status).toBe('partial');
    });

    it('final payment 1600 TJS → status paid', async () => {
      await withTenant(() =>
        paymentService.create(
          {
            invoiceId,
            amount: '1600.00',
            currency: 'TJS',
            method: 'transfer',
            referenceNumber: 'HVL-2026-001',
          },
          { id: actorId },
        ),
      );
      const invoice = await withTenant(() => invoiceService.findById(invoiceId));
      expect(invoice.status).toBe('paid');
    });

    it('overpayment attempt → BadRequest', async () => {
      // Yeni invoice yarat 1000 TJS, 1500 ödemeye çalış
      const inv = await withTenant(() =>
        invoiceService.create(
          {
            patientId: fixtures.tenantA.patientId,
            currency: 'TJS',
            discount: '0',
            items: [{ description: 'Test', quantity: 1, unitPrice: '1000.00' }],
          },
          { id: actorId },
        ),
      );
      await expect(
        withTenant(() =>
          paymentService.create(
            { invoiceId: inv.id, amount: '1500.00', currency: 'TJS', method: 'cash' },
            { id: actorId },
          ),
        ),
      ).rejects.toThrow(/exceeds open balance/);
    });

    it('USD payment without exchangeRate when invoice TJS → BadRequest', async () => {
      const inv = await withTenant(() =>
        invoiceService.create(
          {
            patientId: fixtures.tenantA.patientId,
            currency: 'TJS',
            discount: '0',
            items: [{ description: 'Test', quantity: 1, unitPrice: '500.00' }],
          },
          { id: actorId },
        ),
      );
      await expect(
        withTenant(() =>
          paymentService.create(
            { invoiceId: inv.id, amount: '50.00', currency: 'USD', method: 'cash' },
            { id: actorId },
          ),
        ),
      ).rejects.toThrow(/exchangeRate required/);
    });
  });

  describe('Refund flow', () => {
    let invoiceId: string;
    let paymentId: string;

    beforeAll(async () => {
      // Yeni fatura + tek tahsilat
      const inv = await withTenant(() =>
        invoiceService.create(
          {
            patientId: fixtures.tenantA.patientId,
            currency: 'TJS',
            discount: '0',
            items: [{ description: 'Refund test', quantity: 1, unitPrice: '3000.00' }],
          },
          { id: actorId },
        ),
      );
      invoiceId = inv.id;
      const p = await withTenant(() =>
        paymentService.create(
          { invoiceId, amount: '3000.00', currency: 'TJS', method: 'cash' },
          { id: actorId },
        ),
      );
      paymentId = p.id;
    });

    it('partial refund 1000 → invoice status partial', async () => {
      const refund = await withTenant(() =>
        refundService.create(
          {
            paymentId,
            amount: '1000.00',
            reason: 'Test kismi iade — uzun yeterli sebep',
          },
          { id: adminActorId, roles: ['yonetici'] },
        ),
      );
      expect(refund.amount.toString()).toBe('1000');
      expect(refund.tjsEquivalent.toString()).toBe('1000');
      const invoice = await withTenant(() => invoiceService.findById(invoiceId));
      expect(invoice.status).toBe('partial');
    });

    it('full remaining refund 2000 → invoice status refunded, payment.refundedAt set', async () => {
      await withTenant(() =>
        refundService.create(
          {
            paymentId,
            amount: '2000.00',
            reason: 'Test tam iade — kalan tutar, yeterli sebep',
          },
          { id: adminActorId, roles: ['yonetici'] },
        ),
      );
      const invoice = await withTenant(() => invoiceService.findById(invoiceId));
      expect(invoice.status).toBe('refunded');
      const updated = await admin.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(updated.refundedAt).not.toBeNull();
    });

    it('over-refund attempt → BadRequest', async () => {
      await expect(
        withTenant(() =>
          refundService.create(
            { paymentId, amount: '500.00', reason: 'Tekrar denemek — geçersiz' },
            { id: adminActorId, roles: ['yonetici'] },
          ),
        ),
      ).rejects.toThrow(/exceeds refundable/);
    });
  });

  describe('CashRegister Z-report', () => {
    let closureId: string;

    it('currentSnapshot aggregates unclosed payments/refunds', async () => {
      const snapshot = await withTenant(() => cashRegisterService.currentSnapshot());
      expect(snapshot.paymentCount).toBeGreaterThan(0);
      // refund totalTjsEquivalent net altta gözükür
      expect(snapshot.netTjsEquivalent).toBeDefined();
    });

    it('close creates Z-report + assigns closureId to all unclosed records', async () => {
      const closure = await withTenant(() =>
        cashRegisterService.close({ notes: 'Test gün sonu kapanış' }, { id: adminActorId }),
      );
      expect(closure.paymentCount).toBeGreaterThan(0);
      expect(closure.totalTjsEquivalent).toBeDefined();
      closureId = closure.id;

      // Snapshot artık boş olmalı (her şey closure'a atandı)
      const after = await withTenant(() => cashRegisterService.currentSnapshot());
      expect(after.paymentCount).toBe(0);
      expect(after.refundCount).toBe(0);
    });

    it('close with no unclosed records → Conflict', async () => {
      await expect(
        withTenant(() => cashRegisterService.close({ notes: null }, { id: adminActorId })),
      ).rejects.toThrow(/nothing to close/);
    });

    it('findById returns closure with payments + refunds breakdown', async () => {
      const closure = await withTenant(() => cashRegisterService.findById(closureId));
      expect(closure.payments.length).toBeGreaterThan(0);
      expect(closure.closedBy.id).toBe(adminActorId);
    });
  });

  describe('Invoice cancel + getOpenBalance', () => {
    it('cancel invoice without payments succeeds', async () => {
      const inv = await withTenant(() =>
        invoiceService.create(
          {
            patientId: fixtures.tenantA.patientId,
            currency: 'TJS',
            discount: '0',
            items: [{ description: 'Cancel test', quantity: 1, unitPrice: '100.00' }],
          },
          { id: actorId },
        ),
      );
      const cancelled = await withTenant(() =>
        invoiceService.cancel(inv.id, 'Test iptal — neden uzun', { id: adminActorId }),
      );
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.cancelReason).toBe('Test iptal — neden uzun');
    });

    it('cancel invoice with payments → BadRequest (refund first)', async () => {
      const inv = await withTenant(() =>
        invoiceService.create(
          {
            patientId: fixtures.tenantA.patientId,
            currency: 'TJS',
            discount: '0',
            items: [{ description: 'CannotCancel', quantity: 1, unitPrice: '500.00' }],
          },
          { id: actorId },
        ),
      );
      await withTenant(() =>
        paymentService.create(
          { invoiceId: inv.id, amount: '500.00', currency: 'TJS', method: 'cash' },
          { id: actorId },
        ),
      );
      await expect(
        withTenant(() =>
          invoiceService.cancel(inv.id, 'iptal sebep — yeterince uzun', { id: adminActorId }),
        ),
      ).rejects.toThrow(/has payments/);
    });

    it('getOpenBalance reflects unpaid invoices', async () => {
      const balance = await withTenant(() =>
        invoiceService.getOpenBalance(fixtures.tenantA.patientId),
      );
      // En azından testlerden kalan açık invoice'lar mevcut
      expect(parseFloat(balance.totalTjsEquivalent)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(balance.openTjsEquivalent)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Discount + edge cases', () => {
    it('invoice with discount → total = subtotal - discount', async () => {
      // S14: yönetici cap=100% → onay gerektirmez. Aksi durum approval-flow E2E'de.
      const inv = await withTenant(() =>
        invoiceService.create(
          {
            patientId: fixtures.tenantA.patientId,
            currency: 'TJS',
            discount: '200.00',
            items: [{ description: 'Indirim test', quantity: 2, unitPrice: '600.00' }],
          },
          { id: actorId, roles: ['yonetici'] },
        ),
      );
      expect(inv.subtotal.toString()).toBe('1200');
      expect(inv.total.toString()).toBe('1000');
    });

    it('invoice with discount > subtotal → BadRequest', async () => {
      await expect(
        withTenant(() =>
          invoiceService.create(
            {
              patientId: fixtures.tenantA.patientId,
              currency: 'TJS',
              discount: '5000.00',
              items: [{ description: 'too much', quantity: 1, unitPrice: '100.00' }],
            },
            { id: actorId },
          ),
        ),
      ).rejects.toThrow(/discount exceeds subtotal/);
    });

    it('zero amount payment → BadRequest', async () => {
      const inv = await withTenant(() =>
        invoiceService.create(
          {
            patientId: fixtures.tenantA.patientId,
            currency: 'TJS',
            discount: '0',
            items: [{ description: 'zero', quantity: 1, unitPrice: '100.00' }],
          },
          { id: actorId },
        ),
      );
      await expect(
        withTenant(() =>
          paymentService.create(
            { invoiceId: inv.id, amount: '0', currency: 'TJS', method: 'cash' },
            { id: actorId },
          ),
        ),
      ).rejects.toThrow(/greater than 0/);
    });
  });
});

// Ek: Decimal toFixed sanity check (Prisma.Decimal float değil)
describe('Prisma.Decimal sanity', () => {
  it('decimal arithmetic is precise (not float)', () => {
    const a = new Prisma.Decimal('0.1');
    const b = new Prisma.Decimal('0.2');
    expect(a.plus(b).toString()).toBe('0.3');
  });
});
