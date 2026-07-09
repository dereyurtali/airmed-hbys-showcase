import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// S15-PR10 — NurseAssistanceSession + AuditLog.onBehalfOfUserId entegrasyonu.
// Hemşire bir doktor adına session açar, audit log otomatik enrich olur.

interface LoginBody {
  accessToken: string;
}

async function login(app: INestApplication, slug: string, email: string, password: string) {
  const res = await request(app.getHttpServer() as App)
    .post('/api/auth/login')
    .send({ tenantSlug: slug, email, password });
  return (res.body as LoginBody).accessToken;
}

async function trpcMutation(app: INestApplication, token: string, route: string, body: unknown) {
  const res = await request(app.getHttpServer() as App)
    .post(`/api/trpc/${route}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  return { status: res.status, body: res.body };
}

async function trpcQuery(app: INestApplication, token: string, route: string, input?: unknown) {
  const url = input
    ? `/api/trpc/${route}?input=${encodeURIComponent(JSON.stringify(input))}`
    : `/api/trpc/${route}`;
  const res = await request(app.getHttpServer() as App)
    .get(url)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body };
}

describe('S15-PR10 NurseAssistanceSession', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let nurseToken: string;
  let nurseUserId: string;
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

    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );

    // Hemşire ve doktor rolleri (seed'de hemşire olmayabilir, garantile)
    const ensureRole = async (key: string, label: string) => {
      const existing = await prisma.role.findUnique({
        where: { tenantId_key: { tenantId: fixtures.tenantA.id, key } },
      });
      if (existing) return existing;
      return prisma.role.create({
        data: { tenantId: fixtures.tenantA.id, key, label },
      });
    };
    const hemRole = await ensureRole('hemsire', 'Hemşire');
    const docRole = await ensureRole('doktor', 'Doktor');
    const hash = await bcrypt.hash('pass-1234', 4);

    const nurse = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: 'nurse@a-pr10.test',
        passwordHash: hash,
        name: 'Hemşire Ayşe',
        status: 'active',
      },
    });
    nurseUserId = nurse.id;
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: nurse.id, roleId: hemRole.id },
    });

    const doctor = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: 'doctor@a-pr10.test',
        passwordHash: hash,
        name: 'Dr. Ahmet',
        status: 'active',
      },
    });
    doctorUserId = doctor.id;
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: doctor.id, roleId: docRole.id },
    });

    nurseToken = await login(app, fixtures.tenantA.slug, 'nurse@a-pr10.test', 'pass-1234');
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    // Önceki session'ları temizle
    await prisma.nurseAssistanceSession.deleteMany({
      where: { tenantId: fixtures.tenantA.id, nurseId: nurseUserId },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('nurse starts session, my returns active', async () => {
    const start = await trpcMutation(app, nurseToken, 'nurseSession.start', {
      doctorUserId,
      reason: 'Sabah vardiyası',
    });
    expect(start.status).toBe(200);

    const my = await trpcQuery(app, nurseToken, 'nurseSession.my');
    expect(my.status).toBe(200);
    const data = (my.body as { result: { data: { doctorUserId: string } | null } }).result.data;
    expect(data).not.toBeNull();
    expect(data!.doctorUserId).toBe(doctorUserId);
  });

  it('start rejects non-doctor user (400)', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/nurseSession.start')
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({ doctorUserId: nurseUserId }); // hemşireyi doktor olarak deniyoruz
    expect(res.status).toBe(400);
  });

  it('starting new session ends previous active session', async () => {
    // 1. session
    await trpcMutation(app, nurseToken, 'nurseSession.start', { doctorUserId });

    // 2. doktor yarat ve geç
    const doc2 = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: 'doctor2@a-pr10.test',
        passwordHash: await bcrypt.hash('p', 4),
        name: 'Dr. İkinci',
        status: 'active',
      },
    });
    const docRole = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: fixtures.tenantA.id, key: 'doktor' } },
    });
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: doc2.id, roleId: docRole.id },
    });

    await trpcMutation(app, nurseToken, 'nurseSession.start', { doctorUserId: doc2.id });

    // İlk session endedAt set olmuş olmalı
    const sessions = await prisma.nurseAssistanceSession.findMany({
      where: { nurseId: nurseUserId },
      orderBy: { startedAt: 'asc' },
    });
    expect(sessions.length).toBe(2);
    expect(sessions[0].endedAt).not.toBeNull();
    expect(sessions[1].endedAt).toBeNull();
  });

  it('admin revokes session (yonetici-only)', async () => {
    const start = await trpcMutation(app, nurseToken, 'nurseSession.start', { doctorUserId });
    const sessionId = (start.body as { result: { data: { id: string } } }).result.data.id;

    // Hemşire revoke deneyebilir mi? 403
    const nurseRevoke = await request(app.getHttpServer() as App)
      .post('/api/trpc/nurseSession.revoke')
      .set('Authorization', `Bearer ${nurseToken}`)
      .send({ sessionId, reason: 'Yetkimi test ediyorum' });
    expect(nurseRevoke.status).toBe(403);

    // Admin revoke
    const adminRevoke = await trpcMutation(app, adminToken, 'nurseSession.revoke', {
      sessionId,
      reason: 'Mesai sonu zorunlu kapatma',
    });
    expect(adminRevoke.status).toBe(200);

    // my artık null
    const my = await trpcQuery(app, nurseToken, 'nurseSession.my');
    const data = (my.body as { result: { data: unknown } }).result.data;
    expect(data).toBeNull();
  });

  it('AuditLog otomatik onBehalfOfUserId enrichment (active session)', async () => {
    // Session aç
    await trpcMutation(app, nurseToken, 'nurseSession.start', { doctorUserId });

    // Hemşire bir audited aksiyon yapsın — measurement.create hemşire yetkili.
    const upd = await trpcMutation(app, nurseToken, 'measurement.create', {
      patientId: fixtures.tenantA.patientId,
      type: 'intraocular_pressure',
      eyeSide: 'ou',
      measuredAt: new Date().toISOString(),
      values: { pressure: 15 },
    });
    expect(upd.status).toBe(200);

    // Audit log'da onBehalfOfUserId hemşirenin doktoru
    const logs = await prisma.auditLog.findMany({
      where: { tenantId: fixtures.tenantA.id, userId: nurseUserId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const enriched = logs.find((l) => l.onBehalfOfUserId === doctorUserId);
    expect(enriched).toBeDefined();
    expect(enriched!.nurseSessionId).toBeTruthy();
  });
});
