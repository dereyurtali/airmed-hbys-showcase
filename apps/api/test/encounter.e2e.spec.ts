import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

interface LoginBody {
  accessToken: string;
}
interface TrpcSuccess<T> {
  result: { data: T };
}
interface TrpcError {
  error: { json: { data?: { httpStatus?: number }; message: string } };
}
interface EncounterRow {
  id: string;
  stage: string;
  doctorId: string | null;
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

async function trpcMutation<T>(
  app: INestApplication,
  token: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: TrpcSuccess<T> | TrpcError }> {
  const res = await request(app.getHttpServer() as App)
    .post(`/api/trpc/${path}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  return { status: res.status, body: res.body as TrpcSuccess<T> | TrpcError };
}

async function trpcQuery<T>(
  app: INestApplication,
  token: string,
  path: string,
  input: unknown,
): Promise<{ status: number; body: TrpcSuccess<T> | TrpcError }> {
  const res = await request(app.getHttpServer() as App)
    .get(`/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body as TrpcSuccess<T> | TrpcError };
}

describe('S15 Encounter module (ziyaret akışı + ödeme kapısı + RLS)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let receptionToken: string;
  let tenantBAdminToken: string;
  let doctorAId: string;

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
    receptionToken = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.receptionistEmail!,
      fixtures.tenantA.receptionistPassword!,
    );
    tenantBAdminToken = await login(
      app,
      fixtures.tenantB.slug,
      fixtures.tenantB.adminEmail,
      fixtures.tenantB.adminPassword,
    );

    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const drA = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        name: 'TEST_S15_ Dr. Worklist',
        specialty: 'Göz',
        type: 'local',
      },
    });
    doctorAId = drA.id;
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.encounter.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.encounter.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.doctor.deleteMany({
      where: { tenantId: fixtures.tenantA.id, name: { contains: 'TEST_S15_' } },
    });
    await prisma.$disconnect();
    await app.close();
  });

  it('resepsiyon ziyaret açar → 200 + ödeme yokken awaiting_exam_payment', async () => {
    const res = await trpcMutation<EncounterRow>(app, receptionToken, 'encounter.open', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorAId,
      initialStation: 'examination',
    });
    expect(res.status).toBe(200);
    const created = (res.body as TrpcSuccess<EncounterRow>).result.data;
    expect(created.stage).toBe('awaiting_exam_payment');
  });

  it('ödeme kapısı: awaiting_exam_payment → waiting_doctor ödeme yokken 403', async () => {
    const open = await trpcMutation<EncounterRow>(app, receptionToken, 'encounter.open', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorAId,
      initialStation: 'examination',
    });
    const id = (open.body as TrpcSuccess<EncounterRow>).result.data.id;

    const res = await trpcMutation(app, receptionToken, 'encounter.advance', {
      id,
      toStage: 'waiting_doctor',
    });
    expect(res.status).toBe(403);
  });

  it('yasadışı geçiş: awaiting_exam_payment → in_exam → 400', async () => {
    const open = await trpcMutation<EncounterRow>(app, receptionToken, 'encounter.open', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorAId,
      initialStation: 'examination',
    });
    const id = (open.body as TrpcSuccess<EncounterRow>).result.data.id;

    const res = await trpcMutation(app, adminToken, 'encounter.advance', {
      id,
      toStage: 'in_exam',
    });
    expect(res.status).toBe(400);
  });

  it('iptal: awaiting_exam_payment → cancelled → 200', async () => {
    const open = await trpcMutation<EncounterRow>(app, receptionToken, 'encounter.open', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorAId,
      initialStation: 'examination',
    });
    const id = (open.body as TrpcSuccess<EncounterRow>).result.data.id;

    const res = await trpcMutation<EncounterRow>(app, adminToken, 'encounter.advance', {
      id,
      toStage: 'cancelled',
    });
    expect(res.status).toBe(200);
    expect((res.body as TrpcSuccess<EncounterRow>).result.data.stage).toBe('cancelled');
  });

  it('myWorklist: admin doctorId override ile aktif ziyaretleri döner', async () => {
    await prisma.encounter.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorAId,
        stage: 'waiting_doctor',
      },
    });
    const res = await trpcQuery<EncounterRow[]>(app, adminToken, 'encounter.myWorklist', {
      doctorId: doctorAId,
    });
    expect(res.status).toBe(200);
    const items = (res.body as TrpcSuccess<EncounterRow[]>).result.data;
    expect(items).toHaveLength(1);
    expect(items[0].stage).toBe('waiting_doctor');
  });

  it('startExam: randevudan in_exam köprüsü (200 + randevu in_progress)', async () => {
    const appt = await prisma.appointment.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorAId,
        type: 'consultation',
        startsAt: new Date('2027-03-01T09:00:00.000Z'),
        endsAt: new Date('2027-03-01T09:30:00.000Z'),
        status: 'checked_in',
      },
    });
    await prisma.encounter.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorAId,
        appointmentId: appt.id,
        stage: 'waiting_doctor',
      },
    });

    const res = await trpcMutation<EncounterRow>(app, adminToken, 'encounter.startExam', {
      appointmentId: appt.id,
    });
    expect(res.status).toBe(200);
    expect((res.body as TrpcSuccess<EncounterRow>).result.data.stage).toBe('in_exam');

    const after = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(after.status).toBe('in_progress');

    await prisma.encounter.deleteMany({ where: { appointmentId: appt.id } });
    await prisma.appointment.delete({ where: { id: appt.id } });
  });

  it('startExam: randevuya bağlı ziyaret yoksa 404', async () => {
    const res = await trpcMutation(app, adminToken, 'encounter.startExam', {
      appointmentId: '99999999-9999-9999-9999-999999999999',
    });
    expect(res.status).toBe(404);
  });

  it('receptionQueue: resepsiyon ödeme bekleyen ziyaretleri görür', async () => {
    await trpcMutation(app, receptionToken, 'encounter.open', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorAId,
      initialStation: 'examination',
    });
    const res = await trpcQuery<EncounterRow[]>(
      app,
      receptionToken,
      'encounter.receptionQueue',
      undefined,
    );
    expect(res.status).toBe(200);
    const items = (res.body as TrpcSuccess<EncounterRow[]>).result.data;
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.every((e) => e.stage === 'awaiting_exam_payment')).toBe(true);
  });

  it('RLS: tenant B admin, tenant A doktorunun kuyruğunu göremez (boş)', async () => {
    await prisma.encounter.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorAId,
        stage: 'waiting_doctor',
      },
    });
    const res = await trpcQuery<EncounterRow[]>(app, tenantBAdminToken, 'encounter.myWorklist', {
      doctorId: doctorAId,
    });
    expect(res.status).toBe(200);
    expect((res.body as TrpcSuccess<EncounterRow[]>).result.data).toEqual([]);
  });
});
