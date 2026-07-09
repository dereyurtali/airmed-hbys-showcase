import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// S16 — Yönetici "Genel Bakış" agregat endpoint'leri:
//   dashboard.adminOverview   (action:approval.list = ADMIN_ROLES)
//   dashboard.pendingApprovals(action:approval.list = ADMIN_ROLES)
//   dashboard.stockOverview   (page:iolInventory = yonetici/asistan/hemsire)
// Kapsam: yetki gate (admin 200 / resepsiyon 403), yanıt şekli, ve düşük-stok
// senaryosu (Consumable + IolModel stockOverview'da görünür + low=true).

interface LoginBody {
  accessToken: string;
}
interface TrpcSuccess<T> {
  result: { data: T };
}

interface AdminOverview {
  clinicName: string;
  todayExaminations: number;
  todayCollected: { amount: string; currency: string; deltaPercent: number | null };
  activeSurgerySales: number;
  pendingApprovalCount: number;
  pendingApprovals: unknown[];
  lowStock: {
    kind: string;
    lensType: string | null;
    name: string | null;
    availableQty: number;
    minQty: number;
  }[];
  lensNeeds: unknown[];
}
interface StockOverview {
  clinicName: string;
  lenses: {
    lensType: string | null;
    code: string;
    total: number;
    reserved: number;
    available: number;
    minQty: number;
    low: boolean;
  }[];
  supplies: {
    name: string | null;
    code: string;
    total: number;
    reserved: number;
    available: number;
    minQty: number;
    low: boolean;
  }[];
  drugs: { name: string | null; available: number; low: boolean }[];
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

async function trpcGet<T>(app: INestApplication, token: string, route: string) {
  const res = await request(app.getHttpServer() as App)
    .get(`/api/trpc/${route}`)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body as TrpcSuccess<T> };
}

describe('S16 Admin overview (KPIs + approvals + stock) — gate + shape', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let resepToken: string;

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

    // Resepsiyon kullanıcısı — gate testi (adminOverview/stockOverview'a erişemez).
    const resepRole = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: fixtures.tenantA.id, key: 'resepsiyon' } },
    });
    const hash = await bcrypt.hash('resep-pass-1234', 4);
    const u = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: 'resep@a-overview.test',
        passwordHash: hash,
        name: 'Resep Test',
        status: 'active',
      },
    });
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: u.id, roleId: resepRole.id },
    });
    resepToken = await login(
      app,
      fixtures.tenantA.slug,
      'resep@a-overview.test',
      'resep-pass-1234',
    );

    // Düşük-stoklu sarf malzeme: available(2) <= minQty(8).
    await prisma.consumable.create({
      data: {
        tenantId: fixtures.tenantA.id,
        name: 'Keratom Bıçağı Test',
        code: 'BLADE-T',
        category: 'supply',
        unit: 'adet',
        availableQty: 2,
        reservedQty: 1,
        minQty: 8,
        isActive: true,
      },
    });
    // İlaç (drug) — sağlıklı stok.
    await prisma.consumable.create({
      data: {
        tenantId: fixtures.tenantA.id,
        name: 'Anti-VEGF Test',
        code: 'AV-T',
        category: 'drug',
        unit: 'flakon',
        availableQty: 9,
        reservedQty: 0,
        minQty: 3,
        isActive: true,
      },
    });
    // IOL modeli + lot: available(1) <= minQty(8) → kritik lens.
    const model = await prisma.iolModel.create({
      data: {
        tenantId: fixtures.tenantA.id,
        brand: 'Alcon',
        model: 'PanOptix Test',
        lensType: 'trifocal',
        minQty: 8,
        isActive: true,
      },
    });
    await prisma.iolLot.create({
      data: {
        tenantId: fixtures.tenantA.id,
        modelId: model.id,
        lotNumber: 'LOT-TEST-1',
        power: 21.0,
        quantity: 4,
        availableQty: 1,
        reservedQty: 3,
        consumedQty: 0,
        expiresAt: new Date('2027-12-31'),
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('adminOverview: yönetici → 200 + beklenen şekil', async () => {
    const res = await trpcGet<AdminOverview>(app, adminToken, 'dashboard.adminOverview');
    expect(res.status).toBe(200);
    const d = res.body.result.data;
    expect(typeof d.todayExaminations).toBe('number');
    expect(typeof d.activeSurgerySales).toBe('number');
    expect(typeof d.pendingApprovalCount).toBe('number');
    expect(d.todayCollected.currency).toBe('TJS');
    expect(typeof d.todayCollected.amount).toBe('string');
    expect(Array.isArray(d.pendingApprovals)).toBe(true);
    expect(Array.isArray(d.lowStock)).toBe(true);
    expect(Array.isArray(d.lensNeeds)).toBe(true);
    // Kritik stok: seed'lenen trifocal lens + keratom sarf görünür (low).
    const lowNames = d.lowStock.map((s) => s.name ?? s.lensType);
    expect(lowNames).toContain('Keratom Bıçağı Test');
    expect(lowNames).toContain('trifocal');
  });

  it('adminOverview: resepsiyon → 403 (admin gate)', async () => {
    const res = await trpcGet<AdminOverview>(app, resepToken, 'dashboard.adminOverview');
    expect(res.status).toBe(403);
  });

  it('pendingApprovals: yönetici → 200 + items dizisi', async () => {
    const res = await trpcGet<{ clinicName: string; items: unknown[] }>(
      app,
      adminToken,
      'dashboard.pendingApprovals',
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.result.data.items)).toBe(true);
  });

  it('pendingApprovals: resepsiyon → 403', async () => {
    const res = await trpcGet(app, resepToken, 'dashboard.pendingApprovals');
    expect(res.status).toBe(403);
  });

  it('stockOverview: yönetici → 200 + Lensler/Sarf/İlaç grupları + low bayrağı', async () => {
    const res = await trpcGet<StockOverview>(app, adminToken, 'dashboard.stockOverview');
    expect(res.status).toBe(200);
    const d = res.body.result.data;
    expect(Array.isArray(d.lenses)).toBe(true);
    expect(Array.isArray(d.supplies)).toBe(true);
    expect(Array.isArray(d.drugs)).toBe(true);

    // Trifocal lens: available 1 <= minQty 8 → low, total = available + reserved.
    const lens = d.lenses.find((l) => l.lensType === 'trifocal');
    expect(lens).toBeDefined();
    expect(lens!.available).toBe(1);
    expect(lens!.reserved).toBe(3);
    expect(lens!.total).toBe(4);
    expect(lens!.low).toBe(true);

    // Sarf: Keratom düşük; İlaç: Anti-VEGF sağlıklı.
    const blade = d.supplies.find((s) => s.name === 'Keratom Bıçağı Test');
    expect(blade).toBeDefined();
    expect(blade!.total).toBe(3); // 2 available + 1 reserved
    expect(blade!.low).toBe(true);
    const drug = d.drugs.find((x) => x.name === 'Anti-VEGF Test');
    expect(drug).toBeDefined();
    expect(drug!.low).toBe(false);
  });

  it('stockOverview: resepsiyon → 403 (page:iolInventory gate)', async () => {
    const res = await trpcGet(app, resepToken, 'dashboard.stockOverview');
    expect(res.status).toBe(403);
  });
});
