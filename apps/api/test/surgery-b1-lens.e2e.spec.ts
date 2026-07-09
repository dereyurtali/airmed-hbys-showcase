import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// B1 PR 2 — Lens validation + complication detail.

interface LoginBody {
  accessToken: string;
}
interface TrpcSuccess<T> {
  result: { data: T };
}
interface SurgeryRow {
  id: string;
  lensImplantLotId: string | null;
  lensSerialNumber: string | null;
  lensIsOverride: boolean;
  lensOverrideReason: string | null;
  complicationFlag: boolean;
  complicationDetail: { category?: string; severity?: string } | null;
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

describe('B1 PR 2 — Lens validation + complication detail', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let doctorToken: string;
  let doctorUserId: string;
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
        email: 'b1lens@a.tj',
        passwordHash: hash,
        name: 'Dr. Lens',
        status: 'active',
      },
    });
    doctorUserId = u.id;
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: u.id, roleId: doktorRole.id },
    });
    const dp = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        userId: u.id,
        name: 'Dr. Lens',
        specialty: 'Cataract',
        isActive: true,
      },
    });
    doctorProfileId = dp.id;
    doctorToken = await login(app, fixtures.tenantA.slug, 'b1lens@a.tj', 'doktor-pass-1234');
  });

  beforeEach(async () => {
    await prisma.iolStockMovement.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.surgery.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.iolLot.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.iolModel.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createSurgery(): Promise<string> {
    const s = await prisma.surgery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        type: 'Cataract',
        status: 'planned',
        scheduledAt: new Date('2026-07-10T09:00:00.000Z'),
      },
    });
    return s.id;
  }

  async function createLot(qty = 5) {
    const model = await prisma.iolModel.create({
      data: { tenantId: fixtures.tenantA.id, brand: 'Alcon', model: 'SN60WF' },
    });
    // Delta audit C-2: 3-state lifecycle — lot başlangıçta tamamen available.
    // surgery.registerLens artık IolService.consumeForSurgery çağırıyor
    // (availableQty -> consumedQty + legacy quantity).
    const lot = await prisma.iolLot.create({
      data: {
        tenantId: fixtures.tenantA.id,
        modelId: model.id,
        lotNumber: 'LOT-001',
        power: 21.0,
        quantity: qty,
        availableQty: qty,
        reservedQty: 0,
        consumedQty: 0,
        expiresAt: new Date('2028-01-01'),
      },
    });
    return lot.id;
  }

  it('register golden: valid lot + serial + barcode → surgery güncellenir + stock consume', async () => {
    const surgeryId = await createSurgery();
    const lotId = await createLot();
    const res = await trpcMutation<SurgeryRow>(app, doctorToken, 'surgery.registerLens', {
      surgeryId,
      lotId,
      serialNumber: 'ALC-SN60-1234',
      barcode: '9876543210123',
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.lensImplantLotId).toBe(lotId);
    expect(res.body.result.data.lensSerialNumber).toBe('ALC-SN60-1234');
    expect(res.body.result.data.lensIsOverride).toBe(false);

    // Stock movement consume kayıt oluştu mu?
    const movements = await prisma.iolStockMovement.findMany({
      where: { tenantId: fixtures.tenantA.id, surgeryId },
    });
    expect(movements.length).toBe(1);
    expect(movements[0].type).toBe('consume');
    expect(movements[0].quantity).toBe(-1);
    expect(movements[0].lotId).toBe(lotId);

    // P0 2.8 regresyon guard: IolLot.quantity atomic decrement
    // (önceden yalnız movement yazılıyordu, quantity stale kalıyordu).
    const lotAfter = await prisma.iolLot.findUniqueOrThrow({ where: { id: lotId } });
    expect(lotAfter.quantity).toBe(4); // createLot default qty=5
  });

  it('stok bittiğinde non-override registerLens → 400 (atomic guard)', async () => {
    const surgeryId = await createSurgery();
    const lotId = await createLot(1); // quantity = 1
    // İlk consume: success, lot → 0
    const r1 = await trpcMutation<SurgeryRow>(app, doctorToken, 'surgery.registerLens', {
      surgeryId,
      lotId,
      serialNumber: 'EMPTY-001-1234',
    });
    expect(r1.status).toBe(200);
    const lotMid = await prisma.iolLot.findUniqueOrThrow({ where: { id: lotId } });
    expect(lotMid.quantity).toBe(0);

    // İkinci consume: stok bitti, non-override → 400
    const s2 = await createSurgery();
    const r2 = await trpcMutation<SurgeryRow>(app, doctorToken, 'surgery.registerLens', {
      surgeryId: s2,
      lotId,
      serialNumber: 'EMPTY-002-1234',
    });
    expect(r2.status).toBe(400);
    expect(JSON.stringify(r2.body)).toMatch(/stok|stoğu/i);
    // Tx rollback kanıtı: ikinci surgery'ye seri no yazılmamış olmalı
    const s2Row = await prisma.surgery.findUniqueOrThrow({ where: { id: s2 } });
    expect(s2Row.lensSerialNumber).toBeNull();
  });

  it('format invalid → 400 (Zod regex)', async () => {
    const surgeryId = await createSurgery();
    const lotId = await createLot();
    const res = await trpcMutation<SurgeryRow>(app, doctorToken, 'surgery.registerLens', {
      surgeryId,
      lotId,
      serialNumber: 'sn1', // çok kısa + lowercase
    });
    expect(res.status).toBe(400);
  });

  it('duplicate serial (baska surgery kaydinda kullanildi) → reject (partial unique index)', async () => {
    const s1 = await createSurgery();
    const lotId = await createLot();
    await trpcMutation(app, doctorToken, 'surgery.registerLens', {
      surgeryId: s1,
      lotId,
      serialNumber: 'DUP-12345-6789',
    });
    // İkinci surgery, aynı serial
    const s2 = await createSurgery();
    const res = await trpcMutation<SurgeryRow>(app, doctorToken, 'surgery.registerLens', {
      surgeryId: s2,
      lotId,
      serialNumber: 'DUP-12345-6789',
    });
    // Service BadRequestException atıyor (ConflictException tRPC transactional
    // wrap'inde 500 olarak görünüyor; mapping P2 standardizasyon listesinde).
    // Kanıt: response başarısız + mesaj lens seri no'sundan bahsediyor.
    expect(res.status).not.toBe(200);
    expect(JSON.stringify(res.body)).toMatch(/lens seri numarası.*kullanılmış/i);
    // DB seviyesinde: serial sadece s1'de set kalmalı (s2'ye yazılmamış).
    const winners = await prisma.surgery.findMany({
      where: { id: { in: [s1, s2] }, lensSerialNumber: 'DUP-12345-6789' },
    });
    expect(winners).toHaveLength(1);
    expect(winners[0].id).toBe(s1);
  });

  it('paralel iki istek aynı seri no → tek atomik success + tek conflict (race-free)', async () => {
    const s1 = await createSurgery();
    const s2 = await createSurgery();
    const lotId = await createLot();
    const [r1, r2] = await Promise.all([
      trpcMutation<SurgeryRow>(app, doctorToken, 'surgery.registerLens', {
        surgeryId: s1,
        lotId,
        serialNumber: 'RACE-12345-6789',
      }),
      trpcMutation<SurgeryRow>(app, doctorToken, 'surgery.registerLens', {
        surgeryId: s2,
        lotId,
        serialNumber: 'RACE-12345-6789',
      }),
    ]);
    // Race guard kanıtı: yalnızca biri DB'de serial set etmiş olmalı (partial
    // unique index atomik). HTTP status detayı sırasında biri 200, diğeri 4xx
    // veya 5xx olabilir (transaction abort wrap pattern'ine bağlı). DB state
    // doğrulaması semantik kanıt sağlar.
    const successCount = [r1.status, r2.status].filter((s) => s === 200).length;
    expect(successCount).toBe(1);
    const winners = await prisma.surgery.findMany({
      where: { id: { in: [s1, s2] }, lensSerialNumber: 'RACE-12345-6789' },
    });
    expect(winners).toHaveLength(1);
  });

  it('lotId yok + isOverride=false → 400 (stok dışı kullanım yasak)', async () => {
    const surgeryId = await createSurgery();
    const res = await trpcMutation<SurgeryRow>(app, doctorToken, 'surgery.registerLens', {
      surgeryId,
      serialNumber: 'NOSTOCK-001',
      // lotId yok, isOverride=false (default)
    });
    expect(res.status).toBe(400);
  });

  it('isOverride=true ama overrideReason eksik → 400 (Zod refine)', async () => {
    const surgeryId = await createSurgery();
    const res = await trpcMutation<SurgeryRow>(app, doctorToken, 'surgery.registerLens', {
      surgeryId,
      serialNumber: 'OVR-12345',
      isOverride: true,
      // overrideReason yok
    });
    expect(res.status).toBe(400);
  });

  it('isOverride=true + valid reason + lotId yok → surgery güncellenir, stock movement YOK', async () => {
    const surgeryId = await createSurgery();
    const res = await trpcMutation<SurgeryRow>(app, doctorToken, 'surgery.registerLens', {
      surgeryId,
      serialNumber: 'OVR-67890',
      isOverride: true,
      overrideReason: 'Paket bozuk, klinikten farklı lens kullanıldı',
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.lensIsOverride).toBe(true);
    expect(res.body.result.data.lensImplantLotId).toBeNull();
    expect(res.body.result.data.lensOverrideReason).toContain('Paket bozuk');
    const movements = await prisma.iolStockMovement.findMany({
      where: { tenantId: fixtures.tenantA.id, surgeryId },
    });
    expect(movements.length).toBe(0);
  });

  it('markComplication: structured detail set + complicationFlag true', async () => {
    const surgeryId = await createSurgery();
    const res = await trpcMutation<SurgeryRow>(app, doctorToken, 'surgery.markComplication', {
      surgeryId,
      category: 'macula_edema',
      severity: 'severe',
      description: 'Post-op makülar ödem geliştir; flurometazon başlandı',
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.complicationFlag).toBe(true);
    expect(res.body.result.data.complicationDetail?.category).toBe('macula_edema');
    expect(res.body.result.data.complicationDetail?.severity).toBe('severe');
  });

  it('markComplication invalid severity → 400', async () => {
    const surgeryId = await createSurgery();
    const res = await trpcMutation<SurgeryRow>(app, doctorToken, 'surgery.markComplication', {
      surgeryId,
      category: 'iris_damage',
      severity: 'CRITICAL', // valid: mild/moderate/severe
      description: 'x',
    });
    expect(res.status).toBe(400);
  });
});
