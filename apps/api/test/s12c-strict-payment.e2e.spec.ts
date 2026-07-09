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

// S12c — "Önce öde, sonra hizmet" sıkı engel (müşteri görüşmesi karar 3=B).
// examination.create / lab.create / surgery.create ödeme olmadan 403 dönmeli.
// Aynı gün + aynı kategoride paid invoice varsa geçerli.
// Tasarım: docs/audits/2026-05-28-musteri-toplantisi-sonrasi.md karar 3.

interface LoginBody {
  accessToken: string;
}

describe('S12c — Strict payment gate (examination + lab + surgery)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let doctorToken: string;
  let doctorUserId: string;
  let doctorProfileId: string;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

    const doktorRole = await prisma.role.upsert({
      where: { tenantId_key: { tenantId: fixtures.tenantA.id, key: 'doktor' } },
      update: {},
      create: { tenantId: fixtures.tenantA.id, key: 'doktor', label: 'Doktor' },
    });
    const hash = await bcrypt.hash('s12c-pass', 4);
    const doctorUser = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: 's12c-dok@a.tj',
        passwordHash: hash,
        name: 'S12c Doktor',
        status: 'active',
      },
    });
    doctorUserId = doctorUser.id;
    await prisma.userRole.create({
      data: {
        tenantId: fixtures.tenantA.id,
        userId: doctorUser.id,
        roleId: doktorRole.id,
      },
    });
    const docProfile = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        userId: doctorUser.id,
        name: 'Dr. S12c',
        specialty: 'Test',
        isActive: true,
      },
    });
    doctorProfileId = docProfile.id;

    const loginRes = await request(app.getHttpServer() as App)
      .post('/api/auth/login')
      .send({
        tenantSlug: fixtures.tenantA.slug,
        email: 's12c-dok@a.tj',
        password: 's12c-pass',
      });
    doctorToken = (loginRes.body as LoginBody).accessToken;
  });

  afterAll(async () => {
    await prisma.invoiceItem.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.invoice.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.examination.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.labTest.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.surgery.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.doctor.deleteMany({ where: { id: doctorProfileId } });
    await prisma.userRole.deleteMany({ where: { userId: doctorUserId } });
    await prisma.user.deleteMany({ where: { id: doctorUserId } });
    await app.close();
    await prisma.$disconnect();
  });

  it('examination.create — ödeme yoksa 403', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/examination.create')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorUserId,
        examinedAt: new Date().toISOString(),
        findings: {},
      });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('examination');
  });

  it('examination.create — paid invoice varsa OK', async () => {
    await seedPaidInvoiceForCategory(
      prisma,
      fixtures.tenantA.id,
      fixtures.tenantA.patientId,
      'examination',
      doctorUserId,
    );
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/examination.create')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorUserId,
        examinedAt: new Date().toISOString(),
        findings: {},
      });
    expect(res.status).toBe(200);
  });

  it('lab.create — ödeme yoksa 403', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/lab.create')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        patientId: fixtures.tenantA.patientId,
        source: 'internal',
        testType: 'blood_test',
        performedAt: new Date().toISOString(),
      });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('lab');
  });

  it('lab.create — paid invoice varsa OK', async () => {
    await seedPaidInvoiceForCategory(
      prisma,
      fixtures.tenantA.id,
      fixtures.tenantA.patientId,
      'lab',
      doctorUserId,
    );
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/lab.create')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        patientId: fixtures.tenantA.patientId,
        source: 'internal',
        testType: 'blood_test',
        performedAt: new Date().toISOString(),
      });
    expect(res.status).toBe(200);
  });

  it('surgery.create — ödeme yoksa 403', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/surgery.create')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        type: 'phaco',
        scheduledAt: new Date().toISOString(),
      });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('surgery');
  });

  it('surgery.create — paid invoice varsa OK', async () => {
    await seedPaidInvoiceForCategory(
      prisma,
      fixtures.tenantA.id,
      fixtures.tenantA.patientId,
      'surgery',
      doctorUserId,
    );
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/surgery.create')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        type: 'phaco',
        scheduledAt: new Date().toISOString(),
      });
    expect(res.status).toBe(200);
  });
});
