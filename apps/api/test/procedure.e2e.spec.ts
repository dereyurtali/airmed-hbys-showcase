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

interface ProcedureRow {
  id: string;
  type: string;
  status: string;
  eyeSide: string;
  drugUsed: string | null;
  drugDose: string | null;
  performedAt: string;
  followUpAppointment: { id: string; startsAt: string } | null;
  postProcedureControlDate: string | null;
  followUpSkipped?: boolean;
  doctor: { id: string; name: string; userId: string | null };
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

async function trpcQuery<T>(app: INestApplication, token: string, route: string, input: unknown) {
  const url = `/api/trpc/${route}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await request(app.getHttpServer() as App)
    .get(url)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body as TrpcSuccess<T> };
}

describe('B5 Procedure (tRPC + RBAC + auto follow-up)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let doctorToken: string;
  let otherDoctorToken: string;
  let receptionToken: string;
  let doctorProfileId: string;
  let otherDoctorProfileId: string;
  let adminUserId: string;

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
    const adminUser = await prisma.user.findFirst({
      where: { tenantId: fixtures.tenantA.id, email: fixtures.tenantA.adminEmail },
      select: { id: true },
    });
    adminUserId = adminUser!.id;

    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const doktorRole = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: fixtures.tenantA.id, key: 'doktor' } },
    });

    // doktor1 (operating)
    const hash = await bcrypt.hash('doktor-pass-1234', 4);
    const d1 = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: 'doktor1@a-proc.test',
        passwordHash: hash,
        name: 'Dr. Procedure One',
        status: 'active',
      },
    });
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: d1.id, roleId: doktorRole.id },
    });
    const dp1 = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        userId: d1.id,
        name: 'Dr. Procedure One',
        specialty: 'Retina',
        isActive: true,
      },
    });
    doctorProfileId = dp1.id;
    doctorToken = await login(
      app,
      fixtures.tenantA.slug,
      'doktor1@a-proc.test',
      'doktor-pass-1234',
    );

    // doktor2 (sahibi olmadığı prosedürü editlemeye çalışacak)
    const d2 = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: 'doktor2@a-proc.test',
        passwordHash: hash,
        name: 'Dr. Procedure Two',
        status: 'active',
      },
    });
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: d2.id, roleId: doktorRole.id },
    });
    const dp2 = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        userId: d2.id,
        name: 'Dr. Procedure Two',
        specialty: 'Anterior',
        isActive: true,
      },
    });
    otherDoctorProfileId = dp2.id;
    otherDoctorToken = await login(
      app,
      fixtures.tenantA.slug,
      'doktor2@a-proc.test',
      'doktor-pass-1234',
    );

    receptionToken = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.receptionistEmail!,
      fixtures.tenantA.receptionistPassword!,
    );
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.procedure.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.appointment.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    // Delta audit C-1 — procedure.create artık assertPaidSession('procedure')
    // çağırıyor (S12c paritesi). Test fixture'a günlük paid invoice seed:
    await prisma.invoiceItem.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.invoice.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await seedPaidInvoiceForCategory(
      prisma,
      fixtures.tenantA.id,
      fixtures.tenantA.patientId,
      'procedure',
      adminUserId,
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // IVT performedAt (artık 1 dakika eklenmiş — paralel testlerde slot
  // çakışmasını minimize etmek için her testte farklı saat seç).
  const futurePerformedAt = (minutesAhead = 60): string =>
    new Date(Date.now() + minutesAhead * 60_000).toISOString();

  it('admin create IVT golden + auto follow-up appointment yaratılır', async () => {
    const res = await trpcMutation<ProcedureRow>(app, adminToken, 'procedure.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorProfileId,
      type: 'intravitreal_injection',
      eyeSide: 'od',
      drugUsed: 'Lucentis',
      drugDose: '0.5 mg',
      performedAt: futurePerformedAt(60),
      autoScheduleFollowUp: true,
      followUpDaysFromNow: 7,
    });
    expect(res.status).toBe(200);
    const proc = res.body.result.data;
    expect(proc.type).toBe('intravitreal_injection');
    expect(proc.drugUsed).toBe('Lucentis');
    expect(proc.followUpAppointment).not.toBeNull();
    expect(proc.followUpSkipped).toBeFalsy();
    expect(proc.postProcedureControlDate).not.toBeNull();

    // Appointment'ı doğrula
    const followUpId = proc.followUpAppointment!.id;
    const appt = await prisma.appointment.findUnique({ where: { id: followUpId } });
    expect(appt?.type).toBe('control');
    expect(appt?.status).toBe('scheduled');
  });

  it('doktor kendi prosedürünü create edebilir', async () => {
    const res = await trpcMutation<ProcedureRow>(app, doctorToken, 'procedure.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorProfileId,
      type: 'yag_capsulotomy',
      eyeSide: 'os',
      performedAt: futurePerformedAt(120),
      settings: { energy_mj: 1.4, pulse_count: 30 },
      autoScheduleFollowUp: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.type).toBe('yag_capsulotomy');
  });

  it('doktor başka doktorun prosedürünü create edemez → 403', async () => {
    const res = await trpcMutation<unknown>(app, doctorToken, 'procedure.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: otherDoctorProfileId,
      type: 'intravitreal_injection',
      eyeSide: 'od',
      performedAt: futurePerformedAt(180),
    });
    expect(res.status).toBe(403);
  });

  it('resepsiyon prosedür oluşturamaz → 403', async () => {
    const res = await trpcMutation<unknown>(app, receptionToken, 'procedure.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorProfileId,
      type: 'intravitreal_injection',
      eyeSide: 'od',
      performedAt: futurePerformedAt(240),
    });
    expect(res.status).toBe(403);
  });

  it('autoScheduleFollowUp=false → follow-up appointment yok', async () => {
    const res = await trpcMutation<ProcedureRow>(app, adminToken, 'procedure.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorProfileId,
      type: 'minor',
      eyeSide: 'ou',
      performedAt: futurePerformedAt(300),
      autoScheduleFollowUp: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.followUpAppointment).toBeNull();
    expect(res.body.result.data.postProcedureControlDate).toBeNull();
  });

  it('list patientId filtresi sadece o hastanın kayıtlarını döner', async () => {
    await trpcMutation<ProcedureRow>(app, adminToken, 'procedure.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorProfileId,
      type: 'argon_laser',
      eyeSide: 'od',
      performedAt: futurePerformedAt(360),
      autoScheduleFollowUp: false,
    });
    const res = await trpcQuery<ProcedureRow[]>(app, doctorToken, 'procedure.list', {
      patientId: fixtures.tenantA.patientId,
      limit: 10,
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.result.data.every((p) => p.type === 'argon_laser')).toBe(true);
  });

  it('series: IVT seans takibi performedAt asc döner', async () => {
    await trpcMutation<ProcedureRow>(app, adminToken, 'procedure.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorProfileId,
      type: 'intravitreal_injection',
      eyeSide: 'od',
      drugUsed: 'Lucentis',
      performedAt: futurePerformedAt(420),
      autoScheduleFollowUp: false,
    });
    await trpcMutation<ProcedureRow>(app, adminToken, 'procedure.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorProfileId,
      type: 'intravitreal_injection',
      eyeSide: 'od',
      drugUsed: 'Eylea',
      performedAt: futurePerformedAt(480),
      autoScheduleFollowUp: false,
    });
    const res = await trpcQuery<{ drugUsed: string | null; performedAt: string }[]>(
      app,
      doctorToken,
      'procedure.series',
      { patientId: fixtures.tenantA.patientId, type: 'intravitreal_injection' },
    );
    expect(res.status).toBe(200);
    expect(res.body.result.data).toHaveLength(2);
    expect(res.body.result.data[0]!.drugUsed).toBe('Lucentis'); // önce yapılan önde
    expect(res.body.result.data[1]!.drugUsed).toBe('Eylea');
  });

  it('update: kendi prosedürünü doktor güncelleyebilir', async () => {
    const created = await trpcMutation<ProcedureRow>(app, doctorToken, 'procedure.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorProfileId,
      type: 'slt',
      eyeSide: 'os',
      performedAt: futurePerformedAt(540),
      autoScheduleFollowUp: false,
    });
    const upd = await trpcMutation<ProcedureRow>(app, doctorToken, 'procedure.update', {
      id: created.body.result.data.id,
      data: { complications: 'Hafif geçici IOP artışı', status: 'performed' },
    });
    expect(upd.status).toBe(200);
  });

  it('update: başka doktor 403', async () => {
    const created = await trpcMutation<ProcedureRow>(app, doctorToken, 'procedure.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorProfileId,
      type: 'slt',
      eyeSide: 'os',
      performedAt: futurePerformedAt(600),
      autoScheduleFollowUp: false,
    });
    const upd = await trpcMutation<unknown>(app, otherDoctorToken, 'procedure.update', {
      id: created.body.result.data.id,
      data: { notes: 'değiştirmeye çalışıyorum' },
    });
    expect(upd.status).toBe(403);
  });

  it('softDelete: follow-up appointment da soft-delete olur', async () => {
    const created = await trpcMutation<ProcedureRow>(app, adminToken, 'procedure.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorProfileId,
      type: 'cross_linking',
      eyeSide: 'od',
      performedAt: futurePerformedAt(660),
      autoScheduleFollowUp: true,
    });
    const followUpId = created.body.result.data.followUpAppointment!.id;
    const del = await trpcMutation<{ ok: true }>(app, adminToken, 'procedure.softDelete', {
      id: created.body.result.data.id,
    });
    expect(del.status).toBe(200);

    const appt = await prisma.appointment.findUnique({ where: { id: followUpId } });
    expect(appt?.deletedAt).not.toBeNull();
  });

  it('cross-tenant RLS: tenantB admin tenantA prosedürünü okuyamaz', async () => {
    const created = await trpcMutation<ProcedureRow>(app, adminToken, 'procedure.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorProfileId,
      type: 'minor',
      eyeSide: 'ou',
      performedAt: futurePerformedAt(720),
      autoScheduleFollowUp: false,
    });
    const tokenB = await login(
      app,
      fixtures.tenantB.slug,
      fixtures.tenantB.adminEmail,
      fixtures.tenantB.adminPassword,
    );
    const res = await trpcQuery<unknown>(app, tokenB, 'procedure.findById', {
      id: created.body.result.data.id,
    });
    expect(res.status).toBe(404);
  });
});
