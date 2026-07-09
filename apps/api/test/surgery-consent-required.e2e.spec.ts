import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { completeSafetyChecklist, resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// S15-PR8 — SurgeryService.markCompleted: imzalı (revoke edilmemiş) onam yoksa
// 400 reject. Yönetici override yok; Break Glass (PR5) ayrı akış.

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

const TINY_SIG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';

describe('S15-PR8 Surgery markCompleted consent guard', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let doctorToken: string;
  let doctorUserId: string;
  let doctorProfileId: string;
  let templateId: string;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );

    const role = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: fixtures.tenantA.id, key: 'doktor' } },
    });
    const email = 'doktor@a-consent-required.test';
    const password = 'doktor-pass-1234';
    const user = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email,
        passwordHash: await bcrypt.hash(password, 4),
        name: 'Dr. Consent Test',
        status: 'active',
      },
    });
    doctorUserId = user.id;
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: user.id, roleId: role.id },
    });
    const doctorProfile = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        userId: doctorUserId,
        name: 'Dr. Consent Test',
        specialty: 'ophthalmology',
      },
    });
    doctorProfileId = doctorProfile.id;
    doctorToken = await login(app, fixtures.tenantA.slug, email, password);

    const tpl = await prisma.consentTemplate.create({
      data: {
        tenantId: fixtures.tenantA.id,
        procedureType: 'cataract',
        language: 'tr',
        version: 1,
        title: 'Katarakt onam test PR8',
        content: 'Test içeriği.',
        isActive: true,
      },
    });
    templateId = tpl.id;
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createSurgery(): Promise<string> {
    const s = await prisma.surgery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        type: 'cataract',
        scheduledAt: new Date(),
      },
    });
    return s.id;
  }

  it('markCompleted REJECTED if no signed consent exists (400)', async () => {
    const surgeryId = await createSurgery();
    const res = await trpcMutation(app, doctorToken, 'surgery.markCompleted', {
      surgeryId,
      performedAt: new Date().toISOString(),
      skipAutoSchedule: true,
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('onam');
  });

  it('markCompleted OK when patient has general signed consent', async () => {
    const surgeryId = await createSurgery();
    await prisma.consentSigning.create({
      data: {
        tenantId: fixtures.tenantA.id,
        templateId,
        patientId: fixtures.tenantA.patientId,
        language: 'tr',
        contentSnapshot: 'snapshot',
        signatureData: TINY_SIG,
        signedByUserId: doctorUserId,
      },
    });
    // #392 — onam tamam ama güvenlik kontrol listesi de tamamlanmalı.
    await completeSafetyChecklist(prisma, fixtures.tenantA.id, surgeryId);

    const res = await trpcMutation(app, doctorToken, 'surgery.markCompleted', {
      surgeryId,
      performedAt: new Date().toISOString(),
      skipAutoSchedule: true,
    });
    expect(res.status).toBe(200);
  });

  it('markCompleted REJECTED when only consent is revoked (400)', async () => {
    const surgeryId = await createSurgery();
    // Revoke flag dolu olan kayıt geçerli sayılmaz.
    await prisma.consentSigning.create({
      data: {
        tenantId: fixtures.tenantA.id,
        templateId,
        patientId: fixtures.tenantA.patientId,
        surgeryId,
        language: 'tr',
        contentSnapshot: 'snapshot',
        signatureData: TINY_SIG,
        signedByUserId: doctorUserId,
        revokedAt: new Date(),
        revokeReason: 'Test revoke',
      },
    });

    // Yeni hasta yarat — başka aktif onam kalmasın.
    const newPatient = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: `RVK${Math.random().toString(36).slice(2, 8)}`,
        firstName: 'Revoke',
        lastName: 'Test',
        birthDate: new Date('1985-04-15'),
        gender: 'female',
      },
    });
    const surgery2 = await prisma.surgery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: newPatient.id,
        doctorId: doctorProfileId,
        type: 'cataract',
        scheduledAt: new Date(),
      },
    });
    await prisma.consentSigning.create({
      data: {
        tenantId: fixtures.tenantA.id,
        templateId,
        patientId: newPatient.id,
        surgeryId: surgery2.id,
        language: 'tr',
        contentSnapshot: 'snapshot',
        signatureData: TINY_SIG,
        signedByUserId: doctorUserId,
        revokedAt: new Date(),
        revokeReason: 'Test revoke',
      },
    });

    const res = await trpcMutation(app, doctorToken, 'surgery.markCompleted', {
      surgeryId: surgery2.id,
      performedAt: new Date().toISOString(),
      skipAutoSchedule: true,
    });
    expect(res.status).toBe(400);
  });
});
