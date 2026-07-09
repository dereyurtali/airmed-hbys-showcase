import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

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

const newPatient = (overrides: Record<string, unknown> = {}) => ({
  firstName: 'Yeni',
  lastName: 'Hasta',
  birthDate: '1990-06-15',
  gender: 'female',
  phone: '+9920000111111',
  ...overrides,
});

describe('Patient module (cross-tenant + role + duplicates)', () => {
  let app: INestApplication;
  let fixtures: IsolationFixtures;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('tenant A admin creates a patient: 201, MRN 9 digits, scoped to A', async () => {
    const token = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    const res = await request(app.getHttpServer() as App)
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send(newPatient({ phone: '+992111000001' }));
    expect(res.status).toBe(201);
    // S13 — Yeni MRN: <prefix(2)><yy(2)><check(1)><seq(5)>; tenantA prefix='TA'.
    expect(res.body.mrn).toMatch(/^TA\d{8}$/);
    expect(res.body.tenantId).toBe(fixtures.tenantA.id);
    expect(res.body.phoneLast4).toBe('0001');
  });

  it("tenant B's listing only includes B's seeded patient (no A leak)", async () => {
    const token = await login(
      app,
      fixtures.tenantB.slug,
      fixtures.tenantB.adminEmail,
      fixtures.tenantB.adminPassword,
    );
    const res = await request(app.getHttpServer() as App)
      .get('/api/patients')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const tenantIds = (res.body.items as Array<{ tenantId: string }>).map((p) => p.tenantId);
    expect(new Set(tenantIds)).toEqual(new Set([fixtures.tenantB.id]));
    expect(tenantIds).not.toContain(fixtures.tenantA.id);
  });

  it('cross-tenant findById returns 404 (RLS hides foreign rows)', async () => {
    const aToken = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    const created = await request(app.getHttpServer() as App)
      .post('/api/patients')
      .set('Authorization', `Bearer ${aToken}`)
      .send(
        newPatient({
          firstName: 'Cross',
          lastName: 'Tenant',
          birthDate: '1992-02-02',
          phone: '+992111000222',
        }),
      );
    expect(created.status).toBe(201);
    const aPatientId = created.body.id as string;

    const bToken = await login(
      app,
      fixtures.tenantB.slug,
      fixtures.tenantB.adminEmail,
      fixtures.tenantB.adminPassword,
    );
    const res = await request(app.getHttpServer() as App)
      .get(`/api/patients/${aPatientId}`)
      .set('Authorization', `Bearer ${bToken}`);
    expect(res.status).toBe(404);
  });

  it('resepsiyon role can create a patient (whitelisted)', async () => {
    const token = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.receptionistEmail!,
      fixtures.tenantA.receptionistPassword!,
    );
    const res = await request(app.getHttpServer() as App)
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send(newPatient({ firstName: 'Resepsiyon', phone: '+992111000333' }));
    expect(res.status).toBe(201);
  });

  it('duplicate phone in same tenant returns 409, force=true bypasses', async () => {
    const token = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    const phone = '+992111000444';
    const first = await request(app.getHttpServer() as App)
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send(newPatient({ firstName: 'İlk', phone }));
    expect(first.status).toBe(201);

    const dup = await request(app.getHttpServer() as App)
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send(newPatient({ firstName: 'İkinci', phone }));
    expect(dup.status).toBe(409);
    expect(dup.body.duplicates).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'phone' })]),
    );

    const force = await request(app.getHttpServer() as App)
      .post('/api/patients?force=true')
      .set('Authorization', `Bearer ${token}`)
      .send(newPatient({ firstName: 'Forced', phone }));
    expect(force.status).toBe(201);
  });

  it('soft-deleted patient disappears from list and 404 on findById', async () => {
    const token = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    const created = await request(app.getHttpServer() as App)
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send(newPatient({ firstName: 'Silinecek', phone: '+992111000555' }));
    const id = created.body.id as string;

    await request(app.getHttpServer() as App)
      .delete(`/api/patients/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    const after = await request(app.getHttpServer() as App)
      .get(`/api/patients/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(404);
  });
});
