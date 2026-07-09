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

interface ModelRow {
  id: string;
  brand: string;
  model: string;
  description: string | null;
  isActive: boolean;
}

interface LotRow {
  id: string;
  modelId: string;
  lotNumber: string;
  power: string;
  quantity: number;
  expiresAt: string;
  supplier: string | null;
  notes: string | null;
}

interface MovementRow {
  id: string;
  lotId: string;
  type: string;
  quantity: number;
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

describe('C1 IOL Inventory (tRPC + RBAC)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let doctorToken: string;

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

    // Doktor — write yetkisi yok testleri için
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const doktorRole = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: fixtures.tenantA.id, key: 'doktor' } },
    });
    const doctorEmail = 'doktor@a-iol.test';
    const doctorPassword = 'doktor-pass-1234';
    const hash = await bcrypt.hash(doctorPassword, 4);
    const doctorUser = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: doctorEmail,
        passwordHash: hash,
        name: 'Dr. IOL Test',
        status: 'active',
      },
    });
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: doctorUser.id, roleId: doktorRole.id },
    });
    doctorToken = await login(app, fixtures.tenantA.slug, doctorEmail, doctorPassword);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.iolStockMovement.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.iolLot.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.iolModel.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('admin createModel golden + duplicate → 409', async () => {
    const res = await trpcMutation<ModelRow>(app, adminToken, 'iol.createModel', {
      brand: 'Alcon',
      model: 'SN60WF',
      description: 'AcrySof IQ',
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.brand).toBe('Alcon');
    expect(res.body.result.data.isActive).toBe(true);

    const dup = await trpcMutation<unknown>(app, adminToken, 'iol.createModel', {
      brand: 'Alcon',
      model: 'SN60WF',
    });
    expect(dup.status).toBe(409);
  });

  it('doktor createModel → 403', async () => {
    const res = await trpcMutation<unknown>(app, doctorToken, 'iol.createModel', {
      brand: 'J&J',
      model: 'Tecnis',
    });
    expect(res.status).toBe(403);
  });

  it('createLot: initialQuantity → receive movement + lot.quantity eşit', async () => {
    const model = await trpcMutation<ModelRow>(app, adminToken, 'iol.createModel', {
      brand: 'Zeiss',
      model: 'CT Asphina 409M',
    });
    const lot = await trpcMutation<LotRow>(app, adminToken, 'iol.createLot', {
      modelId: model.body.result.data.id,
      lotNumber: 'LOT001',
      power: 22.5,
      expiresAt: '2027-12-31',
      initialQuantity: 10,
      supplier: 'Pegasus Medical',
    });
    expect(lot.status).toBe(200);
    expect(lot.body.result.data.quantity).toBe(10);

    const movements = await trpcQuery<MovementRow[]>(app, adminToken, 'iol.listMovements', {
      id: lot.body.result.data.id,
    });
    expect(movements.body.result.data).toHaveLength(1);
    expect(movements.body.result.data[0]!.type).toBe('receive');
    expect(movements.body.result.data[0]!.quantity).toBe(10);
  });

  it('createLot: aynı modele aynı lotNumber + power → 409', async () => {
    const model = await trpcMutation<ModelRow>(app, adminToken, 'iol.createModel', {
      brand: 'Alcon',
      model: 'SN60WF',
    });
    await trpcMutation<LotRow>(app, adminToken, 'iol.createLot', {
      modelId: model.body.result.data.id,
      lotNumber: 'L1',
      power: 21.0,
      expiresAt: '2027-01-01',
      initialQuantity: 5,
    });
    const dup = await trpcMutation<unknown>(app, adminToken, 'iol.createLot', {
      modelId: model.body.result.data.id,
      lotNumber: 'L1',
      power: 21.0,
      expiresAt: '2028-01-01',
    });
    expect(dup.status).toBe(409);
  });

  it('createMovement adjust pozitif/negatif + son qty doğru', async () => {
    const model = await trpcMutation<ModelRow>(app, adminToken, 'iol.createModel', {
      brand: 'Alcon',
      model: 'SN60WF',
    });
    const lot = await trpcMutation<LotRow>(app, adminToken, 'iol.createLot', {
      modelId: model.body.result.data.id,
      lotNumber: 'L1',
      power: 20.0,
      expiresAt: '2027-01-01',
      initialQuantity: 5,
    });
    const lotId = lot.body.result.data.id;

    // adjust +3
    await trpcMutation<MovementRow>(app, adminToken, 'iol.createMovement', {
      lotId,
      type: 'adjust',
      quantity: 3,
    });
    // adjust -2
    await trpcMutation<MovementRow>(app, adminToken, 'iol.createMovement', {
      lotId,
      type: 'adjust',
      quantity: -2,
    });

    const refreshed = await trpcQuery<LotRow>(app, adminToken, 'iol.findLotById', { id: lotId });
    expect(refreshed.body.result.data.quantity).toBe(6); // 5 + 3 - 2
  });

  it('createMovement: stok negatife düşemez → 400', async () => {
    const model = await trpcMutation<ModelRow>(app, adminToken, 'iol.createModel', {
      brand: 'Alcon',
      model: 'SN60WF',
    });
    const lot = await trpcMutation<LotRow>(app, adminToken, 'iol.createLot', {
      modelId: model.body.result.data.id,
      lotNumber: 'L1',
      power: 20.0,
      expiresAt: '2027-01-01',
      initialQuantity: 2,
    });
    const res = await trpcMutation<unknown>(app, adminToken, 'iol.createMovement', {
      lotId: lot.body.result.data.id,
      type: 'adjust',
      quantity: -5,
    });
    expect(res.status).toBe(400);
  });

  it('expire movement: işaret otomatik negatif olur', async () => {
    const model = await trpcMutation<ModelRow>(app, adminToken, 'iol.createModel', {
      brand: 'Alcon',
      model: 'SN60WF',
    });
    const lot = await trpcMutation<LotRow>(app, adminToken, 'iol.createLot', {
      modelId: model.body.result.data.id,
      lotNumber: 'L1',
      power: 20.0,
      expiresAt: '2027-01-01',
      initialQuantity: 10,
    });
    // expire 4 → service mutlak değeri negatife çevirir
    const mv = await trpcMutation<MovementRow>(app, adminToken, 'iol.createMovement', {
      lotId: lot.body.result.data.id,
      type: 'expire',
      quantity: 4,
    });
    expect(mv.body.result.data.quantity).toBe(-4);

    const refreshed = await trpcQuery<LotRow>(app, adminToken, 'iol.findLotById', {
      id: lot.body.result.data.id,
    });
    expect(refreshed.body.result.data.quantity).toBe(6);
  });

  it('listLots expiringWithinDays filtresi', async () => {
    const model = await trpcMutation<ModelRow>(app, adminToken, 'iol.createModel', {
      brand: 'Zeiss',
      model: 'Asphina',
    });
    const soon = new Date();
    soon.setDate(soon.getDate() + 30);
    const far = new Date();
    far.setDate(far.getDate() + 200);
    await trpcMutation<LotRow>(app, adminToken, 'iol.createLot', {
      modelId: model.body.result.data.id,
      lotNumber: 'SOON',
      power: 22.0,
      expiresAt: soon.toISOString().slice(0, 10),
      initialQuantity: 2,
    });
    await trpcMutation<LotRow>(app, adminToken, 'iol.createLot', {
      modelId: model.body.result.data.id,
      lotNumber: 'FAR',
      power: 22.0,
      expiresAt: far.toISOString().slice(0, 10),
      initialQuantity: 2,
    });
    const res = await trpcQuery<LotRow[]>(app, adminToken, 'iol.listLots', {
      expiringWithinDays: 60,
    });
    const lots = res.body.result.data;
    expect(lots.some((l) => l.lotNumber === 'SOON')).toBe(true);
    expect(lots.some((l) => l.lotNumber === 'FAR')).toBe(false);
  });

  it('softDeleteModel: aktif lot varsa → 409', async () => {
    const model = await trpcMutation<ModelRow>(app, adminToken, 'iol.createModel', {
      brand: 'Alcon',
      model: 'SN60WF',
    });
    await trpcMutation<LotRow>(app, adminToken, 'iol.createLot', {
      modelId: model.body.result.data.id,
      lotNumber: 'L1',
      power: 20.0,
      expiresAt: '2027-01-01',
      initialQuantity: 1,
    });
    const res = await trpcMutation<unknown>(app, adminToken, 'iol.softDeleteModel', {
      id: model.body.result.data.id,
    });
    expect(res.status).toBe(409);
  });

  it('softDeleteLot: quantity > 0 → 409', async () => {
    const model = await trpcMutation<ModelRow>(app, adminToken, 'iol.createModel', {
      brand: 'Alcon',
      model: 'SN60WF',
    });
    const lot = await trpcMutation<LotRow>(app, adminToken, 'iol.createLot', {
      modelId: model.body.result.data.id,
      lotNumber: 'L1',
      power: 20.0,
      expiresAt: '2027-01-01',
      initialQuantity: 1,
    });
    const res = await trpcMutation<unknown>(app, adminToken, 'iol.softDeleteLot', {
      id: lot.body.result.data.id,
    });
    expect(res.status).toBe(409);
  });

  it('cross-tenant: tenantB admin tenantA modeline erişemez (RLS)', async () => {
    const model = await trpcMutation<ModelRow>(app, adminToken, 'iol.createModel', {
      brand: 'Alcon',
      model: 'SN60WF',
    });
    const tokenB = await login(
      app,
      fixtures.tenantB.slug,
      fixtures.tenantB.adminEmail,
      fixtures.tenantB.adminPassword,
    );
    const res = await trpcQuery<unknown>(app, tokenB, 'iol.findModelById', {
      id: model.body.result.data.id,
    });
    expect(res.status).toBe(404);
  });
});
