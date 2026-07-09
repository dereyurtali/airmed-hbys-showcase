import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// D1 PR 2 — Modül entegrasyonları:
// - A6 AppointmentService.create → APPOINTMENT_CONFIRMATION (now) +
//   APPOINTMENT_REMINDER_24H (startsAt - 24h)
// - A6 AppointmentService.cancel → APPOINTMENT_CANCELLED
// - B1 SurgeryService.markComplication → COMPLICATION_DOCTOR_ALERT (mandatory)
// - C1 IolService.createLot → LENS_ARRIVAL_NOTICE (internal)
//
// Best-effort: messaging düşse bile parent operasyon başarılı.

interface LoginBody {
  accessToken: string;
}
interface TrpcSuccess<T> {
  result: { data: T };
}

async function login(
  app: INestApplication,
  slug: string,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app.getHttpServer() as App)
    .post('/api/auth/login')
    .send({ tenantSlug: slug, email, password });
  return (res.body as LoginBody).accessToken;
}

async function trpcMutation<T>(app: INestApplication, token: string, route: string, body: unknown) {
  const res = await request(app.getHttpServer() as App)
    .post(`/api/trpc/${route}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  return { status: res.status, body: res.body as TrpcSuccess<T> };
}

describe('D1 PR 2 — module integrations (A6 + B1 + C1)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let doctorToken: string;
  let doctorProfileId: string;
  let patientWithPhoneId: string;
  let patientNoPhoneId: string;
  let iolModelId: string;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );

    adminToken = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );

    // Doctor with contact info for COMPLICATION alert routing.
    const doktorRole = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: fixtures.tenantA.id, key: 'doktor' } },
    });
    const hash = await bcrypt.hash('doktor-pass-1234', 4);
    const u = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: 'd1pr2@a.tj',
        passwordHash: hash,
        name: 'Dr. D1Integ',
        status: 'active',
      },
    });
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: u.id, roleId: doktorRole.id },
    });
    const dp = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        userId: u.id,
        name: 'Dr. D1Integ',
        specialty: 'Cataract',
        contactPhone: '+992900111222',
        isActive: true,
      },
    });
    doctorProfileId = dp.id;
    doctorToken = await login(app, fixtures.tenantA.slug, 'd1pr2@a.tj', 'doktor-pass-1234');

    // Patients: one with phone (messaging hits), one without (skip).
    const withPhone = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'D1MC-001',
        firstName: 'Test',
        lastName: 'WithPhone',
        phone: '+992555000111',
        gender: 'female',
        birthDate: new Date('1990-01-01'),
      },
    });
    const noPhone = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'D1MC-002',
        firstName: 'Test',
        lastName: 'NoPhone',
        gender: 'male',
        birthDate: new Date('1985-01-01'),
      },
    });
    patientWithPhoneId = withPhone.id;
    patientNoPhoneId = noPhone.id;

    // IOL model for createLot tests.
    const model = await prisma.iolModel.create({
      data: { tenantId: fixtures.tenantA.id, brand: 'Alcon', model: 'AcrySof-IQ' },
    });
    iolModelId = model.id;
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.messageDelivery.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.appointment.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.iolStockMovement.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.iolLot.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.messageDelivery.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.appointment.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.iolStockMovement.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.iolLot.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await app.close();
    await prisma.$disconnect();
  });

  // ---------- A6 Appointment ----------

  it('appointment.create (patient with phone) → CONFIRMATION (now) + REMINDER_24H (queued)', async () => {
    const startsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(); // +5 gün
    const endsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000 + 30 * 60_000).toISOString();
    const res = await trpcMutation<{ id: string; startsAt: string }>(
      app,
      adminToken,
      'appointment.create',
      {
        patientId: patientWithPhoneId,
        doctorId: doctorProfileId,
        type: 'consultation',
        startsAt,
        endsAt,
      },
    );
    expect(res.status).toBe(200);

    const deliveries = await prisma.messageDelivery.findMany({
      where: { tenantId: fixtures.tenantA.id, recipient: '+992555000111' },
      orderBy: { triggerKey: 'asc' },
    });
    expect(deliveries.length).toBe(2);
    const keys = deliveries.map((d) => d.triggerKey).sort();
    expect(keys).toEqual(['APPOINTMENT_CONFIRMATION', 'APPOINTMENT_REMINDER_24H']);

    const reminder = deliveries.find((d) => d.triggerKey === 'APPOINTMENT_REMINDER_24H')!;
    // Reminder scheduledAt ~ startsAt - 24h (1dk tolerans)
    const expected = new Date(startsAt).getTime() - 24 * 60 * 60 * 1000;
    expect(Math.abs(reminder.scheduledAt.getTime() - expected)).toBeLessThan(60_000);
  });

  it('appointment.create (patient without phone) → no deliveries (skip silent)', async () => {
    const startsAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000 + 30 * 60_000).toISOString();
    const res = await trpcMutation<{ id: string }>(app, adminToken, 'appointment.create', {
      patientId: patientNoPhoneId,
      doctorId: doctorProfileId,
      type: 'consultation',
      startsAt,
      endsAt,
    });
    expect(res.status).toBe(200);
    const count = await prisma.messageDelivery.count({
      where: { tenantId: fixtures.tenantA.id },
    });
    expect(count).toBe(0);
  });

  it('appointment.cancel → APPOINTMENT_CANCELLED fire', async () => {
    const startsAt = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000 + 30 * 60_000).toISOString();
    const created = await trpcMutation<{ id: string }>(app, adminToken, 'appointment.create', {
      patientId: patientWithPhoneId,
      doctorId: doctorProfileId,
      type: 'consultation',
      startsAt,
      endsAt,
    });
    expect(created.status).toBe(200);
    await prisma.messageDelivery.deleteMany({ where: { tenantId: fixtures.tenantA.id } });

    const cancelRes = await trpcMutation<{ status: string }>(
      app,
      adminToken,
      'appointment.cancel',
      { id: created.body.result.data.id },
    );
    expect(cancelRes.status).toBe(200);

    const cancelled = await prisma.messageDelivery.findMany({
      where: { tenantId: fixtures.tenantA.id, triggerKey: 'APPOINTMENT_CANCELLED' },
    });
    expect(cancelled.length).toBe(1);
    expect(cancelled[0].body).toContain('Test WithPhone');
  });

  // ---------- B1 Complication ----------

  it('surgery.markComplication → COMPLICATION_DOCTOR_ALERT routed to doctor.contactPhone', async () => {
    const surgery = await prisma.surgery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: patientWithPhoneId,
        doctorId: doctorProfileId,
        type: 'Cataract',
        status: 'performed',
        scheduledAt: new Date(),
        performedAt: new Date(),
      },
    });
    const res = await trpcMutation<{ complicationFlag: boolean }>(
      app,
      doctorToken,
      'surgery.markComplication',
      {
        surgeryId: surgery.id,
        category: 'macula_edema',
        severity: 'severe',
        description: 'Acil değerlendirme gerekli',
      },
    );
    expect(res.status).toBe(200);
    const deliveries = await prisma.messageDelivery.findMany({
      where: { tenantId: fixtures.tenantA.id, triggerKey: 'COMPLICATION_DOCTOR_ALERT' },
    });
    expect(deliveries.length).toBe(1);
    expect(deliveries[0].recipient).toBe('+992900111222');
    expect(deliveries[0].body).toContain('Dr. D1Integ');
    expect(deliveries[0].body).toContain('severe');
  });

  // ---------- C1 IOL ----------

  it('iol.createLot → LENS_ARRIVAL_NOTICE internal delivery', async () => {
    const res = await trpcMutation<{ id: string }>(app, adminToken, 'iol.createLot', {
      modelId: iolModelId,
      lotNumber: 'LOT-D1-001',
      power: 22.5,
      initialQuantity: 10,
      expiresAt: '2028-12-31',
    });
    expect(res.status).toBe(200);

    const deliveries = await prisma.messageDelivery.findMany({
      where: { tenantId: fixtures.tenantA.id, triggerKey: 'LENS_ARRIVAL_NOTICE' },
    });
    expect(deliveries.length).toBe(1);
    expect(deliveries[0].recipient).toBe('internal:stock');
    expect(deliveries[0].body).toContain('Alcon AcrySof-IQ');
    expect(deliveries[0].body).toContain('10');
    expect(deliveries[0].body).toContain('LOT-D1-001');
  });
});
