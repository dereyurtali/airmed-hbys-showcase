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

// B1 PR 1 — Surgery extension testleri.
// eyeSide / anesthesiaType / surgeonRole create + update + invalid enum.

interface LoginBody {
  accessToken: string;
}
interface TrpcSuccess<T> {
  result: { data: T };
}
interface SurgeryRow {
  id: string;
  eyeSide: 'od' | 'os' | 'ou' | null;
  anesthesiaType: string | null;
  surgeonRole: string | null;
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

describe('B1 PR 1 — Surgery extension (eyeSide + anesthesia + surgeonRole)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let doctorToken: string;
  let doctorProfileId: string;

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
        email: 'b1@a.tj',
        passwordHash: hash,
        name: 'Dr. B1',
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
        name: 'Dr. B1',
        specialty: 'Cerrahi',
        isActive: true,
      },
    });
    doctorProfileId = dp.id;
    doctorToken = await login(app, fixtures.tenantA.slug, 'b1@a.tj', 'doktor-pass-1234');
  });

  beforeEach(async () => {
    await prisma.surgery.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    // S12c — assertPaidSession bypass için günlük paid invoice seed.
    await prisma.invoiceItem.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.invoice.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await seedPaidInvoiceForCategory(
      prisma,
      fixtures.tenantA.id,
      fixtures.tenantA.patientId,
      'surgery',
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('create with eyeSide=od + anesthesiaType=general + surgeonRole=VISITING', async () => {
    const create = await trpcMutation<SurgeryRow>(app, doctorToken, 'surgery.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorProfileId,
      type: 'Cataract',
      scheduledAt: new Date('2026-07-01T09:00:00.000Z').toISOString(),
      eyeSide: 'od',
      anesthesiaType: 'general',
      surgeonRole: 'VISITING',
    });
    expect(create.status).toBe(200);
    expect(create.body.result.data.eyeSide).toBe('od');
    expect(create.body.result.data.anesthesiaType).toBe('general');
    expect(create.body.result.data.surgeonRole).toBe('VISITING');
  });

  it('create without B1 alanları → null (legacy uyumluluğu)', async () => {
    const create = await trpcMutation<SurgeryRow>(app, doctorToken, 'surgery.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorProfileId,
      type: 'Glaucoma',
      scheduledAt: new Date('2026-07-02T09:00:00.000Z').toISOString(),
    });
    expect(create.status).toBe(200);
    expect(create.body.result.data.eyeSide).toBeNull();
    expect(create.body.result.data.anesthesiaType).toBeNull();
    expect(create.body.result.data.surgeonRole).toBeNull();
  });

  it('update: eyeSide + surgeonRole değiştirme', async () => {
    const created = await prisma.surgery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        type: 'Cataract',
        status: 'planned',
        scheduledAt: new Date('2026-07-03T09:00:00.000Z'),
      },
    });
    const upd = await trpcMutation<SurgeryRow>(app, doctorToken, 'surgery.update', {
      id: created.id,
      data: { eyeSide: 'ou', surgeonRole: 'LOCAL' },
    });
    expect(upd.status).toBe(200);
    expect(upd.body.result.data.eyeSide).toBe('ou');
    expect(upd.body.result.data.surgeonRole).toBe('LOCAL');
  });

  it('invalid eyeSide → 400 (zod validation)', async () => {
    const create = await trpcMutation<SurgeryRow>(app, doctorToken, 'surgery.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorProfileId,
      type: 'Retina',
      scheduledAt: new Date('2026-07-04T09:00:00.000Z').toISOString(),
      eyeSide: 'BOTH', // invalid; valid: od/os/ou
    });
    expect(create.status).toBe(400);
  });

  it('invalid anesthesiaType → 400', async () => {
    const create = await trpcMutation<SurgeryRow>(app, doctorToken, 'surgery.create', {
      patientId: fixtures.tenantA.patientId,
      doctorId: doctorProfileId,
      type: 'Retina',
      scheduledAt: new Date('2026-07-05T09:00:00.000Z').toISOString(),
      anesthesiaType: 'EPIDURAL',
    });
    expect(create.status).toBe(400);
  });

  it('findById returns B1 fields', async () => {
    const created = await prisma.surgery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        type: 'Cataract',
        status: 'planned',
        scheduledAt: new Date('2026-07-06T09:00:00.000Z'),
        eyeSide: 'os',
        anesthesiaType: 'topical',
        surgeonRole: 'REFERRAL',
      },
    });
    const find = await trpcQuery<SurgeryRow>(app, doctorToken, 'surgery.findById', {
      id: created.id,
    });
    expect(find.status).toBe(200);
    expect(find.body.result.data.eyeSide).toBe('os');
    expect(find.body.result.data.anesthesiaType).toBe('topical');
    expect(find.body.result.data.surgeonRole).toBe('REFERRAL');
  });
});
