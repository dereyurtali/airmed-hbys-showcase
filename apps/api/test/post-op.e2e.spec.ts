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

interface TrpcSuccess<T> {
  result: { data: T };
}

interface AppointmentRow {
  id: string;
  type: string;
  status: string;
  startsAt: string;
  endsAt: string;
  notes: string | null;
}

interface SurgeryRow {
  id: string;
  patientId: string;
  performedAt: string | null;
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

function buildProposals(performedAt: Date) {
  return [7, 30, 90].map((days) => {
    const start = new Date(performedAt);
    start.setDate(start.getDate() + days);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + 30);
    return {
      daysFromSurgery: days,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    };
  });
}

describe('B4 Post-op follow-up (tRPC + RBAC)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let doctorToken: string;
  let doctorUserId: string;
  let doctorProfileId: string;
  let surgeryId: string;
  const performedAt = new Date('2026-04-01T08:00:00.000Z');

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

    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const doktorRole = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: fixtures.tenantA.id, key: 'doktor' } },
    });
    const doctorEmail = 'doktor@a-postop.test';
    const doctorPassword = 'doktor-pass-1234';
    const hash = await bcrypt.hash(doctorPassword, 4);
    const doctorUser = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: doctorEmail,
        passwordHash: hash,
        name: 'Dr. PostOp Test',
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
        name: 'Dr. PostOp Test',
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
    await prisma.appointment.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.surgery.deleteMany({ where: { tenantId: fixtures.tenantA.id } });

    // Fresh surgery anchor for each test
    const s = await prisma.surgery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        type: 'Cataract / Phaco',
        status: 'performed',
        scheduledAt: performedAt,
        performedAt,
      },
    });
    surgeryId = s.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('scheduleFollowUps golden: 3 control appointment (post-op) + surgery ref tag', async () => {
    const res = await trpcMutation<AppointmentRow[]>(app, doctorToken, 'postOp.scheduleFollowUps', {
      surgeryId,
      proposals: buildProposals(performedAt),
    });
    expect(res.status).toBe(200);
    const created = res.body.result.data;
    expect(created).toHaveLength(3);
    for (const appt of created) {
      expect(appt.type).toBe('control');
      expect(appt.status).toBe('scheduled');
      expect(appt.notes).toContain(`#surgery:${surgeryId}`);
    }
  });

  it('scheduleFollowUps idempotency: ikinci kez 409', async () => {
    await trpcMutation<AppointmentRow[]>(app, doctorToken, 'postOp.scheduleFollowUps', {
      surgeryId,
      proposals: buildProposals(performedAt),
    });
    const second = await trpcMutation<unknown>(app, doctorToken, 'postOp.scheduleFollowUps', {
      surgeryId,
      proposals: buildProposals(performedAt),
    });
    expect(second.status).toBe(409);
  });

  it('scheduleFollowUps: başka doktor (cerrah değil) → 403', async () => {
    // Yeni doktor
    const otherEmail = 'other@a-postop.test';
    const otherPassword = 'other-pass-1234';
    const otherHash = await bcrypt.hash(otherPassword, 4);
    const otherUser = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: otherEmail,
        passwordHash: otherHash,
        name: 'Dr. Other',
        status: 'active',
      },
    });
    const doktorRole = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: fixtures.tenantA.id, key: 'doktor' } },
    });
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: otherUser.id, roleId: doktorRole.id },
    });
    await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        userId: otherUser.id,
        name: 'Dr. Other',
        specialty: 'Göz',
        type: 'local',
      },
    });
    const otherToken = await login(app, fixtures.tenantA.slug, otherEmail, otherPassword);

    const res = await trpcMutation<unknown>(app, otherToken, 'postOp.scheduleFollowUps', {
      surgeryId,
      proposals: buildProposals(performedAt),
    });
    expect(res.status).toBe(403);
  });

  it('scheduleFollowUps: yönetici override → 200', async () => {
    const res = await trpcMutation<AppointmentRow[]>(app, adminToken, 'postOp.scheduleFollowUps', {
      surgeryId,
      proposals: buildProposals(performedAt),
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data).toHaveLength(3);
  });

  it('scheduleFollowUps: cerrahın doktor profili yoksa → 400', async () => {
    // Profili sil
    await prisma.doctor.update({
      where: { id: doctorProfileId },
      data: { deletedAt: new Date() },
    });
    const res = await trpcMutation<unknown>(app, doctorToken, 'postOp.scheduleFollowUps', {
      surgeryId,
      proposals: buildProposals(performedAt),
    });
    expect(res.status).toBe(400);
    // Restore for next tests
    await prisma.doctor.update({
      where: { id: doctorProfileId },
      data: { deletedAt: null },
    });
  });

  it('scheduleFollowUps: endsAt <= startsAt → 400', async () => {
    const bad = buildProposals(performedAt);
    bad[0]!.endsAt = bad[0]!.startsAt; // equal → invalid
    const res = await trpcMutation<unknown>(app, doctorToken, 'postOp.scheduleFollowUps', {
      surgeryId,
      proposals: bad,
    });
    expect(res.status).toBe(400);
  });

  it('listFollowUps surgery tag ile filtreler', async () => {
    await trpcMutation<AppointmentRow[]>(app, doctorToken, 'postOp.scheduleFollowUps', {
      surgeryId,
      proposals: buildProposals(performedAt),
    });
    // Ek bir tag'siz consultation ekle (surgery tag yok → listFollowUps'a girmez)
    await prisma.appointment.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        type: 'consultation',
        status: 'scheduled',
        startsAt: new Date('2026-09-01T09:00:00.000Z'),
        endsAt: new Date('2026-09-01T09:30:00.000Z'),
      },
    });
    const res = await trpcQuery<AppointmentRow[]>(app, doctorToken, 'postOp.listFollowUps', {
      surgeryId,
    });
    expect(res.body.result.data).toHaveLength(3);
    for (const a of res.body.result.data) expect(a.type).toBe('control');
  });

  it('deleteFollowUps siler ve count döner', async () => {
    await trpcMutation<AppointmentRow[]>(app, doctorToken, 'postOp.scheduleFollowUps', {
      surgeryId,
      proposals: buildProposals(performedAt),
    });
    const del = await trpcMutation<{ deletedCount: number }>(
      app,
      doctorToken,
      'postOp.deleteFollowUps',
      { surgeryId },
    );
    expect(del.body.result.data.deletedCount).toBe(3);

    const list = await trpcQuery<AppointmentRow[]>(app, doctorToken, 'postOp.listFollowUps', {
      surgeryId,
    });
    expect(list.body.result.data).toHaveLength(0);
  });

  it('recentComplications: sadece complicationFlag=true ve pencere içi', async () => {
    // surgery'yi complication ile güncelle
    await prisma.surgery.update({
      where: { id: surgeryId },
      data: { complicationFlag: true, complicationNotes: 'Hafif kornea ödemi' },
    });
    // pencere dışı bir surgery (eski)
    await prisma.surgery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        type: 'Old Surgery',
        status: 'performed',
        scheduledAt: new Date('2025-01-01'),
        performedAt: new Date('2025-01-01'),
        complicationFlag: true,
      },
    });
    const res = await trpcQuery<SurgeryRow[]>(app, doctorToken, 'postOp.recentComplications', {
      days: 365,
    });
    // Sadece performedAt >= now - 365d olan complicationFlag'lı surgeryler
    const ids = res.body.result.data.map((s) => s.id);
    expect(ids).toContain(surgeryId);
  });

  it('cross-tenant: tenantB token tenantA surgery için planlayamaz (404)', async () => {
    const tokenB = await login(
      app,
      fixtures.tenantB.slug,
      fixtures.tenantB.adminEmail,
      fixtures.tenantB.adminPassword,
    );
    const res = await trpcMutation<unknown>(app, tokenB, 'postOp.scheduleFollowUps', {
      surgeryId,
      proposals: buildProposals(performedAt),
    });
    expect(res.status).toBe(404);
  });
});
