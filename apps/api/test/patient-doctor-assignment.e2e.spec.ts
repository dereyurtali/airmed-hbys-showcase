import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// S4 — Doktor-hasta atama (PatientDoctor m2m) e2e doğrulaması.
// Karar tutanağı §7 hibrit model:
//  - auto: randevu/cerrahi yaratıldığında upsert (idempotent)
//  - manual: resepsiyon yeni hasta eklerken primary doctor seçimi
//  - filter: doktor sadece kendi atanmış hastalarını listede görür (sıkı izolasyon)

interface LoginBody {
  accessToken: string;
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

async function seedDoctorUser(
  prisma: PrismaClient,
  tenantId: string,
  email: string,
  password: string,
  doctorName: string,
): Promise<{ userId: string; doctorId: string }> {
  const role = await prisma.role.findUniqueOrThrow({
    where: { tenantId_key: { tenantId, key: 'doktor' } },
  });
  const hash = await bcrypt.hash(password, 4);
  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId, email } },
    update: { status: 'active', passwordHash: hash },
    create: {
      tenantId,
      email,
      passwordHash: hash,
      name: doctorName,
      status: 'active',
    },
  });
  await prisma.userRole.upsert({
    where: { tenantId_userId_roleId: { tenantId, userId: user.id, roleId: role.id } },
    update: {},
    create: { tenantId, userId: user.id, roleId: role.id },
  });
  // Doctor profile (Appointment/Surgery için Doctor.id gerek)
  const existingDoctor = await prisma.doctor.findFirst({ where: { userId: user.id } });
  const doctor =
    existingDoctor ??
    (await prisma.doctor.create({
      data: {
        tenantId,
        userId: user.id,
        name: doctorName,
        specialty: 'Test',
        isActive: true,
      },
    }));
  return { userId: user.id, doctorId: doctor.id };
}

describe('S4 — PatientDoctor m2m (auto + manuel + doktor list filtresi)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let doctorA: { userId: string; doctorId: string };
  let doctorB: { userId: string; doctorId: string };
  let doctorAToken: string;
  let doctorBToken: string;
  let receptionToken: string;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

    doctorA = await seedDoctorUser(
      prisma,
      fixtures.tenantA.id,
      's4-doktor-a@a.tj',
      'pd-pass-strong-1',
      'Dr. A',
    );
    doctorB = await seedDoctorUser(
      prisma,
      fixtures.tenantA.id,
      's4-doktor-b@a.tj',
      'pd-pass-strong-1',
      'Dr. B',
    );

    doctorAToken = await login(app, fixtures.tenantA.slug, 's4-doktor-a@a.tj', 'pd-pass-strong-1');
    doctorBToken = await login(app, fixtures.tenantA.slug, 's4-doktor-b@a.tj', 'pd-pass-strong-1');
    receptionToken = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.receptionistEmail!,
      fixtures.tenantA.receptionistPassword!,
    );
  });

  beforeEach(async () => {
    // Önceki test'in atamalarını temizle (fixture hastası + sample)
    await prisma.patientDoctor.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.appointment.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.patient.deleteMany({
      where: {
        tenantId: fixtures.tenantA.id,
        mrn: { in: ['S4-AUTO-001', 'S4-AUTO-002', 'S4-MANUAL-001', 'S4-FILTER-A', 'S4-FILTER-B'] },
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('appointment.create → PatientDoctor auto upsert (source=auto, idempotent)', async () => {
    const patient = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'S4-AUTO-001',
        firstName: 'Auto',
        lastName: 'Assign',
        birthDate: new Date('1980-01-01'),
        gender: 'male',
      },
    });
    const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 90 * 60 * 1000).toISOString();
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/appointment.create')
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('Content-Type', 'application/json')
      .send({
        patientId: patient.id,
        doctorId: doctorA.doctorId,
        type: 'consultation',
        startsAt,
        endsAt,
      });
    expect(res.status).toBe(200);

    const assignments = await prisma.patientDoctor.findMany({
      where: { tenantId: fixtures.tenantA.id, patientId: patient.id, doctorId: doctorA.doctorId },
    });
    expect(assignments).toHaveLength(1);
    expect(assignments[0].source).toBe('auto');
    expect(assignments[0].isPrimary).toBe(false);

    // İkinci randevu aynı doktor → idempotent (yine 1 satır)
    const startsAt2 = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const endsAt2 = new Date(Date.now() + 2.5 * 60 * 60 * 1000).toISOString();
    const res2 = await request(app.getHttpServer() as App)
      .post('/api/trpc/appointment.create')
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('Content-Type', 'application/json')
      .send({
        patientId: patient.id,
        doctorId: doctorA.doctorId,
        type: 'control',
        startsAt: startsAt2,
        endsAt: endsAt2,
      });
    expect(res2.status).toBe(200);
    const finalAssignments = await prisma.patientDoctor.findMany({
      where: { tenantId: fixtures.tenantA.id, patientId: patient.id },
    });
    expect(finalAssignments).toHaveLength(1);
  });

  it('patient.create + primaryDoctorId → manual primary atama', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/patients')
      .set('Authorization', `Bearer ${receptionToken}`)
      .set('Content-Type', 'application/json')
      .send({
        firstName: 'Manual',
        lastName: 'Primary',
        birthDate: '1990-01-01',
        gender: 'female',
        phone: '+992111111120',
        primaryDoctorId: doctorB.doctorId,
      });
    expect(res.status).toBe(201);
    const patientId = res.body.id as string;
    const assignments = await prisma.patientDoctor.findMany({
      where: { tenantId: fixtures.tenantA.id, patientId },
    });
    expect(assignments).toHaveLength(1);
    expect(assignments[0].source).toBe('manual');
    expect(assignments[0].isPrimary).toBe(true);
    expect(assignments[0].doctorId).toBe(doctorB.doctorId);
  });

  it('doctor patient.list filter: sadece kendi atanmış hastaları görür (sıkı izolasyon)', async () => {
    // Patient A: Dr. A'ya atanmış
    const patientA = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'S4-FILTER-A',
        firstName: 'AssignedTo',
        lastName: 'DoctorA',
        birthDate: new Date('1985-01-01'),
        gender: 'male',
      },
    });
    // Patient B: Dr. B'ye atanmış
    const patientB = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'S4-FILTER-B',
        firstName: 'AssignedTo',
        lastName: 'DoctorB',
        birthDate: new Date('1985-01-01'),
        gender: 'female',
      },
    });
    await prisma.patientDoctor.createMany({
      data: [
        {
          tenantId: fixtures.tenantA.id,
          patientId: patientA.id,
          doctorId: doctorA.doctorId,
          source: 'auto',
        },
        {
          tenantId: fixtures.tenantA.id,
          patientId: patientB.id,
          doctorId: doctorB.doctorId,
          source: 'auto',
        },
      ],
    });

    // Dr. A'nın listesi → sadece patientA
    const listA = await request(app.getHttpServer() as App)
      .get('/api/patients?search=AssignedTo')
      .set('Authorization', `Bearer ${doctorAToken}`);
    expect(listA.status).toBe(200);
    const itemsA = (listA.body as { items: Array<{ id: string; mrn: string }> }).items;
    expect(itemsA.map((p) => p.mrn).sort()).toEqual(['S4-FILTER-A']);

    // Dr. B'nin listesi → sadece patientB
    const listB = await request(app.getHttpServer() as App)
      .get('/api/patients?search=AssignedTo')
      .set('Authorization', `Bearer ${doctorBToken}`);
    expect(listB.status).toBe(200);
    const itemsB = (listB.body as { items: Array<{ id: string; mrn: string }> }).items;
    expect(itemsB.map((p) => p.mrn).sort()).toEqual(['S4-FILTER-B']);

    // Resepsiyonist (admin role grubu) → ikisini de görür (izolasyon doktora özel)
    const listReception = await request(app.getHttpServer() as App)
      .get('/api/patients?search=AssignedTo')
      .set('Authorization', `Bearer ${receptionToken}`);
    expect(listReception.status).toBe(200);
    const itemsReception = (listReception.body as { items: Array<{ mrn: string }> }).items;
    expect(itemsReception.map((p) => p.mrn).sort()).toEqual(['S4-FILTER-A', 'S4-FILTER-B']);
  });

  it('S5 — can_see_all_patients flag → doktor tüm tenant hastalarını görür (baş hekim)', async () => {
    await prisma.user.update({
      where: { id: doctorA.userId },
      data: { flags: { can_see_all_patients: true } },
    });
    const flaggedToken = await login(
      app,
      fixtures.tenantA.slug,
      's4-doktor-a@a.tj',
      'pd-pass-strong-1',
    );

    const patientB = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'S4-FILTER-B',
        firstName: 'NotAssigned',
        lastName: 'ToDoctorA',
        birthDate: new Date('1985-01-01'),
        gender: 'female',
      },
    });
    await prisma.patientDoctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: patientB.id,
        doctorId: doctorB.doctorId,
        source: 'auto',
      },
    });

    const res = await request(app.getHttpServer() as App)
      .get('/api/patients?search=NotAssigned')
      .set('Authorization', `Bearer ${flaggedToken}`);
    expect(res.status).toBe(200);
    const items = (res.body as { items: Array<{ mrn: string }> }).items;
    expect(items.map((p) => p.mrn)).toContain('S4-FILTER-B');

    await prisma.user.update({ where: { id: doctorA.userId }, data: { flags: {} } });
  });

  it('S5 — is_visiting_doctor flag → sadece kendi cerrahileri (randevu auto atama bypass)', async () => {
    const patientWithAppt = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'S5-VISIT-APPT',
        firstName: 'AppointmentOnly',
        lastName: 'VisitTest',
        birthDate: new Date('1980-01-01'),
        gender: 'male',
      },
    });
    await prisma.patientDoctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: patientWithAppt.id,
        doctorId: doctorA.doctorId,
        source: 'auto',
      },
    });

    const patientWithSurgery = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'S5-VISIT-SURGERY',
        firstName: 'SurgeryDone',
        lastName: 'VisitTest',
        birthDate: new Date('1980-01-01'),
        gender: 'female',
      },
    });
    await prisma.surgery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: patientWithSurgery.id,
        doctorId: doctorA.doctorId,
        type: 'Cataract',
        status: 'performed',
        scheduledAt: new Date(),
        performedAt: new Date(),
      },
    });

    await prisma.user.update({
      where: { id: doctorA.userId },
      data: { flags: { is_visiting_doctor: true } },
    });
    const visitingToken = await login(
      app,
      fixtures.tenantA.slug,
      's4-doktor-a@a.tj',
      'pd-pass-strong-1',
    );

    const res = await request(app.getHttpServer() as App)
      .get('/api/patients?search=VisitTest')
      .set('Authorization', `Bearer ${visitingToken}`);
    expect(res.status).toBe(200);
    const items = (res.body as { items: Array<{ mrn: string }> }).items;
    const mrns = items.map((p) => p.mrn);
    expect(mrns).toContain('S5-VISIT-SURGERY');
    expect(mrns).not.toContain('S5-VISIT-APPT');

    await prisma.user.update({ where: { id: doctorA.userId }, data: { flags: {} } });
    await prisma.surgery.deleteMany({ where: { patientId: patientWithSurgery.id } });
    await prisma.patient.deleteMany({
      where: { id: { in: [patientWithAppt.id, patientWithSurgery.id] } },
    });
  });

  it('doktor henüz atanmış hasta yokken list boş gelir (erken dönüş)', async () => {
    // Henüz hiç PatientDoctor yok bu doktor için
    const empty = await request(app.getHttpServer() as App)
      .get('/api/patients')
      .set('Authorization', `Bearer ${doctorAToken}`);
    expect(empty.status).toBe(200);
    expect((empty.body as { total: number }).total).toBe(0);
    expect((empty.body as { items: unknown[] }).items).toHaveLength(0);
  });
});
