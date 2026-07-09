import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';
import { parseMrn } from '../src/patient/verhoeff';

// S13 — MRN üretimi e2e:
//   1) Format: TA<yy><check><seq5>, parseMrn().valid === true
//   2) Sequential: 3 ardışık create → seq 1, 2, 3
//   3) Race: 10 concurrent create → 10 unique MRN, sıra çakışmaz
//   4) Boş mrn_prefix → 400

interface LoginBody {
  accessToken: string;
}
interface PatientRow {
  id: string;
  mrn: string;
}
interface TrpcCreateResponse {
  result: { data: PatientRow };
}

describe('S13 — MRN generation (klinik kodu + yıl + Verhoeff + atomik sayaç)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let receptionistToken: string;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

    const loginRes = await request(app.getHttpServer() as App)
      .post('/api/auth/login')
      .send({
        tenantSlug: fixtures.tenantA.slug,
        email: fixtures.tenantA.receptionistEmail,
        password: fixtures.tenantA.receptionistPassword,
      });
    receptionistToken = (loginRes.body as LoginBody).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Her test temiz başlasın: bu tenant'ın MRN sayacı + bu test'in açtığı
    // hasta kayıtları sıfırlanır (fixtures.patient kalır).
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.patient.deleteMany({
      where: { tenantId: fixtures.tenantA.id, mrn: { startsWith: 'TA' } },
    });
    await prisma.mrnCounter.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
  });

  const baseInput = (overrides: Record<string, unknown> = {}) => ({
    firstName: 'Test',
    lastName: 'Hasta',
    birthDate: '1990-01-01',
    gender: 'male' as const,
    phone: `+992${Math.floor(100_000_000 + Math.random() * 899_999_999)}`,
    ...overrides,
  });

  it('format: TA<yy><check><seq5> + parseMrn valid', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/patient.create')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send(baseInput());
    expect(res.status).toBe(200);
    const mrn = (res.body as TrpcCreateResponse).result.data.mrn;
    expect(mrn).toMatch(/^TA\d{8}$/);
    const parsed = parseMrn(mrn);
    expect(parsed).not.toBeNull();
    expect(parsed?.prefix).toBe('TA');
    expect(parsed?.valid).toBe(true);
    expect(parsed?.seq).toBe(1);
    expect(parsed?.year).toBe(new Date().getFullYear());
  });

  it('sequential — 3 ardışık create → seq 1, 2, 3', async () => {
    const seqs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await request(app.getHttpServer() as App)
        .post('/api/trpc/patient.create')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send(baseInput({ firstName: `Seq${i}` }));
      expect(res.status).toBe(200);
      const mrn = (res.body as TrpcCreateResponse).result.data.mrn;
      seqs.push(parseMrn(mrn)!.seq);
    }
    expect(seqs).toEqual([1, 2, 3]);
  });

  it('race — 10 concurrent create → 10 unique MRN (race-free atomik sayaç)', async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      request(app.getHttpServer() as App)
        .post('/api/trpc/patient.create')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send(baseInput({ firstName: `Race${i}` })),
    );
    const results = await Promise.all(promises);
    for (const r of results) {
      expect(r.status).toBe(200);
    }
    const mrns = results.map((r) => (r.body as TrpcCreateResponse).result.data.mrn);
    expect(new Set(mrns).size).toBe(10);
    const seqs = mrns.map((m) => parseMrn(m)!.seq).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('boş mrn_prefix → 400 (klinik onboarding eksik)', async () => {
    // tenantA'nın prefix'ini geçici olarak boşalt; sonra geri yükle.
    await prisma.tenant.update({
      where: { id: fixtures.tenantA.id },
      data: { mrnPrefix: '' },
    });
    try {
      const res = await request(app.getHttpServer() as App)
        .post('/api/trpc/patient.create')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send(baseInput({ firstName: 'NoPrefix' }));
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('MRN');
    } finally {
      await prisma.tenant.update({
        where: { id: fixtures.tenantA.id },
        data: { mrnPrefix: 'TA' },
      });
    }
  });
});
