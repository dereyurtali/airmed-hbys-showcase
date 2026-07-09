import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import request from 'supertest';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

interface TokenResponse {
  accessToken: string;
}

describe('A5 Doctor module (REST CRUD + availability)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let receptionToken: string;

  async function login(slug: string, email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ tenantSlug: slug, email, password })
      .expect(200);
    return (res.body as TokenResponse).accessToken;
  }

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

    adminToken = await login(
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    // Spin up a receptionist user in tenant A so we can probe write-vs-read
    // role enforcement without changing fixtures.
    const receptionEmail = 'reception@a-doctor.test';
    const receptionPassword = 'reception-pass-1234';
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash(receptionPassword, 4);
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const receptionRole = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: fixtures.tenantA.id, key: 'resepsiyon' } },
    });
    const user = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: receptionEmail,
        passwordHash: hash,
        name: 'Reception A',
        status: 'active',
      },
    });
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: user.id, roleId: receptionRole.id },
    });
    receptionToken = await login(fixtures.tenantA.slug, receptionEmail, receptionPassword);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    // Hard-delete tenant A doctors created during these tests (skip the seed
    // doctor by filtering on a unique tag in the name).
    await prisma.doctorAvailability.deleteMany({
      where: {
        tenantId: fixtures.tenantA.id,
        doctor: { name: { contains: 'TEST_A5_' } },
      },
    });
    await prisma.doctor.deleteMany({
      where: { tenantId: fixtures.tenantA.id, name: { contains: 'TEST_A5_' } },
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.doctorAvailability.deleteMany({
      where: {
        tenantId: fixtures.tenantA.id,
        doctor: { name: { contains: 'TEST_A5_' } },
      },
    });
    await prisma.doctor.deleteMany({
      where: { tenantId: fixtures.tenantA.id, name: { contains: 'TEST_A5_' } },
    });
    await prisma.$disconnect();
    await app.close();
  });

  it('admin creates a doctor → 201 + record persists', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/doctors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'TEST_A5_ Dr. New',
        specialty: 'Göz Hastalıkları',
        type: 'local',
        contactEmail: 'new@a-doctor.test',
        commissionRate: '15.00',
      })
      .expect(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('TEST_A5_ Dr. New');
  });

  it('reception cannot create — 403 (write role enforcement)', async () => {
    await request(app.getHttpServer())
      .post('/api/doctors')
      .set('Authorization', `Bearer ${receptionToken}`)
      .send({ name: 'TEST_A5_ Reception attempt', specialty: 'Göz' })
      .expect(403);
  });

  it('reception can list + read — read role allowed', async () => {
    await request(app.getHttpServer())
      .post('/api/doctors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'TEST_A5_ Visible', specialty: 'Göz' })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get('/api/doctors?search=TEST_A5_')
      .set('Authorization', `Bearer ${receptionToken}`)
      .expect(200);
    expect(list.body.items.length).toBeGreaterThanOrEqual(1);
  });

  it('list filters by specialty + isActive', async () => {
    await request(app.getHttpServer())
      .post('/api/doctors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'TEST_A5_ Active', specialty: 'Pediatri' })
      .expect(201);
    const inactiveCreate = await request(app.getHttpServer())
      .post('/api/doctors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'TEST_A5_ Inactive', specialty: 'Pediatri', isActive: false })
      .expect(201);
    expect(inactiveCreate.body.isActive).toBe(false);

    const onlyActive = await request(app.getHttpServer())
      .get('/api/doctors?specialty=Pediatri&isActive=true')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(onlyActive.body.items.every((d: { isActive: boolean }) => d.isActive)).toBe(true);
  });

  it('update + soft delete — deleted doctor disappears from list', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/doctors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'TEST_A5_ Delete me', specialty: 'Test' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/doctors/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'TEST_A5_ Renamed' })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/doctors/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    const list = await request(app.getHttpServer())
      .get('/api/doctors?search=TEST_A5_ Renamed')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(list.body.items).toHaveLength(0);
  });

  it('availability replace-all writes Mon-Fri 09:00-17:00', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/doctors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'TEST_A5_ With schedule', specialty: 'Göz' })
      .expect(201);

    await request(app.getHttpServer())
      .put(`/api/doctors/${created.body.id}/availability`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slots: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
          dayOfWeek,
          startTime: '09:00',
          endTime: '17:00',
        })),
      })
      .expect(200);

    const detail = await request(app.getHttpServer())
      .get(`/api/doctors/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(detail.body.availabilities).toHaveLength(5);
  });

  it('availability rejects overlapping slots on the same day → 400', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/doctors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'TEST_A5_ Overlap test', specialty: 'Test' })
      .expect(201);

    await request(app.getHttpServer())
      .put(`/api/doctors/${created.body.id}/availability`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slots: [
          { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' },
          { dayOfWeek: 1, startTime: '11:30', endTime: '15:00' }, // overlaps
        ],
      })
      .expect(400);
  });

  it('availability accepts disjoint windows on the same day', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/doctors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'TEST_A5_ Split day', specialty: 'Test' })
      .expect(201);

    await request(app.getHttpServer())
      .put(`/api/doctors/${created.body.id}/availability`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slots: [
          { dayOfWeek: 2, startTime: '09:00', endTime: '12:00' },
          { dayOfWeek: 2, startTime: '14:00', endTime: '17:00' },
        ],
      })
      .expect(200);
  });

  it('rejects malformed startTime + reversed window', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/doctors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'TEST_A5_ Bad time', specialty: 'Test' })
      .expect(201);

    await request(app.getHttpServer())
      .put(`/api/doctors/${created.body.id}/availability`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slots: [{ dayOfWeek: 1, startTime: '9:00', endTime: '17:00' }] })
      .expect(400);

    await request(app.getHttpServer())
      .put(`/api/doctors/${created.body.id}/availability`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slots: [{ dayOfWeek: 1, startTime: '17:00', endTime: '09:00' }] })
      .expect(400);
  });

  it('cross-tenant isolation: tenant B admin cannot see tenant A doctors', async () => {
    await request(app.getHttpServer())
      .post('/api/doctors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'TEST_A5_ Tenant A only', specialty: 'Göz' })
      .expect(201);

    const tenantBToken = await login(
      fixtures.tenantB.slug,
      fixtures.tenantB.adminEmail,
      fixtures.tenantB.adminPassword,
    );
    const list = await request(app.getHttpServer())
      .get('/api/doctors?search=TEST_A5_ Tenant A only')
      .set('Authorization', `Bearer ${tenantBToken}`)
      .expect(200);
    expect(list.body.items).toHaveLength(0);
  });
});
