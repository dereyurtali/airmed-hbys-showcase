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

interface TrpcError {
  error: { data?: { httpStatus?: number }; message?: string };
}

interface CohortRow {
  bucket: string;
  count: number;
}

interface RetentionRow {
  bucket: string;
  total: number;
  returned: number;
  rate: number;
}

interface HeatmapCell {
  dow: number;
  hour: number;
  count: number;
}

async function login(app: INestApplication, slug: string, email: string, password: string) {
  const res = await request(app.getHttpServer() as App)
    .post('/api/auth/login')
    .send({ tenantSlug: slug, email, password });
  return (res.body as LoginBody).accessToken;
}

async function trpcQuery<T>(app: INestApplication, token: string, route: string, input: unknown) {
  const url = `/api/trpc/${route}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await request(app.getHttpServer() as App)
    .get(url)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body as TrpcSuccess<T> & TrpcError };
}

describe('E5 Reports (cohort + retention + heatmap)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let doctorToken: string;

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

    // Doktor non-manager — yetki testleri için
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const doktorRole = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: fixtures.tenantA.id, key: 'doktor' } },
    });
    const doctorEmail = 'doktor@a-reports.test';
    const doctorPassword = 'doktor-pass-1234';
    const hash = await bcrypt.hash(doctorPassword, 4);
    const doctorUser = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: doctorEmail,
        passwordHash: hash,
        name: 'Dr. Reports',
        status: 'active',
      },
    });
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: doctorUser.id, roleId: doktorRole.id },
    });
    doctorToken = await login(app, fixtures.tenantA.slug, doctorEmail, doctorPassword);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('cohort: admin → 200', async () => {
    const res = await trpcQuery<CohortRow[]>(app, adminToken, 'metric.cohort', { months: 12 });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.result.data)).toBe(true);
  });

  it('cohort: doktor → 403', async () => {
    const res = await trpcQuery<unknown>(app, doctorToken, 'metric.cohort', { months: 6 });
    expect(res.status).toBe(403);
  });

  it('retention: admin → 200 + shape ok', async () => {
    // Bir kohort ve dönen randevu kur
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const patient = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'A-RETN-1',
        firstName: 'Ret',
        lastName: 'Patient',
        birthDate: new Date('1980-01-01'),
        gender: 'female',
        createdAt: sixMonthsAgo,
      },
    });
    // Doctor profile aç
    const doctorProfile = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        name: 'Dr. R',
        specialty: 'Göz',
        type: 'local',
      },
    });
    const apptDate = new Date(sixMonthsAgo);
    apptDate.setDate(apptDate.getDate() + 30);
    await prisma.appointment.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: patient.id,
        doctorId: doctorProfile.id,
        type: 'consultation',
        status: 'completed',
        startsAt: apptDate,
        endsAt: new Date(apptDate.getTime() + 30 * 60_000),
      },
    });

    const res = await trpcQuery<RetentionRow[]>(app, adminToken, 'metric.retention', {
      cohortMonths: 12,
      lookAheadDays: 90,
    });
    expect(res.status).toBe(200);
    const rows = res.body.result.data;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(typeof r.total).toBe('number');
      expect(typeof r.returned).toBe('number');
      expect(typeof r.rate).toBe('number');
      expect(r.rate).toBeGreaterThanOrEqual(0);
      expect(r.rate).toBeLessThanOrEqual(1);
    }
  });

  it('retention: doktor → 403', async () => {
    const res = await trpcQuery<unknown>(app, doctorToken, 'metric.retention', {
      cohortMonths: 6,
      lookAheadDays: 30,
    });
    expect(res.status).toBe(403);
  });

  it('doctorHeatmap: admin → 200 + dow/hour aralığı doğru', async () => {
    const res = await trpcQuery<HeatmapCell[]>(app, adminToken, 'metric.doctorHeatmap', {
      days: 30,
    });
    expect(res.status).toBe(200);
    for (const c of res.body.result.data) {
      expect(c.dow).toBeGreaterThanOrEqual(0);
      expect(c.dow).toBeLessThanOrEqual(6);
      expect(c.hour).toBeGreaterThanOrEqual(0);
      expect(c.hour).toBeLessThanOrEqual(23);
      expect(typeof c.count).toBe('number');
    }
  });

  it('zod: cohort months > 36 → 400', async () => {
    const res = await trpcQuery<unknown>(app, adminToken, 'metric.cohort', { months: 999 });
    expect(res.status).toBe(400);
  });

  it('cross-tenant: tenantB admin sadece kendi tenant verisini görür', async () => {
    // tenantA'ya hasta ekle
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const before = await trpcQuery<CohortRow[]>(app, adminToken, 'metric.cohort', { months: 12 });
    const aCount = before.body.result.data.reduce((s, r) => s + r.count, 0);

    const tokenB = await login(
      app,
      fixtures.tenantB.slug,
      fixtures.tenantB.adminEmail,
      fixtures.tenantB.adminPassword,
    );
    const bRes = await trpcQuery<CohortRow[]>(app, tokenB, 'metric.cohort', { months: 12 });
    expect(bRes.status).toBe(200);
    const bCount = bRes.body.result.data.reduce((s, r) => s + r.count, 0);
    // tenantB rakamı tenantA'dan bağımsız — RLS izolasyonu
    expect(bCount).not.toBe(aCount);
  });
});
