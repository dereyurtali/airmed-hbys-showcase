import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// S15-PR1 — Patient tıbbi alanları (allerji, antikoagülan, kan grubu, pediatrik
// veli) create + update + read round-trip + zod validation testleri.

interface LoginBody {
  accessToken: string;
}

interface TrpcSuccess<T> {
  result: { data: T };
}

interface PatientRow {
  id: string;
  firstName: string;
  lastName: string;
  allergies: string[];
  anticoagulantMedications: string[];
  bloodType: string | null;
  pediatricGuardianName: string | null;
  pediatricGuardianPhone: string | null;
  pediatricGuardianRelationship: string | null;
  photoUrl: string | null;
}

async function login(app: INestApplication, slug: string, email: string, password: string) {
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

describe('S15-PR1 Patient medical fields', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;

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

  it('create patient with medical fields persists all arrays + enum', async () => {
    const res = await trpcMutation<PatientRow>(app, adminToken, 'patient.create', {
      firstName: 'Tıbbi',
      lastName: 'Test',
      birthDate: '1975-03-12',
      gender: 'female',
      phone: '+992111111101',
      allergies: ['penisilin', 'lateks'],
      anticoagulantMedications: ['warfarin'],
      bloodType: 'a_pos',
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.allergies).toEqual(['penisilin', 'lateks']);
    expect(res.body.result.data.anticoagulantMedications).toEqual(['warfarin']);
    expect(res.body.result.data.bloodType).toBe('a_pos');
  });

  it('create patient with pediatric guardian fields persists relationship enum', async () => {
    const res = await trpcMutation<PatientRow>(app, adminToken, 'patient.create', {
      firstName: 'Pediatri',
      lastName: 'Hasta',
      birthDate: '2015-06-20',
      gender: 'male',
      phone: '+992111111102',
      pediatricGuardianName: 'Ahmet Veli',
      pediatricGuardianPhone: '+992 900 12 34 56',
      pediatricGuardianRelationship: 'father',
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.pediatricGuardianName).toBe('Ahmet Veli');
    expect(res.body.result.data.pediatricGuardianPhone).toBe('+992 900 12 34 56');
    expect(res.body.result.data.pediatricGuardianRelationship).toBe('father');
  });

  it('create patient with empty medical fields defaults to empty arrays + nulls', async () => {
    const res = await trpcMutation<PatientRow>(app, adminToken, 'patient.create', {
      firstName: 'Default',
      lastName: 'Hasta',
      birthDate: '1980-01-01',
      gender: 'female',
      phone: '+992111111103',
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.allergies).toEqual([]);
    expect(res.body.result.data.anticoagulantMedications).toEqual([]);
    expect(res.body.result.data.bloodType).toBeNull();
    expect(res.body.result.data.pediatricGuardianName).toBeNull();
    expect(res.body.result.data.photoUrl).toBeNull();
  });

  it('update mutation patches medical fields without touching others', async () => {
    const created = await trpcMutation<PatientRow>(app, adminToken, 'patient.create', {
      firstName: 'Update',
      lastName: 'Hasta',
      birthDate: '1990-05-05',
      gender: 'male',
      phone: '+992111111104',
      allergies: ['aspirin'],
    });
    const id = created.body.result.data.id;

    const updated = await trpcMutation<PatientRow>(app, adminToken, 'patient.update', {
      id,
      data: {
        anticoagulantMedications: ['klopidogrel', 'apiksaban'],
        bloodType: 'o_neg',
      },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.result.data.allergies).toEqual(['aspirin']);
    expect(updated.body.result.data.anticoagulantMedications).toEqual(['klopidogrel', 'apiksaban']);
    expect(updated.body.result.data.bloodType).toBe('o_neg');
  });

  it('findById returns medical fields', async () => {
    const created = await trpcMutation<PatientRow>(app, adminToken, 'patient.create', {
      firstName: 'Find',
      lastName: 'Med',
      birthDate: '1988-11-30',
      gender: 'female',
      phone: '+992111111105',
      allergies: ['sulfonamid'],
      bloodType: 'ab_pos',
    });
    const id = created.body.result.data.id;

    const res = await trpcQuery<PatientRow>(app, adminToken, 'patient.findById', { id });
    expect(res.status).toBe(200);
    expect(res.body.result.data.allergies).toEqual(['sulfonamid']);
    expect(res.body.result.data.bloodType).toBe('ab_pos');
  });

  it('zod rejects allergies with XSS chars (< > &)', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/patient.create')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'XSS',
        lastName: 'Test',
        birthDate: '1980-01-01',
        gender: 'male',
        phone: '+992111111107',
        allergies: ['<script>alert(1)</script>'],
      });
    expect(res.status).toBe(400);
  });

  it('zod rejects unknown bloodType value', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/patient.create')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Bad',
        lastName: 'Blood',
        birthDate: '1980-01-01',
        gender: 'female',
        phone: '+992111111108',
        bloodType: 'rh_positive', // invalid
      });
    expect(res.status).toBe(400);
  });

  it('zod rejects unknown guardianRelationship value', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/patient.create')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Bad',
        lastName: 'Rel',
        birthDate: '2010-01-01',
        gender: 'male',
        phone: '+992111111109',
        pediatricGuardianRelationship: 'uncle', // invalid
      });
    expect(res.status).toBe(400);
  });

  it('zod rejects allergies array > 30 items', async () => {
    const tooMany = Array.from({ length: 31 }, (_, i) => `alerji${i}`);
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/patient.create')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'TooMany',
        lastName: 'Allergy',
        birthDate: '1980-01-01',
        gender: 'female',
        phone: '+992111111110',
        allergies: tooMany,
      });
    expect(res.status).toBe(400);
  });
});
