import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// S15-PR7 — Pediatrik veli onam guard: yaş <18 hasta için signedByGuardian=true
// + guardianName + guardianRelationship zorunlu; yetişkin için opsiyonel.

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

describe('S15-PR7 Pediatric guardian consent', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let adultPatientId: string;
  let pediatricPatientId: string;
  let templateId: string;

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

    // Yetişkin + pediatrik hasta yarat.
    const adult = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: `ADT${Math.random().toString(36).slice(2, 8)}`,
        firstName: 'Adult',
        lastName: 'Patient',
        birthDate: new Date('1990-01-15'),
        gender: 'male',
      },
    });
    adultPatientId = adult.id;

    const ped = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: `PED${Math.random().toString(36).slice(2, 8)}`,
        firstName: 'Pediatric',
        lastName: 'Patient',
        birthDate: new Date('2018-06-10'),
        gender: 'female',
      },
    });
    pediatricPatientId = ped.id;

    // Aktif consent template yarat.
    const tpl = await prisma.consentTemplate.create({
      data: {
        tenantId: fixtures.tenantA.id,
        procedureType: 'cataract',
        language: 'tr',
        version: 1,
        title: 'Katarakt onam test',
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

  it('adult patient signs without guardian fields (200)', async () => {
    const res = await trpcMutation(app, adminToken, 'consent.sign', {
      templateId,
      patientId: adultPatientId,
      signatureData: TINY_SIG,
      signedByGuardian: false,
    });
    expect(res.status).toBe(200);
    const data = (res.body as { result: { data: { signedByGuardian: boolean } } }).result.data;
    expect(data.signedByGuardian).toBe(false);
  });

  it('pediatric patient REJECTED without guardian flag (400)', async () => {
    const res = await trpcMutation(app, adminToken, 'consent.sign', {
      templateId,
      patientId: pediatricPatientId,
      signatureData: TINY_SIG,
      signedByGuardian: false,
    });
    expect(res.status).toBe(400);
  });

  it('pediatric patient REJECTED if guardian flag set but name missing (400)', async () => {
    const res = await trpcMutation(app, adminToken, 'consent.sign', {
      templateId,
      patientId: pediatricPatientId,
      signatureData: TINY_SIG,
      signedByGuardian: true,
      guardianRelationship: 'mother',
    });
    expect(res.status).toBe(400);
  });

  it('pediatric patient REJECTED if relationship missing (400)', async () => {
    const res = await trpcMutation(app, adminToken, 'consent.sign', {
      templateId,
      patientId: pediatricPatientId,
      signatureData: TINY_SIG,
      signedByGuardian: true,
      guardianName: 'Anne Veli',
    });
    expect(res.status).toBe(400);
  });

  it('pediatric patient accepted with full guardian info (200)', async () => {
    const res = await trpcMutation(app, adminToken, 'consent.sign', {
      templateId,
      patientId: pediatricPatientId,
      signatureData: TINY_SIG,
      signedByGuardian: true,
      guardianName: 'Anne Veli',
      guardianRelationship: 'mother',
      guardianIdentityNo: 'TR12345678901',
    });
    expect(res.status).toBe(200);
    const data = (
      res.body as {
        result: {
          data: {
            signedByGuardian: boolean;
            guardianName: string;
            guardianRelationship: string;
          };
        };
      }
    ).result.data;
    expect(data.signedByGuardian).toBe(true);
    expect(data.guardianName).toBe('Anne Veli');
    expect(data.guardianRelationship).toBe('mother');
  });

  it('invalid guardianRelationship enum rejected (400)', async () => {
    const res = await trpcMutation(app, adminToken, 'consent.sign', {
      templateId,
      patientId: pediatricPatientId,
      signatureData: TINY_SIG,
      signedByGuardian: true,
      guardianName: 'Anne Veli',
      guardianRelationship: 'uncle', // invalid
    });
    expect(res.status).toBe(400);
  });
});
