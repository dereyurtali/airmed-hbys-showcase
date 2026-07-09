import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// S15-VIP — VIP tier sıralama: Patient.tags 'vip' içerenler reception queue ve
// doctor worklist kuyruklarının en üstüne çıkar. Günlük limit veya sebep
// zorunluluğu YOK (Ali kararı 2026-05-31).

interface LoginBody {
  accessToken: string;
}

async function login(app: INestApplication, slug: string, email: string, password: string) {
  const res = await request(app.getHttpServer() as App)
    .post('/api/auth/login')
    .send({ tenantSlug: slug, email, password });
  return (res.body as LoginBody).accessToken;
}

async function trpcQuery(app: INestApplication, token: string, route: string, input?: unknown) {
  const url = input
    ? `/api/trpc/${route}?input=${encodeURIComponent(JSON.stringify(input))}`
    : `/api/trpc/${route}`;
  const res = await request(app.getHttpServer() as App)
    .get(url)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body };
}

describe('S15-VIP Queue ordering (Patient.tags vip-first)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let vipPatientId: string;
  let standardPatientId: string;

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

    // Standart hasta (early stage update — daha eski timestamp)
    const std = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: `STD${Math.random().toString(36).slice(2, 8)}`,
        firstName: 'Standart',
        lastName: 'Hasta',
        birthDate: new Date('1980-01-01'),
        gender: 'female',
      },
    });
    standardPatientId = std.id;

    const vip = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: `VIP${Math.random().toString(36).slice(2, 8)}`,
        firstName: 'VIP',
        lastName: 'Hasta',
        birthDate: new Date('1985-01-01'),
        gender: 'male',
        tags: ['vip'],
      },
    });
    vipPatientId = vip.id;
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    // Önceki encounter'ları temizle
    await prisma.encounter.deleteMany({
      where: {
        tenantId: fixtures.tenantA.id,
        patientId: { in: [standardPatientId, vipPatientId] },
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('reception queue: VIP encounter en üstte sıralanır (standardın önünde)', async () => {
    // Standart önce, sonra VIP yarat (default stageUpdatedAt sırasında VIP sonra)
    await prisma.encounter.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: standardPatientId,
        stage: 'awaiting_exam_payment',
      },
    });
    // Küçük gecikme tip-breaker stage_updated_at için
    await new Promise((r) => setTimeout(r, 20));
    await prisma.encounter.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: vipPatientId,
        stage: 'awaiting_exam_payment',
      },
    });

    const res = await trpcQuery(app, adminToken, 'encounter.receptionQueue');
    expect(res.status).toBe(200);
    const items = (res.body as { result: { data: { patient: { id: string; tags?: string[] } }[] } })
      .result.data;
    // İlk eleman VIP olmalı
    expect(items[0].patient.id).toBe(vipPatientId);
    expect(items[0].patient.tags).toContain('vip');
  });

  it('reception queue: VIP yoksa stageUpdatedAt ASC sırası bozulmaz', async () => {
    await prisma.encounter.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: standardPatientId,
        stage: 'awaiting_exam_payment',
      },
    });
    const res = await trpcQuery(app, adminToken, 'encounter.receptionQueue');
    expect(res.status).toBe(200);
    const items = (res.body as { result: { data: { patient: { id: string } }[] } }).result.data;
    expect(items[0].patient.id).toBe(standardPatientId);
  });

  it('Patient.tags vip tag eklenince queue sırası anında yansır', async () => {
    // Önce ikisi de standart, ikisini de bekle ekran
    await prisma.encounter.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: vipPatientId,
        stage: 'awaiting_exam_payment',
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    await prisma.encounter.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: standardPatientId,
        stage: 'awaiting_exam_payment',
      },
    });

    // İlk sorgu: VIP zaten vip tag'li → üste çıkar
    const r1 = await trpcQuery(app, adminToken, 'encounter.receptionQueue');
    const items1 = (r1.body as { result: { data: { patient: { id: string } }[] } }).result.data;
    expect(items1[0].patient.id).toBe(vipPatientId);

    // VIP tag'i kaldır → her ikisi de standart → stageUpdatedAt'a göre
    await prisma.patient.update({
      where: { id: vipPatientId },
      data: { tags: [] },
    });
    const r2 = await trpcQuery(app, adminToken, 'encounter.receptionQueue');
    const items2 = (r2.body as { result: { data: { patient: { id: string } }[] } }).result.data;
    // İlk eleman artık daha eski açılan vipPatientId (orderBy stageUpdatedAt asc)
    expect(items2[0].patient.id).toBe(vipPatientId);
    // Tag'i geri ekle (sonraki testler için)
    await prisma.patient.update({
      where: { id: vipPatientId },
      data: { tags: ['vip'] },
    });
  });
});
