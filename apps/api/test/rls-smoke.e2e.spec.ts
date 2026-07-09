import { PrismaClient } from '@airmed/db';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';

describe('RLS smoke (airmed_app, NOSUPERUSER NOBYPASSRLS)', () => {
  let appPrisma: PrismaClient;
  let adminPrisma: PrismaClient;
  let fixtures: IsolationFixtures;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    appPrisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_APP! } } });
    adminPrisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
  });

  afterAll(async () => {
    await appPrisma.$disconnect();
    await adminPrisma.$disconnect();
  });

  it('admin role sees every tenant row (BYPASSRLS)', async () => {
    const total = await adminPrisma.user.count();
    // tenant A: yönetici + resepsiyon, tenant B: yönetici
    expect(total).toBe(3);
  });

  it('app role without tenant context sees zero rows on every RLS table', async () => {
    expect(await appPrisma.user.count()).toBe(0);
    expect(await appPrisma.patient.count()).toBe(0);
    expect(await appPrisma.role.count()).toBe(0);
    expect(await appPrisma.refreshToken.count()).toBe(0);
  });

  it('app role with tenant A context sees only A rows', async () => {
    const result = await appPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${fixtures.tenantA.id}'`);
      const users = await tx.user.findMany({
        select: { id: true, tenantId: true, email: true },
        orderBy: { email: 'asc' },
      });
      const patients = await tx.patient.findMany({ select: { id: true, tenantId: true } });
      return { users, patients };
    });
    expect(result.users.map((u) => u.tenantId)).toEqual(
      result.users.map(() => fixtures.tenantA.id),
    );
    expect(result.users.map((u) => u.email).sort()).toEqual(
      [fixtures.tenantA.adminEmail, fixtures.tenantA.receptionistEmail].sort(),
    );
    expect(result.patients.map((p) => p.tenantId)).toEqual([fixtures.tenantA.id]);
  });

  it('app role with tenant B context sees only B rows', async () => {
    const users = await appPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${fixtures.tenantB.id}'`);
      return tx.user.findMany({ select: { tenantId: true, email: true } });
    });
    expect(users).toEqual([{ tenantId: fixtures.tenantB.id, email: fixtures.tenantB.adminEmail }]);
  });

  it('explicit cross-tenant filter still respects RLS (cannot read foreign rows)', async () => {
    const rows = await appPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${fixtures.tenantA.id}'`);
      return tx.user.findMany({ where: { tenantId: fixtures.tenantB.id } });
    });
    expect(rows).toEqual([]);
  });

  it('cross-tenant UPDATE/DELETE matches zero rows under RLS', async () => {
    const updated = await appPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${fixtures.tenantA.id}'`);
      return tx.user.updateMany({
        where: { tenantId: fixtures.tenantB.id },
        data: { name: 'pwned' },
      });
    });
    expect(updated.count).toBe(0);

    const stillIntact = await adminPrisma.user.findUniqueOrThrow({
      where: { id: fixtures.tenantB.adminId },
      select: { name: true },
    });
    expect(stillIntact.name).toBe('Admin B');
  });

  describe('D1 messaging tables (message_templates, message_triggers, message_deliveries)', () => {
    const TEMPLATE_A_ID = '11111111-aaaa-bbbb-cccc-d1d1d1d1d1d1';
    const TEMPLATE_B_ID = '22222222-aaaa-bbbb-cccc-d1d1d1d1d1d1';
    const TRIGGER_A_ID = '11111111-aaaa-bbbb-cccc-e1e1e1e1e1e1';
    const TRIGGER_B_ID = '22222222-aaaa-bbbb-cccc-e1e1e1e1e1e1';

    beforeAll(async () => {
      await adminPrisma.messageTemplate.deleteMany({});
      await adminPrisma.messageTrigger.deleteMany({});
      await adminPrisma.messageDelivery.deleteMany({});
      await adminPrisma.messageTemplate.createMany({
        data: [
          {
            id: TEMPLATE_A_ID,
            tenantId: fixtures.tenantA.id,
            triggerKey: 'APPOINTMENT_REMINDER',
            language: 'tr',
            body: 'A template',
            channelType: 'sms',
          },
          {
            id: TEMPLATE_B_ID,
            tenantId: fixtures.tenantB.id,
            triggerKey: 'APPOINTMENT_REMINDER',
            language: 'tr',
            body: 'B template',
            channelType: 'sms',
          },
        ],
      });
      await adminPrisma.messageTrigger.createMany({
        data: [
          {
            id: TRIGGER_A_ID,
            tenantId: fixtures.tenantA.id,
            key: 'APPOINTMENT_REMINDER',
            category: 'appointment',
            name: 'Reminder A',
            channels: ['sms'],
          },
          {
            id: TRIGGER_B_ID,
            tenantId: fixtures.tenantB.id,
            key: 'APPOINTMENT_REMINDER',
            category: 'appointment',
            name: 'Reminder B',
            channels: ['sms'],
          },
        ],
      });
    });

    it('tenant A context sees only its own message_templates / message_triggers', async () => {
      const result = await appPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${fixtures.tenantA.id}'`);
        const templates = await tx.messageTemplate.findMany({
          select: { id: true, tenantId: true },
        });
        const triggers = await tx.messageTrigger.findMany({ select: { id: true, tenantId: true } });
        return { templates, triggers };
      });
      expect(result.templates).toEqual([{ id: TEMPLATE_A_ID, tenantId: fixtures.tenantA.id }]);
      expect(result.triggers).toEqual([{ id: TRIGGER_A_ID, tenantId: fixtures.tenantA.id }]);
    });

    it('explicit cross-tenant filter on message_templates returns empty under RLS', async () => {
      const rows = await appPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${fixtures.tenantA.id}'`);
        return tx.messageTemplate.findMany({ where: { tenantId: fixtures.tenantB.id } });
      });
      expect(rows).toEqual([]);
    });

    it('cross-tenant UPDATE on message_triggers matches zero rows', async () => {
      const updated = await appPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${fixtures.tenantA.id}'`);
        return tx.messageTrigger.updateMany({
          where: { tenantId: fixtures.tenantB.id },
          data: { isEnabled: false },
        });
      });
      expect(updated.count).toBe(0);

      const intact = await adminPrisma.messageTrigger.findUniqueOrThrow({
        where: { id: TRIGGER_B_ID },
        select: { isEnabled: true },
      });
      expect(intact.isEnabled).toBe(true);
    });

    it('app role without tenant context sees zero rows on D1 tables', async () => {
      expect(await appPrisma.messageTemplate.count()).toBe(0);
      expect(await appPrisma.messageTrigger.count()).toBe(0);
      expect(await appPrisma.messageDelivery.count()).toBe(0);
    });
  });

  describe('A12 sync_conflicts table (nullable tenant_id, NULL = platform-only)', () => {
    const CONFLICT_A_ID = '11111111-aaaa-bbbb-cccc-c1c1c1c1c1c1';
    const CONFLICT_B_ID = '22222222-aaaa-bbbb-cccc-c1c1c1c1c1c1';
    const CONFLICT_PLATFORM_ID = '33333333-aaaa-bbbb-cccc-c1c1c1c1c1c1';

    beforeAll(async () => {
      await adminPrisma.syncConflict.deleteMany({});
      await adminPrisma.syncConflict.createMany({
        data: [
          {
            id: CONFLICT_A_ID,
            eventId: '11111111-eeee-eeee-eeee-eeeeeeeeeeee',
            entityType: 'patient',
            entityId: '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            tenantId: fixtures.tenantA.id,
            conflictType: 'lww',
            remoteSource: 'cloud',
            remoteSnapshot: { name: 'A' },
            occurredAt: new Date(),
          },
          {
            id: CONFLICT_B_ID,
            eventId: '22222222-eeee-eeee-eeee-eeeeeeeeeeee',
            entityType: 'patient',
            entityId: '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            tenantId: fixtures.tenantB.id,
            conflictType: 'lww',
            remoteSource: 'cloud',
            remoteSnapshot: { name: 'B' },
            occurredAt: new Date(),
          },
          {
            id: CONFLICT_PLATFORM_ID,
            eventId: '33333333-eeee-eeee-eeee-eeeeeeeeeeee',
            entityType: 'tenant',
            entityId: '33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            tenantId: null,
            conflictType: 'lww',
            remoteSource: 'cloud',
            remoteSnapshot: { meta: 'platform' },
            occurredAt: new Date(),
          },
        ],
      });
    });

    it('tenant A context sees only own conflict; tenant B + NULL hidden', async () => {
      const rows = await appPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${fixtures.tenantA.id}'`);
        return tx.syncConflict.findMany({ select: { id: true, tenantId: true } });
      });
      expect(rows).toEqual([{ id: CONFLICT_A_ID, tenantId: fixtures.tenantA.id }]);
    });

    it('NULL tenant_id conflict invisible to every tenant scope (platform-only)', async () => {
      const rowsA = await appPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${fixtures.tenantA.id}'`);
        return tx.syncConflict.findMany({ where: { id: CONFLICT_PLATFORM_ID } });
      });
      const rowsB = await appPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${fixtures.tenantB.id}'`);
        return tx.syncConflict.findMany({ where: { id: CONFLICT_PLATFORM_ID } });
      });
      expect(rowsA).toEqual([]);
      expect(rowsB).toEqual([]);

      const platformRow = await adminPrisma.syncConflict.findUniqueOrThrow({
        where: { id: CONFLICT_PLATFORM_ID },
      });
      expect(platformRow.tenantId).toBeNull();
    });

    it('cross-tenant UPDATE on sync_conflicts matches zero rows', async () => {
      const updated = await appPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${fixtures.tenantA.id}'`);
        return tx.syncConflict.updateMany({
          where: { id: CONFLICT_B_ID },
          data: { resolution: 'local_kept' },
        });
      });
      expect(updated.count).toBe(0);

      const intact = await adminPrisma.syncConflict.findUniqueOrThrow({
        where: { id: CONFLICT_B_ID },
        select: { resolution: true },
      });
      expect(intact.resolution).toBeNull();
    });

    it('app role without tenant context sees zero sync_conflicts', async () => {
      expect(await appPrisma.syncConflict.count()).toBe(0);
    });
  });

  // ===========================================================================
  // S11a — Billing tabloları (6 tablo) RLS isolation
  // ===========================================================================
  describe('S11a billing tables (service_items, invoices, payments, refunds, cash_register_closures)', () => {
    const SERVICE_A_ID = '11111111-aaaa-bbbb-cccc-aaaa11111111';
    const SERVICE_B_ID = '22222222-aaaa-bbbb-cccc-aaaa11111111';
    const INVOICE_A_ID = '11111111-aaaa-bbbb-cccc-aaaa22222222';
    const INVOICE_B_ID = '22222222-aaaa-bbbb-cccc-aaaa22222222';

    beforeAll(async () => {
      await adminPrisma.payment.deleteMany({});
      await adminPrisma.invoiceItem.deleteMany({});
      await adminPrisma.invoice.deleteMany({});
      await adminPrisma.serviceItem.deleteMany({});

      await adminPrisma.serviceItem.createMany({
        data: [
          {
            id: SERVICE_A_ID,
            tenantId: fixtures.tenantA.id,
            code: 'EXAM_BASIC',
            name: 'Muayene',
            category: 'examination',
            defaultPrice: '200.00',
            defaultCurrency: 'TJS',
          },
          {
            id: SERVICE_B_ID,
            tenantId: fixtures.tenantB.id,
            code: 'EXAM_BASIC',
            name: 'Muayene B',
            category: 'examination',
            defaultPrice: '250.00',
            defaultCurrency: 'TJS',
          },
        ],
      });

      await adminPrisma.invoice.createMany({
        data: [
          {
            id: INVOICE_A_ID,
            tenantId: fixtures.tenantA.id,
            invoiceNumber: '2026-T001',
            patientId: fixtures.tenantA.patientId,
            currency: 'TJS',
            subtotal: '200.00',
            total: '200.00',
          },
          {
            id: INVOICE_B_ID,
            tenantId: fixtures.tenantB.id,
            invoiceNumber: '2026-T001',
            patientId: fixtures.tenantB.patientId,
            currency: 'TJS',
            subtotal: '250.00',
            total: '250.00',
          },
        ],
      });
    });

    it('tenant A context sees only its own service_items + invoices', async () => {
      const result = await appPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${fixtures.tenantA.id}'`);
        const services = await tx.serviceItem.findMany({ select: { id: true } });
        const invoices = await tx.invoice.findMany({ select: { id: true } });
        return { services, invoices };
      });
      expect(result.services).toEqual([{ id: SERVICE_A_ID }]);
      expect(result.invoices).toEqual([{ id: INVOICE_A_ID }]);
    });

    it('cross-tenant filter on invoices returns empty under RLS', async () => {
      const rows = await appPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${fixtures.tenantA.id}'`);
        return tx.invoice.findMany({ where: { tenantId: fixtures.tenantB.id } });
      });
      expect(rows).toEqual([]);
    });

    it('cross-tenant UPDATE on invoices matches zero rows', async () => {
      const updated = await appPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${fixtures.tenantA.id}'`);
        return tx.invoice.updateMany({
          where: { tenantId: fixtures.tenantB.id },
          data: { notes: 'tampered' },
        });
      });
      expect(updated.count).toBe(0);
      const intact = await adminPrisma.invoice.findUniqueOrThrow({
        where: { id: INVOICE_B_ID },
        select: { notes: true },
      });
      expect(intact.notes).toBeNull();
    });

    it('app role without tenant context sees zero billing rows', async () => {
      expect(await appPrisma.serviceItem.count()).toBe(0);
      expect(await appPrisma.invoice.count()).toBe(0);
      expect(await appPrisma.payment.count()).toBe(0);
      expect(await appPrisma.refund.count()).toBe(0);
      expect(await appPrisma.cashRegisterClosure.count()).toBe(0);
    });

    afterAll(async () => {
      // Sonraki test suite'lerin patient.deleteMany'sini bozmasın diye temizlik
      // (invoice'ların patient FK'sı var; FK ihlali önlemek için billing önce).
      await adminPrisma.payment.deleteMany({});
      await adminPrisma.invoiceItem.deleteMany({});
      await adminPrisma.invoice.deleteMany({});
      await adminPrisma.serviceItem.deleteMany({});
    });
  });
});
