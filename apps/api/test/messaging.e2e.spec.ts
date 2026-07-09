import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@airmed/db';
import { ClsModule } from 'nestjs-cls';
import { MessagingModule } from '../src/messaging/messaging.module';
import { MessagingService } from '../src/messaging/messaging.service';
import { isInQuietHours, nextWindowEnd } from '../src/messaging/messaging.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { TenantModule } from '../src/tenant/tenant.module';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';

// D1 PR 1 — Messaging backend altyapı testleri.
// Trigger seed + fire + render + quiet hours + worker dispatch + filter.

describe('D1 messaging backend (trigger seed + fire + quiet hours + worker)', () => {
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let service: MessagingService;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        ClsModule.forRoot({ global: true, middleware: { mount: true } }),
        PrismaModule,
        TenantModule,
        MessagingModule,
      ],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(MessagingService);
  });

  beforeEach(async () => {
    await prisma.messageDelivery.deleteMany({});
    await prisma.messageTemplate.deleteMany({});
    await prisma.messageTrigger.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('ensureDefaults idempotent: 24 trigger + 24 template seed', async () => {
    await service.ensureDefaults(fixtures.tenantA.id);
    const triggers = await prisma.messageTrigger.count({
      where: { tenantId: fixtures.tenantA.id },
    });
    const templates = await prisma.messageTemplate.count({
      where: { tenantId: fixtures.tenantA.id },
    });
    expect(triggers).toBe(24);
    expect(templates).toBe(24); // 18 TR default + 6 post-op çok dilli (3 dil × 2 trigger)

    // İkinci çağrı: count değişmez (idempotent upsert)
    await service.ensureDefaults(fixtures.tenantA.id);
    expect(await prisma.messageTrigger.count({ where: { tenantId: fixtures.tenantA.id } })).toBe(
      24,
    );
  });

  it('COMPLICATION_DOCTOR_ALERT is_mandatory=true (UI disabled hint)', async () => {
    await service.ensureDefaults(fixtures.tenantA.id);
    const t = await prisma.messageTrigger.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: fixtures.tenantA.id, key: 'COMPLICATION_DOCTOR_ALERT' } },
    });
    expect(t.isMandatory).toBe(true);
    expect(t.isEnabled).toBe(true);
  });

  it('fire: enabled trigger → MessageDelivery PENDING + Handlebars render', async () => {
    const result = await service.fire({
      tenantId: fixtures.tenantA.id,
      key: 'APPOINTMENT_CONFIRMATION',
      recipient: '+992111000111',
      context: {
        patientName: 'Ali Veli',
        appointmentDate: '2026-06-15 10:00',
        doctorName: 'Dr. Test',
        leakySecret: 'should-not-render',
      },
    });
    expect(result.queued).toBe(1);

    const delivery = await prisma.messageDelivery.findFirstOrThrow({
      where: { tenantId: fixtures.tenantA.id, triggerKey: 'APPOINTMENT_CONFIRMATION' },
    });
    expect(delivery.status).toBe('PENDING');
    expect(delivery.body).toContain('Sayın Ali Veli');
    expect(delivery.body).toContain('2026-06-15 10:00');
    expect(delivery.body).toContain('Dr. Test');
    // Whitelist: leakySecret allowed listede yok → render edilmez (substring kontrolü)
    expect(delivery.body).not.toContain('should-not-render');
  });

  it('fire: disabled trigger → queued=0 + reason', async () => {
    await service.ensureDefaults(fixtures.tenantA.id);
    // APPOINTMENT_REMINDER_2H default OFF
    const result = await service.fire({
      tenantId: fixtures.tenantA.id,
      key: 'APPOINTMENT_REMINDER_2H',
      recipient: '+992111000111',
      context: { patientName: 'X' },
    });
    expect(result.queued).toBe(0);
    expect(result.skipped).toBe('trigger_disabled');
  });

  it('fire: unknown trigger key → queued=0 + reason', async () => {
    const result = await service.fire({
      tenantId: fixtures.tenantA.id,
      key: 'NON_EXISTENT_TRIGGER',
      recipient: '+992111000111',
      context: {},
    });
    expect(result.queued).toBe(0);
    expect(result.skipped).toBe('unknown_trigger');
  });

  it('quiet hours wrap-around (22-7) → currentHour 23 INSIDE, 12 OUTSIDE', () => {
    expect(isInQuietHours(23, 22, 7)).toBe(true);
    expect(isInQuietHours(2, 22, 7)).toBe(true);
    expect(isInQuietHours(7, 22, 7)).toBe(false); // end exclusive
    expect(isInQuietHours(12, 22, 7)).toBe(false);
    expect(isInQuietHours(21, 22, 7)).toBe(false);
  });

  it('nextWindowEnd: Dushanbe 07:00 = UTC 02:00 → şimdi UTC sonrası', () => {
    // 2026-06-15 00:00 UTC (Dushanbe 05:00 — quiet hours içinde)
    const now = new Date('2026-06-15T00:00:00Z');
    const next = nextWindowEnd(now, 7); // Dushanbe 7
    expect(next.getUTCHours()).toBe(2);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  it('worker processPendingBatch: PENDING → SENT/DELIVERED + attempts +1', async () => {
    await service.fire({
      tenantId: fixtures.tenantA.id,
      key: 'APPOINTMENT_CONFIRMATION',
      recipient: '+992111000111',
      context: {
        patientName: 'Worker Test',
        appointmentDate: '2026-06-15',
        doctorName: 'Dr.',
      },
    });
    const result = await service.processPendingBatch();
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    const d = await prisma.messageDelivery.findFirstOrThrow({
      where: { triggerKey: 'APPOINTMENT_CONFIRMATION' },
    });
    expect(d.status).toBe('DELIVERED');
    expect(d.attempts).toBe(1);
    expect(d.sentAt).not.toBeNull();
    expect(d.deliveredAt).not.toBeNull();
  });

  it('worker scheduledAt > now → skip (cron picks later)', async () => {
    const futureTs = new Date(Date.now() + 60 * 60 * 1000); // 1h sonra
    await service.fire({
      tenantId: fixtures.tenantA.id,
      key: 'APPOINTMENT_CONFIRMATION',
      recipient: '+992111000111',
      context: { patientName: 'F', appointmentDate: 'F', doctorName: 'F' },
      scheduledAt: futureTs,
    });
    const result = await service.processPendingBatch();
    expect(result.sent).toBe(0);
    const d = await prisma.messageDelivery.findFirstOrThrow({});
    expect(d.status).toBe('PENDING');
  });

  // P0 2.6 orphan-prevention behavior (HTTP context'inde): TenantInterceptor
  // → ClsService.run → tenantContext.setTransaction(tx) → fire scoped tx
  // içinde MessageDelivery yazar. Parent throw → tx rollback → delivery yok.
  // Bu davranışı d1-module-integrations.e2e.spec.ts tüm 5 senaryoda passing
  // halde örnekliyor (HTTP path); service-level orphan testi ClsService
  // context kurulum gerektiriyor, ayrı bir test infra PR'ı.

  it("per-tenant izolasyon: tenantB trigger config tenantA fire'ı etkilemez", async () => {
    await service.ensureDefaults(fixtures.tenantA.id);
    await service.ensureDefaults(fixtures.tenantB.id);
    // tenantB'de APPOINTMENT_CONFIRMATION disable et
    await prisma.messageTrigger.update({
      where: {
        tenantId_key: { tenantId: fixtures.tenantB.id, key: 'APPOINTMENT_CONFIRMATION' },
      },
      data: { isEnabled: false },
    });
    // tenantA hala enabled
    const a = await service.fire({
      tenantId: fixtures.tenantA.id,
      key: 'APPOINTMENT_CONFIRMATION',
      recipient: '+992111000111',
      context: { patientName: 'A', appointmentDate: 'A', doctorName: 'A' },
    });
    expect(a.queued).toBe(1);
    const b = await service.fire({
      tenantId: fixtures.tenantB.id,
      key: 'APPOINTMENT_CONFIRMATION',
      recipient: '+992222000111',
      context: { patientName: 'B', appointmentDate: 'B', doctorName: 'B' },
    });
    expect(b.queued).toBe(0);
    expect(b.skipped).toBe('trigger_disabled');
  });
});
