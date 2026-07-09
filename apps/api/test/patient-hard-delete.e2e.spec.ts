import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// S7 — Hasta hard-delete (karar tutanağı §6.1). KVKK "right to be forgotten":
// patient + tüm child kayıtlar kalıcı silinir; audit log explicit yazılır.
// Sadece yönetici; çift onay UI'da, backend reason + 'DELETE' literal zorunlu.

interface LoginBody {
  accessToken: string;
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

async function seedAsistan(prisma: PrismaClient, tenantId: string): Promise<string> {
  const role = await prisma.role.upsert({
    where: { tenantId_key: { tenantId, key: 'yonetici_asistani' } },
    update: {},
    create: { tenantId, key: 'yonetici_asistani', label: 'Asistan' },
  });
  const hash = await bcrypt.hash('hard-delete-pass-1', 4);
  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId, email: 's7-asistan@a.tj' } },
    update: { status: 'active', passwordHash: hash },
    create: {
      tenantId,
      email: 's7-asistan@a.tj',
      passwordHash: hash,
      name: 'S7 Asistan',
      status: 'active',
    },
  });
  await prisma.userRole.upsert({
    where: { tenantId_userId_roleId: { tenantId, userId: user.id, roleId: role.id } },
    update: {},
    create: { tenantId, userId: user.id, roleId: role.id },
  });
  return user.id;
}

async function createPatientWithChildren(
  prisma: PrismaClient,
  tenantId: string,
  mrn: string,
  doctorId: string,
): Promise<string> {
  const patient = await prisma.patient.create({
    data: {
      tenantId,
      mrn,
      firstName: 'HardDelete',
      lastName: 'Test',
      birthDate: new Date('1980-01-01'),
      gender: 'male',
    },
  });
  // Her test için tamamen farklı slot — exclusion constraint çakışmasını önle.
  // mrn'in tüm karakterlerinden hash + random offset (test izolasyonu için).
  const hash = mrn.split('').reduce((a, c) => a + c.charCodeAt(0) * 31, 0);
  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + (hash % 100000) * 60_000);
  const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
  await prisma.appointment.create({
    data: { tenantId, patientId: patient.id, doctorId, type: 'consultation', startsAt, endsAt },
  });
  await prisma.measurement.create({
    data: {
      tenantId,
      patientId: patient.id,
      type: 'intraocular_pressure',
      values: { od: 14, os: 15 },
      measuredAt: new Date(),
    },
  });
  await prisma.patientDoctor.create({
    data: { tenantId, patientId: patient.id, doctorId, source: 'auto' },
  });
  return patient.id;
}

describe('S7 — Patient hard-delete (KVKK)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let yoneticiToken: string;
  let asistanToken: string;
  let doctorId: string;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

    await seedAsistan(prisma, fixtures.tenantA.id);
    yoneticiToken = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    asistanToken = await login(app, fixtures.tenantA.slug, 's7-asistan@a.tj', 'hard-delete-pass-1');

    const doctor = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        name: 'Dr. S7',
        specialty: 'Test',
        isActive: true,
      },
    });
    doctorId = doctor.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('yönetici hard-delete: patient + child kayıtlar silinir + audit log yazılır', async () => {
    const patientId = await createPatientWithChildren(
      prisma,
      fixtures.tenantA.id,
      'S7-OK-1',
      doctorId,
    );

    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/patient.hardDelete')
      .set('Authorization', `Bearer ${yoneticiToken}`)
      .set('Content-Type', 'application/json')
      .send({
        id: patientId,
        confirm: 'DELETE',
        reason: 'KVKK talep #2026-001 — hasta yazılı sildirme talebi',
      });
    expect(res.status).toBe(200);

    // Patient + child kayıtlar yok
    expect(await prisma.patient.findUnique({ where: { id: patientId } })).toBeNull();
    expect(await prisma.appointment.count({ where: { patientId } })).toBe(0);
    expect(await prisma.measurement.count({ where: { patientId } })).toBe(0);
    expect(await prisma.patientDoctor.count({ where: { patientId } })).toBe(0);

    // Audit log: action=patient.hard_delete + reason + mrn snapshot
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: patientId, action: 'patient.hard_delete' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect((audit!.payload as { mrn?: string }).mrn).toBe('S7-OK-1');
    expect((audit!.payload as { reason?: string }).reason).toContain('KVKK talep');
  });

  it('asistan hard-delete → 403 (Karar 5/12: sadece yönetici)', async () => {
    const patientId = await createPatientWithChildren(
      prisma,
      fixtures.tenantA.id,
      'S7-ASIST-1',
      doctorId,
    );
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/patient.hardDelete')
      .set('Authorization', `Bearer ${asistanToken}`)
      .set('Content-Type', 'application/json')
      .send({
        id: patientId,
        confirm: 'DELETE',
        reason: 'KVKK talep test sebep yeterli uzun',
      });
    expect(res.status).toBe(403);
    // Patient hâlâ var (silinmemiş)
    expect(await prisma.patient.findUnique({ where: { id: patientId } })).not.toBeNull();
  });

  it("'DELETE' literal eksik → 400 (zod validation)", async () => {
    const patientId = await createPatientWithChildren(
      prisma,
      fixtures.tenantA.id,
      'S7-NOLIT',
      doctorId,
    );
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/patient.hardDelete')
      .set('Authorization', `Bearer ${yoneticiToken}`)
      .set('Content-Type', 'application/json')
      .send({
        id: patientId,
        confirm: 'delete', // küçük harf — literal eşleşmez
        reason: 'KVKK talep sebep yeterli uzun',
      });
    expect(res.status).toBe(400);
    expect(await prisma.patient.findUnique({ where: { id: patientId } })).not.toBeNull();
  });

  it('reason < 10 karakter → 400', async () => {
    const patientId = await createPatientWithChildren(
      prisma,
      fixtures.tenantA.id,
      'S7-REAS',
      doctorId,
    );
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/patient.hardDelete')
      .set('Authorization', `Bearer ${yoneticiToken}`)
      .set('Content-Type', 'application/json')
      .send({ id: patientId, confirm: 'DELETE', reason: 'kısa' });
    expect(res.status).toBe(400);
    expect(await prisma.patient.findUnique({ where: { id: patientId } })).not.toBeNull();
  });
});
