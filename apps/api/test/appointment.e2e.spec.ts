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

interface AppointmentRow {
  id: string;
  status: string;
  type: string;
  startsAt: string;
  endsAt: string;
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

describe('A6 Appointment module (tRPC + state machine + conflict detection)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let doctorAId: string;
  let doctorBId: string;

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

    // Two doctors so we can verify conflict detection only fires per-doctor.
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const drA = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        name: 'TEST_A6_ Dr. Conflict A',
        specialty: 'Göz',
        type: 'local',
      },
    });
    const drB = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        name: 'TEST_A6_ Dr. Conflict B',
        specialty: 'Göz',
        type: 'local',
      },
    });
    doctorAId = drA.id;
    doctorBId = drB.id;
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.appointment.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.appointment.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.doctor.deleteMany({
      where: { tenantId: fixtures.tenantA.id, name: { contains: 'TEST_A6_' } },
    });
    await prisma.$disconnect();
    await app.close();
  });

  // -- Golden path --------------------------------------------------------

  it('admin creates a scheduled appointment → 200 + persists with default status', async () => {
    const res = await trpcMutation<AppointmentRow>(app, adminToken, 'appointment.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorAId,
      type: 'consultation',
      startsAt: '2026-06-01T09:00:00.000Z',
      endsAt: '2026-06-01T09:30:00.000Z',
    });
    expect(res.status).toBe(200);
    const created = (res.body as TrpcSuccess<AppointmentRow>).result.data;
    expect(created.id).toEqual(expect.any(String));
    expect(created.status).toBe('scheduled');
    expect(created.type).toBe('consultation');
  });

  it('list filters by doctor + date range', async () => {
    await trpcMutation(app, adminToken, 'appointment.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorAId,
      type: 'control',
      startsAt: '2026-06-02T09:00:00.000Z',
      endsAt: '2026-06-02T09:30:00.000Z',
    });
    await trpcMutation(app, adminToken, 'appointment.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorBId,
      type: 'consultation',
      startsAt: '2026-06-02T10:00:00.000Z',
      endsAt: '2026-06-02T10:30:00.000Z',
    });

    const res = await trpcQuery<{ items: AppointmentRow[]; total: number }>(
      app,
      adminToken,
      'appointment.list',
      { doctorId: doctorAId, page: 1, pageSize: 50 },
    );
    expect(res.status).toBe(200);
    const data = (res.body as TrpcSuccess<{ items: AppointmentRow[]; total: number }>).result.data;
    expect(data.total).toBe(1);
    expect(data.items[0].type).toBe('control');
  });

  it('findInRange returns appointments overlapping the window', async () => {
    await trpcMutation(app, adminToken, 'appointment.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorAId,
      type: 'consultation',
      startsAt: '2026-06-03T09:00:00.000Z',
      endsAt: '2026-06-03T09:30:00.000Z',
    });

    const res = await trpcQuery<AppointmentRow[]>(app, adminToken, 'appointment.findInRange', {
      dateFrom: '2026-06-03T08:00:00.000Z',
      dateTo: '2026-06-03T18:00:00.000Z',
    });
    expect(res.status).toBe(200);
    const items = (res.body as TrpcSuccess<AppointmentRow[]>).result.data;
    expect(items).toHaveLength(1);
  });

  // -- Conflict detection -------------------------------------------------

  it('overlapping create on the same doctor → 409 conflict', async () => {
    const ok = await trpcMutation(app, adminToken, 'appointment.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorAId,
      type: 'consultation',
      startsAt: '2026-06-04T09:00:00.000Z',
      endsAt: '2026-06-04T10:00:00.000Z',
    });
    expect(ok.status).toBe(200);

    const conflict = await trpcMutation(app, adminToken, 'appointment.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorAId,
      type: 'consultation',
      startsAt: '2026-06-04T09:30:00.000Z',
      endsAt: '2026-06-04T10:30:00.000Z',
    });
    expect(conflict.status).toBe(409);
  });

  it('cancelled appointments do NOT block re-booking the same slot', async () => {
    const created = await trpcMutation<AppointmentRow>(app, adminToken, 'appointment.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorAId,
      type: 'consultation',
      startsAt: '2026-06-05T09:00:00.000Z',
      endsAt: '2026-06-05T10:00:00.000Z',
    });
    const id = (created.body as TrpcSuccess<AppointmentRow>).result.data.id;

    const cancelled = await trpcMutation(app, adminToken, 'appointment.cancel', { id });
    expect(cancelled.status).toBe(200);

    const rebook = await trpcMutation(app, adminToken, 'appointment.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorAId,
      type: 'consultation',
      startsAt: '2026-06-05T09:00:00.000Z',
      endsAt: '2026-06-05T10:00:00.000Z',
    });
    expect(rebook.status).toBe(200);
  });

  it('overlap on a DIFFERENT doctor is allowed', async () => {
    await trpcMutation(app, adminToken, 'appointment.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorAId,
      type: 'consultation',
      startsAt: '2026-06-06T09:00:00.000Z',
      endsAt: '2026-06-06T10:00:00.000Z',
    });
    const otherDoc = await trpcMutation(app, adminToken, 'appointment.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorBId,
      type: 'consultation',
      startsAt: '2026-06-06T09:00:00.000Z',
      endsAt: '2026-06-06T10:00:00.000Z',
    });
    expect(otherDoc.status).toBe(200);
  });

  // -- State machine ------------------------------------------------------

  it('legal transition: scheduled → checked_in → completed', async () => {
    const created = await trpcMutation<AppointmentRow>(app, adminToken, 'appointment.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorAId,
      type: 'consultation',
      startsAt: '2026-06-07T09:00:00.000Z',
      endsAt: '2026-06-07T09:30:00.000Z',
    });
    const id = (created.body as TrpcSuccess<AppointmentRow>).result.data.id;

    const checkedIn = await trpcMutation<AppointmentRow>(app, adminToken, 'appointment.checkIn', {
      id,
    });
    expect(checkedIn.status).toBe(200);
    expect((checkedIn.body as TrpcSuccess<AppointmentRow>).result.data.status).toBe('checked_in');

    const done = await trpcMutation<AppointmentRow>(app, adminToken, 'appointment.markDone', {
      id,
    });
    expect(done.status).toBe(200);
    expect((done.body as TrpcSuccess<AppointmentRow>).result.data.status).toBe('completed');
  });

  it('illegal transition: scheduled → completed → 400', async () => {
    const created = await trpcMutation<AppointmentRow>(app, adminToken, 'appointment.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorAId,
      type: 'consultation',
      startsAt: '2026-06-08T09:00:00.000Z',
      endsAt: '2026-06-08T09:30:00.000Z',
    });
    const id = (created.body as TrpcSuccess<AppointmentRow>).result.data.id;

    const illegal = await trpcMutation(app, adminToken, 'appointment.markDone', { id });
    expect(illegal.status).toBe(400);
  });

  it('illegal transition: terminal status → any → 400', async () => {
    const created = await trpcMutation<AppointmentRow>(app, adminToken, 'appointment.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorAId,
      type: 'consultation',
      startsAt: '2026-06-09T09:00:00.000Z',
      endsAt: '2026-06-09T09:30:00.000Z',
    });
    const id = (created.body as TrpcSuccess<AppointmentRow>).result.data.id;

    await trpcMutation(app, adminToken, 'appointment.cancel', { id });
    const reanimate = await trpcMutation(app, adminToken, 'appointment.checkIn', { id });
    expect(reanimate.status).toBe(400);
  });

  // -- Update -------------------------------------------------------------

  it('update only allowed while scheduled; checked_in update → 400', async () => {
    const created = await trpcMutation<AppointmentRow>(app, adminToken, 'appointment.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorAId,
      type: 'consultation',
      startsAt: '2026-06-10T09:00:00.000Z',
      endsAt: '2026-06-10T09:30:00.000Z',
    });
    const id = (created.body as TrpcSuccess<AppointmentRow>).result.data.id;
    await trpcMutation(app, adminToken, 'appointment.checkIn', { id });

    const blocked = await trpcMutation(app, adminToken, 'appointment.update', {
      id,
      data: { notes: 'late edit' },
    });
    expect(blocked.status).toBe(400);
  });

  // -- Concurrency --------------------------------------------------------

  it('5 parallel creates of the same slot → only one succeeds', async () => {
    const requests = Array.from({ length: 5 }, () =>
      trpcMutation(app, adminToken, 'appointment.create', {
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorAId,
        type: 'consultation',
        startsAt: '2026-06-11T09:00:00.000Z',
        endsAt: '2026-06-11T10:00:00.000Z',
      }),
    );
    const results = await Promise.all(requests);
    const ok = results.filter((r) => r.status === 200);
    const conflicts = results.filter((r) => r.status === 409);
    expect(ok).toHaveLength(1);
    expect(conflicts).toHaveLength(4);
  });

  // -- Validation ---------------------------------------------------------

  it('rejects reversed startsAt/endsAt at the schema level → 400', async () => {
    const bad = await trpcMutation(app, adminToken, 'appointment.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorAId,
      type: 'consultation',
      startsAt: '2026-06-12T10:00:00.000Z',
      endsAt: '2026-06-12T09:00:00.000Z',
    });
    expect(bad.status).toBe(400);
  });

  it('rejects unknown patientId → 404', async () => {
    const ghost = await trpcMutation(app, adminToken, 'appointment.create', {
      patientId: '00000000-0000-0000-0000-000000000000',
      doctorId: doctorAId,
      type: 'consultation',
      startsAt: '2026-06-13T09:00:00.000Z',
      endsAt: '2026-06-13T09:30:00.000Z',
    });
    expect(ghost.status).toBe(404);
  });
});
