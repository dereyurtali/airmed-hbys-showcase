import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  resetAndSeedFixtures,
  seedPaidInvoiceForCategory,
  type IsolationFixtures,
} from './fixtures';
import { createTestApp } from './test-app';

interface LoginBody {
  accessToken: string;
}

interface TrpcSuccess<T> {
  result: { data: T };
}

interface ExaminationRow {
  id: string;
  patientId: string;
  doctorId: string;
  diagnosis: string | null;
  findings: Record<string, unknown>;
  examinedAt: string;
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

async function trpcMutation<T>(app: INestApplication, token: string, path: string, body: unknown) {
  const res = await request(app.getHttpServer() as App)
    .post(`/api/trpc/${path}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  return { status: res.status, body: res.body as TrpcSuccess<T> };
}

async function trpcQuery<T>(app: INestApplication, token: string, path: string, input: unknown) {
  const res = await request(app.getHttpServer() as App)
    .get(`/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body as TrpcSuccess<T> };
}

describe('A7 Examination (tRPC + RBAC same-day window)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let doctorToken: string;
  let doctorUserId: string;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

    adminToken = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );

    // Spin up a doktor-rol user in tenant A so we can probe the same-day
    // edit window.
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const doktorRole = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: fixtures.tenantA.id, key: 'doktor' } },
    });
    const doctorEmail = 'doktor@a-exam.test';
    const doctorPassword = 'doktor-pass-1234';
    const hash = await bcrypt.hash(doctorPassword, 4);
    const doctorUser = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: doctorEmail,
        passwordHash: hash,
        name: 'Dr. Exam Test',
        status: 'active',
      },
    });
    doctorUserId = doctorUser.id;
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: doctorUser.id, roleId: doktorRole.id },
    });
    doctorToken = await login(app, fixtures.tenantA.slug, doctorEmail, doctorPassword);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.examination.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    // S12c — assertPaidSession bypass için günlük paid invoice seed.
    await prisma.invoiceItem.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.invoice.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await seedPaidInvoiceForCategory(
      prisma,
      fixtures.tenantA.id,
      fixtures.tenantA.patientId,
      'examination',
      doctorUserId,
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('create golden + findById include patient + doctor', async () => {
    const create = await trpcMutation<ExaminationRow>(app, doctorToken, 'examination.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorUserId,
      examinedAt: new Date().toISOString(),
      chiefComplaint: 'Bulanık görme',
      diagnosis: 'Miyopi',
      findings: { odVa: '0.8', osVa: '0.7' },
    });
    expect(create.status).toBe(200);
    const id = create.body.result.data.id;

    const findRes = await trpcQuery<{
      patient: { firstName: string };
      doctor: { name: string };
      findings: Record<string, unknown>;
    }>(app, doctorToken, 'examination.findById', { id });
    expect(findRes.status).toBe(200);
    expect(findRes.body.result.data.patient.firstName).toBeDefined();
    expect(findRes.body.result.data.doctor.name).toBe('Dr. Exam Test');
    expect(findRes.body.result.data.findings.odVa).toBe('0.8');
  });

  it('listByPatient orders desc and filters tenant', async () => {
    await prisma.examination.createMany({
      data: [
        {
          tenantId: fixtures.tenantA.id,
          patientId: fixtures.tenantA.patientId,
          doctorId: doctorUserId,
          examinedAt: new Date('2026-04-01'),
          diagnosis: 'older',
        },
        {
          tenantId: fixtures.tenantA.id,
          patientId: fixtures.tenantA.patientId,
          doctorId: doctorUserId,
          examinedAt: new Date('2026-05-01'),
          diagnosis: 'newer',
        },
      ],
    });
    const res = await trpcQuery<ExaminationRow[]>(app, doctorToken, 'examination.listByPatient', {
      patientId: fixtures.tenantA.patientId,
    });
    expect(res.status).toBe(200);
    const items = res.body.result.data;
    expect(items).toHaveLength(2);
    expect(items[0]!.diagnosis).toBe('newer');
  });

  it('same-day update by owning doctor → 200', async () => {
    const created = await prisma.examination.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorUserId,
        examinedAt: new Date(),
        diagnosis: 'initial',
      },
    });
    const res = await trpcMutation(app, doctorToken, 'examination.update', {
      id: created.id,
      data: { diagnosis: 'revised' },
    });
    expect(res.status).toBe(200);
  });

  it('next-day update by owning doctor → 400 (same-day window expired)', async () => {
    const created = await prisma.examination.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorUserId,
        examinedAt: new Date(Date.now() - 48 * 60 * 60 * 1000), // 2 gün önce
        diagnosis: 'old',
      },
    });
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/examination.update')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ id: created.id, data: { diagnosis: 'attempt' } });
    expect(res.status).toBe(400);
  });

  it('next-day update by yonetici → 403 (karar tutanağı §6.2: tıbbi veri sadece doktor)', async () => {
    // S3/S9 — Yönetici examination.update yapamaz (yasal sorumluluk: tıbbi
    // veri tıbbi yetkili dışında düzenlenmez). Aynı kullanıcının birden fazla
    // rol alamayacağı kuralıyla (karar 8) zaten çatışmaz: yönetici aynı zamanda
    // doktor olmalıysa ayrı doktor user'ı kurulur.
    const created = await prisma.examination.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorUserId,
        examinedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        diagnosis: 'old',
      },
    });
    const res = await trpcMutation(app, adminToken, 'examination.update', {
      id: created.id,
      data: { diagnosis: 'admin-edit' },
    });
    expect(res.status).toBe(403);
  });

  it('appointmentId @unique: second examination on same appointment → 400', async () => {
    // Önce bir randevu yarat (admin yetkisiyle, appointment.create üzerinden)
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const doctorProfile = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        name: 'TEST_A7 Hekim',
        specialty: 'Göz',
        type: 'local',
      },
    });
    const appointment = await prisma.appointment.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfile.id,
        type: 'consultation',
        status: 'completed',
        startsAt: new Date('2026-06-01T09:00:00.000Z'),
        endsAt: new Date('2026-06-01T09:30:00.000Z'),
      },
    });

    const first = await trpcMutation<ExaminationRow>(app, doctorToken, 'examination.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorUserId,
      appointmentId: appointment.id,
      examinedAt: new Date().toISOString(),
    });
    expect(first.status).toBe(200);

    const second = await request(app.getHttpServer() as App)
      .post('/api/trpc/examination.create')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorUserId,
        appointmentId: appointment.id,
        examinedAt: new Date().toISOString(),
      });
    expect(second.status).toBe(400);
  });

  it('cross-tenant: tenant B user cannot read tenant A examination (RLS)', async () => {
    const created = await prisma.examination.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorUserId,
        examinedAt: new Date(),
        diagnosis: 'tenant-A only',
      },
    });
    const tokenB = await login(
      app,
      fixtures.tenantB.slug,
      fixtures.tenantB.adminEmail,
      fixtures.tenantB.adminPassword,
    );
    const res = await request(app.getHttpServer() as App)
      .get(
        `/api/trpc/examination.findById?input=${encodeURIComponent(JSON.stringify({ id: created.id }))}`,
      )
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });
});
