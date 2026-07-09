import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaClient } from '@airmed/db';
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

interface FunnelRow {
  source: string;
  leads: number;
  withAppointment: number;
  withExamination: number;
  withSurgery: number;
}

interface LeadListResp {
  items: Array<{
    id: string;
    firstName: string;
    leadSource: string | null;
    leadSourceNote: string | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

interface SetSourceResp {
  id: string;
  leadSource: string | null;
  leadSourceNote: string | null;
}

describe('E1 Lead — funnel + list + setSource (router coverage)', () => {
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
    // Test izolasyonu: önceki test'in patient'larını sil (seed patient'ı koru)
    await prisma.patient.deleteMany({
      where: { tenantId: fixtures.tenantA.id, id: { not: fixtures.tenantA.patientId } },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('funnel: leadSource null → unset bucket, dolu kaynaklar kendi bucket', async () => {
    // Seed patient'ın leadSource'unu temizle (unset bucket için)
    await prisma.patient.update({
      where: { id: fixtures.tenantA.patientId },
      data: { leadSource: null },
    });
    // 2 instagram, 1 whatsapp patient ekle
    await prisma.patient.createMany({
      data: [
        {
          tenantId: fixtures.tenantA.id,
          mrn: 'L-001',
          firstName: 'L',
          lastName: '1',
          birthDate: new Date('1990-01-01'),
          gender: 'male',
          leadSource: 'instagram',
        },
        {
          tenantId: fixtures.tenantA.id,
          mrn: 'L-002',
          firstName: 'L',
          lastName: '2',
          birthDate: new Date('1991-01-01'),
          gender: 'female',
          leadSource: 'instagram',
        },
        {
          tenantId: fixtures.tenantA.id,
          mrn: 'L-003',
          firstName: 'L',
          lastName: '3',
          birthDate: new Date('1992-01-01'),
          gender: 'female',
          leadSource: 'whatsapp',
        },
      ],
    });

    const res = await trpcQuery<FunnelRow[]>(app, adminToken, 'lead.funnel', {});
    expect(res.status).toBe(200);
    const rows = res.body.result.data;
    const instagram = rows.find((r) => r.source === 'instagram');
    const whatsapp = rows.find((r) => r.source === 'whatsapp');
    const unset = rows.find((r) => r.source === 'unset');
    expect(instagram?.leads).toBe(2);
    expect(whatsapp?.leads).toBe(1);
    expect(unset?.leads).toBe(1); // seed patient
  });

  it('funnel: from/to date filtresi uygulanır', async () => {
    await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'L-OLD',
        firstName: 'Eski',
        lastName: 'Hasta',
        birthDate: new Date('1990-01-01'),
        gender: 'male',
        leadSource: 'telegram',
        createdAt: new Date('2024-01-15'),
      },
    });
    const res = await trpcQuery<FunnelRow[]>(app, adminToken, 'lead.funnel', {
      from: '2025-01-01',
      to: '2025-12-31',
    });
    expect(res.status).toBe(200);
    // 2024 kaydı filtre dışı; seed patient bugün → out of 2025 → de filtre dışı
    expect(res.body.result.data.find((r) => r.source === 'telegram')).toBeUndefined();
  });

  it('list: stage=lead default, paginated response', async () => {
    await prisma.patient.createMany({
      data: Array.from({ length: 3 }).map((_, i) => ({
        tenantId: fixtures.tenantA.id,
        mrn: `L-LIST-${i}`,
        firstName: 'List',
        lastName: String(i),
        birthDate: new Date('1990-01-01'),
        gender: 'male' as const,
        leadSource: 'instagram' as const,
      })),
    });
    const res = await trpcQuery<LeadListResp>(app, adminToken, 'lead.list', {
      source: 'instagram',
      page: 1,
      pageSize: 2,
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.items.length).toBe(2);
    expect(res.body.result.data.total).toBe(3);
    expect(res.body.result.data.pageSize).toBe(2);
  });

  it('list: source=null filter sadece leadSource null olan hasta', async () => {
    await prisma.patient.update({
      where: { id: fixtures.tenantA.patientId },
      data: { leadSource: null },
    });
    await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'L-WITH',
        firstName: 'With',
        lastName: 'Source',
        birthDate: new Date('1990-01-01'),
        gender: 'female',
        leadSource: 'instagram',
      },
    });
    const res = await trpcQuery<LeadListResp>(app, adminToken, 'lead.list', {
      source: null,
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.items.every((p) => p.leadSource === null)).toBe(true);
  });

  it('setSource: var olan hasta güncellenir', async () => {
    const res = await trpcMutation<SetSourceResp>(app, adminToken, 'lead.setSource', {
      patientId: fixtures.tenantA.patientId,
      source: 'telegram',
      note: 'kanaldan geldi',
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.leadSource).toBe('telegram');
    expect(res.body.result.data.leadSourceNote).toBe('kanaldan geldi');
  });

  it('setSource: olmayan patientId → 404', async () => {
    const res = await trpcMutation<SetSourceResp>(app, adminToken, 'lead.setSource', {
      patientId: '00000000-0000-0000-0000-000000000000',
      source: 'instagram',
      note: null,
    });
    expect(res.status).toBe(404);
  });
});
