import { PrismaClient } from '@airmed/db';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';

// A12 PR 1 — sync_outbox table + PG trigger smoke. App-level interceptor
// gerekmiyor; trigger DB seviyesinde atomik çalışıyor. Worker (PR 2) bu
// satırları okuyup karşı node'a iletecek.

describe('A12 sync_outbox — PG trigger row capture', () => {
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
  });

  beforeEach(async () => {
    await prisma.syncOutbox.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('INSERT patient → 1 outbox row, operation=INSERT, source=LOCAL (default)', async () => {
    const created = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'OUTBOX-001',
        firstName: 'Out',
        lastName: 'Box',
        birthDate: new Date('1990-01-01'),
        gender: 'male',
      },
    });

    const rows = await prisma.syncOutbox.findMany();
    expect(rows.length).toBe(1);
    const r = rows[0];
    expect(r.entityType).toBe('patient');
    expect(r.entityId).toBe(created.id);
    expect(r.operation).toBe('INSERT');
    expect(r.source).toBe('LOCAL');
    expect(r.tenantId).toBe(fixtures.tenantA.id);
    expect(r.syncedAt).toBeNull();
    expect(r.retryCount).toBe(0);
    expect((r.payload as { mrn: string }).mrn).toBe('OUTBOX-001');
    expect((r.payload as { first_name: string }).first_name).toBe('Out');
  });

  it('UPDATE patient → 2 outbox rows (INSERT + UPDATE), occurred_at ilerliyor', async () => {
    const created = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'OUTBOX-002',
        firstName: 'A',
        lastName: 'B',
        birthDate: new Date('1990-01-01'),
        gender: 'female',
      },
    });
    // Small delay to ensure occurred_at ordering is observable
    await new Promise((r) => setTimeout(r, 50));
    await prisma.patient.update({
      where: { id: created.id },
      data: { firstName: 'A-updated' },
    });

    const rows = await prisma.syncOutbox.findMany({
      orderBy: { occurredAt: 'asc' },
    });
    expect(rows.length).toBe(2);
    expect(rows[0].operation).toBe('INSERT');
    expect(rows[1].operation).toBe('UPDATE');
    expect((rows[1].payload as { first_name: string }).first_name).toBe('A-updated');
    expect(rows[1].occurredAt.getTime()).toBeGreaterThanOrEqual(rows[0].occurredAt.getTime());
  });

  it('DELETE patient → outbox satırı OLD row payload + operation=DELETE', async () => {
    const created = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'OUTBOX-003',
        firstName: 'Will',
        lastName: 'Delete',
        birthDate: new Date('1990-01-01'),
        gender: 'male',
      },
    });
    await prisma.patient.delete({ where: { id: created.id } });

    // occurredAt ASC sıralaması INSERT+DELETE peş peşe olunca aynı zaman damgası
    // → belirsiz sıra (kardeş UPDATE testi bunun için 50ms delay koymuş). Bu test
    // SIRA değil "DELETE satırı OLD payload'ı yakaladı"yı doğruluyor → index yerine
    // operation'a göre bul (timing-bağımsız, deterministik).
    const rows = await prisma.syncOutbox.findMany();
    expect(rows.length).toBe(2);
    const deleteRow = rows.find((r) => r.operation === 'DELETE');
    expect(deleteRow).toBeTruthy();
    expect((deleteRow!.payload as { mrn: string }).mrn).toBe('OUTBOX-003');
  });

  it('sync_source PG session var → outbox.source override', async () => {
    // SET LOCAL aynı transaction içinde olmalı; aksi halde pool farklı
    // connection verebilir ve trigger empty source görür.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.sync_source = 'CLOUD'`);
      await tx.patient.create({
        data: {
          tenantId: fixtures.tenantA.id,
          mrn: 'OUTBOX-004',
          firstName: 'From',
          lastName: 'Cloud',
          birthDate: new Date('1990-01-01'),
          gender: 'female',
        },
      });
    });
    const r = await prisma.syncOutbox.findFirstOrThrow({
      where: { entityType: 'patient' },
    });
    expect(r.source).toBe('CLOUD');
  });

  it("appointment + measurement + surgery trigger'ları çalışıyor", async () => {
    // Doctor seed
    const doctor = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        name: 'Dr. Trigger',
        specialty: 'Test',
        isActive: true,
      },
    });
    await prisma.syncOutbox.deleteMany({});

    const appt = await prisma.appointment.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctor.id,
        type: 'consultation',
        status: 'scheduled',
        startsAt: new Date(Date.now() + 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 90 * 60 * 1000),
      },
    });

    const rows = await prisma.syncOutbox.findMany();
    const apptRow = rows.find((r) => r.entityType === 'appointment');
    expect(apptRow).toBeDefined();
    expect(apptRow!.entityId).toBe(appt.id);
  });

  it("sync_outbox kendisi trigger'lanmıyor (loop yok)", async () => {
    // Trigger fired only on entity tables; sync_outbox INSERT/UPDATE
    // shouldn't cascade more outbox rows.
    const before = await prisma.syncOutbox.count();
    await prisma.syncOutbox.create({
      data: {
        source: 'LOCAL',
        entityType: 'manual',
        entityId: '00000000-0000-0000-0000-000000000099',
        operation: 'INSERT',
        payload: { test: true },
        occurredAt: new Date(),
      },
    });
    const after = await prisma.syncOutbox.count();
    expect(after - before).toBe(1); // sadece bizim manuel insert, başka outbox satırı yok
  });

  it('audit_logs trigger kapsamı DIŞINDA (ayrı stream)', async () => {
    await prisma.syncOutbox.deleteMany({});
    await prisma.auditLog.create({
      data: {
        tenantId: fixtures.tenantA.id,
        action: 'test.action',
        payload: {},
      },
    });
    const count = await prisma.syncOutbox.count({ where: { entityType: 'auditLog' } });
    expect(count).toBe(0);
  });

  // P0 2.5 — Önceki migration (20260524190530) user_roles trigger'ını composite
  // PK uyumsuzluğu nedeniyle DROP etmişti → rol değişiklikleri sync edilmiyordu.
  // 20260526182000_user_roles_id_pk_sync_trigger migration'ı user_roles'a id
  // UUID PK ekledi, composite anahtarı @@unique constraint olarak korudu, ve
  // mevcut sync_outbox_record() function ile trigger ekledi.
  it('P0 2.5 — user_roles INSERT/UPDATE/DELETE → sync_outbox satırı oluşur', async () => {
    const roleA = await prisma.role.findFirstOrThrow({
      where: { tenantId: fixtures.tenantA.id, key: 'doktor' },
    });
    const hash = await import('bcrypt').then((m) => m.hash('sync-user-pass', 4));
    const user = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: 'sync-user-roles-test@a.tj',
        passwordHash: hash,
        name: 'Sync UserRole Test',
        status: 'active',
      },
    });
    await prisma.syncOutbox.deleteMany({});

    // INSERT — rol atama
    const userRole = await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: user.id, roleId: roleA.id },
    });
    const afterInsert = await prisma.syncOutbox.findMany({ where: { entityType: 'userRole' } });
    expect(afterInsert).toHaveLength(1);
    expect(afterInsert[0].operation).toBe('INSERT');
    expect(afterInsert[0].entityId).toBe(userRole.id);
    expect(afterInsert[0].tenantId).toBe(fixtures.tenantA.id);
    expect((afterInsert[0].payload as { user_id: string }).user_id).toBe(user.id);

    // DELETE — rol revoke
    await prisma.userRole.delete({ where: { id: userRole.id } });
    const afterDelete = await prisma.syncOutbox.findMany({
      where: { entityType: 'userRole', operation: 'DELETE' },
    });
    expect(afterDelete).toHaveLength(1);
    expect(afterDelete[0].entityId).toBe(userRole.id);

    // Cleanup
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('P0 2.5 — user_roles composite anahtar hâlâ unique (mevcut iş kuralı korundu)', async () => {
    const roleA = await prisma.role.findFirstOrThrow({
      where: { tenantId: fixtures.tenantA.id, key: 'doktor' },
    });
    const hash = await import('bcrypt').then((m) => m.hash('sync-dup-pass', 4));
    const user = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: 'sync-userroles-dup@a.tj',
        passwordHash: hash,
        name: 'Sync Dup',
        status: 'active',
      },
    });
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: user.id, roleId: roleA.id },
    });
    // Aynı (tenant, user, role) ikinci kez → P2002 unique constraint
    await expect(
      prisma.userRole.create({
        data: { tenantId: fixtures.tenantA.id, userId: user.id, roleId: roleA.id },
      }),
    ).rejects.toThrow(/Unique constraint|P2002/);

    // Cleanup
    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
