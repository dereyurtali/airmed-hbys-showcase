import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { completeSafetyChecklist, resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// #418 — Yanlış-göz/lens laterality 'never event' bariyeri (markCompleted).
// Lens implant edilen cerrahide, ameliyat edilen gözün biyometri/keratometri
// ölçümü yoksa tamamlama 400 ile bloklanır.

interface LoginBody {
  accessToken: string;
}

const TINY_SIG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';

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
  return { status: res.status, body: res.body as unknown };
}

describe('#418 surgery wrong-eye laterality hard-block', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let doctorToken: string;
  let doctorProfileId: string;
  let serialSeq = 0;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const doktorRole = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: fixtures.tenantA.id, key: 'doktor' } },
    });
    const hash = await bcrypt.hash('doktor-pass-1234', 4);
    const u = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: 'lat418@a.tj',
        passwordHash: hash,
        name: 'Dr. Laterality',
        status: 'active',
      },
    });
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: u.id, roleId: doktorRole.id },
    });
    const dp = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        userId: u.id,
        name: 'Dr. Laterality',
        specialty: 'Cataract',
        isActive: true,
      },
    });
    doctorProfileId = dp.id;
    doctorToken = await login(app, fixtures.tenantA.slug, 'lat418@a.tj', 'doktor-pass-1234');
  });

  beforeEach(async () => {
    await prisma.appointment.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.measurement.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.surgicalSafetyCheck.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.surgery.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.consentSigning.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    // markCompleted onam bariyerini geçmek için genel imzalı onam.
    const template = await prisma.consentTemplate.upsert({
      where: {
        tenantId_procedureType_language_version: {
          tenantId: fixtures.tenantA.id,
          procedureType: 'cataract',
          language: 'tr',
          version: 1,
        },
      },
      update: {},
      create: {
        tenantId: fixtures.tenantA.id,
        procedureType: 'cataract',
        language: 'tr',
        version: 1,
        title: 'lat418 consent',
        content: 'snapshot',
        isActive: true,
      },
    });
    await prisma.consentSigning.create({
      data: {
        tenantId: fixtures.tenantA.id,
        templateId: template.id,
        patientId: fixtures.tenantA.patientId,
        language: 'tr',
        contentSnapshot: 'snapshot',
        signatureData: TINY_SIG,
      },
    });
  });

  async function createLensSurgery(eyeSide: 'od' | 'os' | 'ou' | null): Promise<string> {
    serialSeq += 1;
    const s = await prisma.surgery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        type: 'Phacoemulsification + IOL',
        status: 'planned',
        scheduledAt: new Date('2026-07-20T09:00:00.000Z'),
        eyeSide,
        lensSerialNumber: `LAT418-${serialSeq}`,
      },
    });
    // #392 — güvenlik kapısı laterality assert'inden SONRA çalışır; eye-block
    // testlerini etkilemez ama 200 beklenenlerin geçmesi için tamamlanmalı.
    await completeSafetyChecklist(prisma, fixtures.tenantA.id, s.id);
    return s.id;
  }

  async function addMeasurement(eyeSide: 'od' | 'os' | 'ou', type = 'biometry') {
    await prisma.measurement.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        type: type as 'biometry' | 'keratometry',
        eyeSide,
        measuredAt: new Date('2026-07-10T09:00:00.000Z'),
      },
    });
  }

  function complete(surgeryId: string) {
    return trpcMutation(app, doctorToken, 'surgery.markCompleted', {
      surgeryId,
      performedAt: new Date().toISOString(),
      skipAutoSchedule: true,
    });
  }

  it('OD lens surgery + NO biometry → 400 wrong-eye block', async () => {
    const id = await createLensSurgery('od');
    const res = await complete(id);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('yanlış-göz');
  });

  it('OD lens surgery + only OS biometry → 400 wrong-eye block', async () => {
    const id = await createLensSurgery('od');
    await addMeasurement('os');
    const res = await complete(id);
    expect(res.status).toBe(400);
  });

  it('OD lens surgery + OD biometry → completes (performed)', async () => {
    const id = await createLensSurgery('od');
    await addMeasurement('od');
    const res = await complete(id);
    expect(res.status).toBe(200);
  });

  it('OD lens surgery + OU (bilateral) keratometry → completes', async () => {
    const id = await createLensSurgery('od');
    await addMeasurement('ou', 'keratometry');
    const res = await complete(id);
    expect(res.status).toBe(200);
  });

  it('lens surgery with eyeSide=ou → 400 (must specify OD/OS)', async () => {
    const id = await createLensSurgery('ou');
    await addMeasurement('ou');
    const res = await complete(id);
    expect(res.status).toBe(400);
  });

  it('NO-lens surgery (LASIK) + no biometry → completes (guard skipped)', async () => {
    serialSeq += 1;
    const s = await prisma.surgery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        type: 'LASIK / Excimer',
        status: 'planned',
        scheduledAt: new Date('2026-07-20T09:00:00.000Z'),
        eyeSide: 'ou',
      },
    });
    await completeSafetyChecklist(prisma, fixtures.tenantA.id, s.id);
    const res = await complete(s.id);
    expect(res.status).toBe(200);
  });
});
