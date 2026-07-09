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

async function uploadPhoto(
  app: INestApplication,
  token: string,
  patientId: string,
  buffer: Buffer,
  filename = 'a.png',
) {
  const res = await request(app.getHttpServer() as App)
    .post('/api/photos/upload')
    .set('Authorization', `Bearer ${token}`)
    .field('patientId', patientId)
    .field('tag', 'general')
    .attach('file', buffer, { filename, contentType: 'image/png' });
  return res.body as { id: string; tag: string; uploadedById: string | null };
}

interface PhotoRow {
  id: string;
  tag: string;
  description: string | null;
  uploadedById: string | null;
}
interface PhotoListResp {
  items: PhotoRow[];
  total: number;
  page: number;
  pageSize: number;
}

const PNG_BUFFER = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da636060f8cf00000003000100' +
    '1c0a73070000000049454e44ae426082',
  'hex',
);

describe('Photo tRPC router — list/findById/update/softDelete (router coverage)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let doctorToken: string;
  let doctorUserId: string;

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

    // Test doktoru oluştur — başkasının yüklediği fotoyu düzenleyemez senaryosu için
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const doktorRole = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: fixtures.tenantA.id, key: 'doktor' } },
    });
    const hash = await bcrypt.hash('doktor-pass-1234', 4);
    const d = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: 'doktor@a-photo.test',
        passwordHash: hash,
        name: 'Dr. Photo',
        status: 'active',
      },
    });
    doctorUserId = d.id;
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: d.id, roleId: doktorRole.id },
    });
    doctorToken = await login(
      app,
      fixtures.tenantA.slug,
      'doktor@a-photo.test',
      'doktor-pass-1234',
    );
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.patientPhoto.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('list: patient filtreli + paginated, total doğru', async () => {
    for (let i = 0; i < 3; i++) {
      await uploadPhoto(app, adminToken, fixtures.tenantA.patientId, PNG_BUFFER, `p${i}.png`);
    }
    const res = await trpcQuery<PhotoListResp>(app, adminToken, 'photo.list', {
      patientId: fixtures.tenantA.patientId,
      page: 1,
      pageSize: 2,
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.items.length).toBe(2);
    expect(res.body.result.data.total).toBe(3);
  });

  it('listByPatient: hastanın tüm aktif fotoları (sil edilmemişler)', async () => {
    const p1 = await uploadPhoto(app, adminToken, fixtures.tenantA.patientId, PNG_BUFFER, '1.png');
    await uploadPhoto(app, adminToken, fixtures.tenantA.patientId, PNG_BUFFER, '2.png');
    // p1'i soft-delete et
    await trpcMutation(app, adminToken, 'photo.softDelete', { id: p1.id });

    const res = await trpcQuery<PhotoRow[]>(app, adminToken, 'photo.listByPatient', {
      patientId: fixtures.tenantA.patientId,
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.length).toBe(1);
  });

  it('findById: var olan → ok, olmayan → 404', async () => {
    const p = await uploadPhoto(app, adminToken, fixtures.tenantA.patientId, PNG_BUFFER);
    const ok = await trpcQuery<PhotoRow>(app, adminToken, 'photo.findById', { id: p.id });
    expect(ok.status).toBe(200);
    expect(ok.body.result.data.id).toBe(p.id);

    const missing = await trpcQuery<PhotoRow>(app, adminToken, 'photo.findById', {
      id: '00000000-0000-0000-0000-000000000000',
    });
    expect(missing.status).toBe(404);
  });

  it('update: admin başkasının fotosunu düzenleyebilir (yonetici override)', async () => {
    const p = await uploadPhoto(app, doctorToken, fixtures.tenantA.patientId, PNG_BUFFER);
    expect(p.uploadedById).toBe(doctorUserId);

    const res = await trpcMutation<PhotoRow>(app, adminToken, 'photo.update', {
      id: p.id,
      data: { description: 'admin notu' },
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.description).toBe('admin notu');
  });

  it('update: doktor başkasının fotosunu düzenleyemez → 403', async () => {
    const p = await uploadPhoto(app, adminToken, fixtures.tenantA.patientId, PNG_BUFFER);
    const res = await trpcMutation<PhotoRow>(app, doctorToken, 'photo.update', {
      id: p.id,
      data: { description: 'yetkim yok' },
    });
    expect(res.status).toBe(403);
  });

  it('softDelete: doktor kendi fotosunu silEMEZ — S10e 4 (sadece yönetici, karar tutanağı §6.2)', async () => {
    const p = await uploadPhoto(app, doctorToken, fixtures.tenantA.patientId, PNG_BUFFER);
    const res = await trpcMutation<{ ok: true }>(app, doctorToken, 'photo.softDelete', {
      id: p.id,
    });
    expect(res.status).toBe(403);
  });
});
