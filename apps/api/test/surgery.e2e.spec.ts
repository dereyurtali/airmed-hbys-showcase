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

interface SurgeryRow {
  id: string;
  patientId: string;
  doctorId: string;
  type: string;
  status: string;
  scheduledAt: string;
  performedAt: string | null;
  preOp: Record<string, unknown>;
  intraOp: Record<string, unknown>;
  postOp: Record<string, unknown>;
  complicationFlag: boolean;
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

describe('A8 Surgery (tRPC + RBAC same-day window on performedAt)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let doctorToken: string;
  let doctorUserId: string;
  let doctorProfileId: string;

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

    // Spin up a doktor-rol user + Doctor profile linked via userId for tenant A.
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const doktorRole = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: fixtures.tenantA.id, key: 'doktor' } },
    });
    const doctorEmail = 'doktor@a-surgery.test';
    const doctorPassword = 'doktor-pass-1234';
    const hash = await bcrypt.hash(doctorPassword, 4);
    const doctorUser = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: doctorEmail,
        passwordHash: hash,
        name: 'Dr. Surgery Test',
        status: 'active',
      },
    });
    doctorUserId = doctorUser.id;
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: doctorUser.id, roleId: doktorRole.id },
    });
    const doctorProfile = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        userId: doctorUser.id,
        name: 'Dr. Surgery Test',
        specialty: 'Göz',
        type: 'local',
      },
    });
    doctorProfileId = doctorProfile.id;
    doctorToken = await login(app, fixtures.tenantA.slug, doctorEmail, doctorPassword);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.surgery.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    // S12c — assertPaidSession bypass için günlük paid invoice seed.
    await prisma.invoiceItem.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.invoice.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await seedPaidInvoiceForCategory(
      prisma,
      fixtures.tenantA.id,
      fixtures.tenantA.patientId,
      'surgery',
      doctorUserId,
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('create golden + findById include patient + doctor', async () => {
    const create = await trpcMutation<SurgeryRow>(app, doctorToken, 'surgery.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorProfileId,
      type: 'Cataract / Phaco',
      scheduledAt: new Date('2026-06-01T09:00:00.000Z').toISOString(),
      preOp: { lens: 'IOL-AC-101', anesthesia: 'topical' },
    });
    expect(create.status).toBe(200);
    const id = create.body.result.data.id;
    expect(create.body.result.data.status).toBe('planned');

    const findRes = await trpcQuery<{
      patient: { firstName: string };
      doctor: { name: string; userId: string };
      preOp: Record<string, unknown>;
    }>(app, doctorToken, 'surgery.findById', { id });
    expect(findRes.status).toBe(200);
    expect(findRes.body.result.data.patient.firstName).toBeDefined();
    expect(findRes.body.result.data.doctor.name).toBe('Dr. Surgery Test');
    expect(findRes.body.result.data.preOp.lens).toBe('IOL-AC-101');
  });

  it('listByPatient orders desc and filters tenant', async () => {
    await prisma.surgery.createMany({
      data: [
        {
          tenantId: fixtures.tenantA.id,
          patientId: fixtures.tenantA.patientId,
          doctorId: doctorProfileId,
          type: 'Cataract',
          status: 'performed',
          scheduledAt: new Date('2026-04-01'),
          performedAt: new Date('2026-04-01'),
        },
        {
          tenantId: fixtures.tenantA.id,
          patientId: fixtures.tenantA.patientId,
          doctorId: doctorProfileId,
          type: 'YAG capsulotomy',
          status: 'planned',
          scheduledAt: new Date('2026-05-01'),
        },
      ],
    });
    const res = await trpcQuery<SurgeryRow[]>(app, doctorToken, 'surgery.listByPatient', {
      patientId: fixtures.tenantA.patientId,
    });
    expect(res.status).toBe(200);
    const items = res.body.result.data;
    expect(items).toHaveLength(2);
    expect(items[0]!.type).toBe('YAG capsulotomy');
  });

  it('update planned surgery (no performedAt) by owning surgeon → 200, window not applied', async () => {
    const created = await prisma.surgery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        type: 'Cataract',
        status: 'planned',
        scheduledAt: new Date('2025-01-01'), // bir yıl önce planlanmış, hâlâ planned
      },
    });
    const res = await trpcMutation(app, doctorToken, 'surgery.update', {
      id: created.id,
      data: { type: 'Cataract / Phaco' },
    });
    expect(res.status).toBe(200);
  });

  it('update performed surgery within 24h by owning surgeon → 200', async () => {
    const created = await prisma.surgery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        type: 'Cataract',
        status: 'performed',
        scheduledAt: new Date(),
        performedAt: new Date(), // şimdi performed
      },
    });
    const res = await trpcMutation(app, doctorToken, 'surgery.update', {
      id: created.id,
      data: { complicationFlag: true, complicationNotes: 'minor reflux' },
    });
    expect(res.status).toBe(200);
  });

  it('update performed surgery older than 24h by owning surgeon → 400 (window expired)', async () => {
    const created = await prisma.surgery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        type: 'Cataract',
        status: 'performed',
        scheduledAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        performedAt: new Date(Date.now() - 48 * 60 * 60 * 1000), // 2 gün önce
      },
    });
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/surgery.update')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ id: created.id, data: { complicationNotes: 'late edit' } });
    expect(res.status).toBe(400);
  });

  it('next-day update by yonetici (admin) → 200 override', async () => {
    const created = await prisma.surgery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        type: 'Cataract',
        status: 'performed',
        scheduledAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        performedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      },
    });
    const res = await trpcMutation(app, adminToken, 'surgery.update', {
      id: created.id,
      data: { complicationNotes: 'admin-edit' },
    });
    expect(res.status).toBe(200);
  });

  it('appointmentId @unique: second surgery on same appointment → 400', async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const appointment = await prisma.appointment.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        type: 'surgery',
        status: 'scheduled',
        startsAt: new Date('2026-06-15T09:00:00.000Z'),
        endsAt: new Date('2026-06-15T10:00:00.000Z'),
      },
    });

    const first = await trpcMutation<SurgeryRow>(app, doctorToken, 'surgery.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorProfileId,
      appointmentId: appointment.id,
      type: 'Cataract',
      scheduledAt: new Date('2026-06-15T09:00:00.000Z').toISOString(),
    });
    expect(first.status).toBe(200);

    const second = await request(app.getHttpServer() as App)
      .post('/api/trpc/surgery.create')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        appointmentId: appointment.id,
        type: 'Cataract',
        scheduledAt: new Date('2026-06-15T09:00:00.000Z').toISOString(),
      });
    expect(second.status).toBe(400);
  });

  it('cross-tenant: tenant B user cannot read tenant A surgery (RLS)', async () => {
    const created = await prisma.surgery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        type: 'Cataract',
        status: 'planned',
        scheduledAt: new Date(),
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
        `/api/trpc/surgery.findById?input=${encodeURIComponent(JSON.stringify({ id: created.id }))}`,
      )
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });
});
