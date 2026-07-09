import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

interface LoginBody {
  accessToken: string;
}

async function login(app: INestApplication, slug: string, email: string, password: string) {
  const res = await request(app.getHttpServer() as App)
    .post('/api/auth/login')
    .send({ tenantSlug: slug, email, password });
  return (res.body as LoginBody).accessToken;
}

async function trpcQuery(app: INestApplication, token: string, path: string, input?: unknown) {
  const q = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await request(app.getHttpServer() as App)
    .get(`/api/trpc/${path}${q}`)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body };
}

async function trpcMutation(app: INestApplication, token: string, path: string, body: unknown) {
  const res = await request(app.getHttpServer() as App)
    .post(`/api/trpc/${path}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  return { status: res.status };
}

// S15 — Doktor erişim kısıtlamaları (güvenlik): doktor diğer doktorları
// listeleyemez, yeni randevu veremez, ve yalnız KENDİ atanmış hastalarını görür.
describe('S15 Doctor access restrictions', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let doctorToken: string;
  let assignedPatientId: string;
  let drUserId: string;

  const DR_EMAIL = 'restrict.doctor@a.tj';
  const DR_PASS = 'doctor-pass-123';

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const doktorRole = await prisma.role.findFirstOrThrow({
      where: { tenantId: fixtures.tenantA.id, key: 'doktor' },
    });
    const user = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: DR_EMAIL,
        name: 'Restrict Doctor',
        passwordHash: await bcrypt.hash(DR_PASS, 4),
        status: 'active',
        mustChangePassword: false,
        userRoles: { create: { tenantId: fixtures.tenantA.id, roleId: doktorRole.id } },
      },
    });
    drUserId = user.id;
    const doctor = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        userId: user.id,
        name: 'Restrict Doctor',
        specialty: 'Göz',
        type: 'local',
      },
    });
    const patient = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'RX00000001',
        firstName: 'Atanmış',
        lastName: 'Hasta',
        birthDate: new Date('1980-01-01'),
        gender: 'male',
      },
    });
    assignedPatientId = patient.id;
    await prisma.patientDoctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: patient.id,
        doctorId: doctor.id,
        isPrimary: true,
        source: 'manual',
      },
    });
    // "Geçmiş Muayeneler" için: bu doktorun bir muayenesi (Examination.doctorId = User.id).
    await prisma.examination.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: patient.id,
        doctorId: drUserId,
        examinedAt: new Date(),
        chiefComplaint: 'Görme bulanıklığı',
        diagnosis: 'Katarakt şüphesi',
      },
    });

    doctorToken = await login(app, fixtures.tenantA.slug, DR_EMAIL, DR_PASS);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('doktor diğer doktorları listeleyemez → doctor.list 403', async () => {
    const res = await trpcQuery(app, doctorToken, 'doctor.list', { page: 1, pageSize: 50 });
    expect(res.status).toBe(403);
  });

  it('doktor yeni randevu veremez → appointment.create 403', async () => {
    const res = await trpcMutation(app, doctorToken, 'appointment.create', {
      patientId: assignedPatientId,
      doctorId: '00000000-0000-0000-0000-000000000000',
      type: 'consultation',
      startsAt: '2027-05-01T09:00:00.000Z',
      endsAt: '2027-05-01T09:30:00.000Z',
    });
    expect(res.status).toBe(403);
  });

  it('doktor KENDİ atanmış hastasını görür → patient.findById 200', async () => {
    const res = await trpcQuery(app, doctorToken, 'patient.findById', { id: assignedPatientId });
    expect(res.status).toBe(200);
  });

  it('doktor atanmamış hastaya erişemez → patient.findById 404', async () => {
    const res = await trpcQuery(app, doctorToken, 'patient.findById', {
      id: fixtures.tenantA.patientId,
    });
    expect(res.status).toBe(404);
  });

  it('doktor kendi profilini görebilir → doctor.myProfile 200', async () => {
    const res = await trpcQuery(app, doctorToken, 'doctor.myProfile', undefined);
    expect(res.status).toBe(200);
  });

  it('Geçmiş Muayeneler: doktor yalnız KENDİ muayenelerini görür → listMine ≥1', async () => {
    const res = await trpcQuery(app, doctorToken, 'examination.listMine', {
      page: 1,
      pageSize: 20,
    });
    expect(res.status).toBe(200);
    const data = (res.body as { result: { data: { total: number } } }).result.data;
    expect(data.total).toBeGreaterThanOrEqual(1);
  });

  it('Geçmiş Muayeneler: admin (muayenesi yok) → listMine total 0', async () => {
    const adminToken = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    const res = await trpcQuery(app, adminToken, 'examination.listMine', { page: 1, pageSize: 20 });
    expect(res.status).toBe(200);
    const data = (res.body as { result: { data: { total: number } } }).result.data;
    expect(data.total).toBe(0);
  });
});
