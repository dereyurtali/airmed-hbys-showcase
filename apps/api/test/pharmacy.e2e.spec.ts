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

interface SupplierRow {
  id: string;
  name: string;
  category: string;
  isActive: boolean;
}

interface PrescriptionRow {
  id: string;
  type: string;
  supplierId: string | null;
  items: unknown[];
  sentAt: string | null;
  createdById: string | null;
}

async function login(app: INestApplication, slug: string, email: string, password: string) {
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

describe('E3 Pharmacy (supplier + prescription + send)', () => {
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

    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    const doktorRole = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: fixtures.tenantA.id, key: 'doktor' } },
    });
    const doctorEmail = 'doktor@a-pharmacy.test';
    const doctorPassword = 'doktor-pass-1234';
    const hash = await bcrypt.hash(doctorPassword, 4);
    const doctorUser = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: doctorEmail,
        passwordHash: hash,
        name: 'Dr. Pharmacy Test',
        status: 'active',
      },
    });
    doctorUserId = doctorUser.id;
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: doctorUser.id, roleId: doktorRole.id },
    });
    doctorToken = await login(app, fixtures.tenantA.slug, doctorEmail, doctorPassword);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.prescription.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.supplier.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('admin createSupplier golden', async () => {
    const res = await trpcMutation<SupplierRow>(app, adminToken, 'pharmacy.createSupplier', {
      name: 'ABC Eczane',
      category: 'pharmacy',
      contactPhone: '+992 123 4567',
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.name).toBe('ABC Eczane');
    expect(res.body.result.data.isActive).toBe(true);
  });

  it('doktor createSupplier → 403', async () => {
    const res = await trpcMutation<unknown>(app, doctorToken, 'pharmacy.createSupplier', {
      name: 'X Eczane',
      category: 'pharmacy',
    });
    expect(res.status).toBe(403);
  });

  it('listSuppliers category filter', async () => {
    await prisma.supplier.createMany({
      data: [
        { tenantId: fixtures.tenantA.id, name: 'P1', category: 'pharmacy' },
        { tenantId: fixtures.tenantA.id, name: 'O1', category: 'optic' },
      ],
    });
    const res = await trpcQuery<SupplierRow[]>(app, adminToken, 'pharmacy.listSuppliers', {
      category: 'optic',
    });
    expect(res.body.result.data).toHaveLength(1);
    expect(res.body.result.data[0]!.category).toBe('optic');
  });

  it('createPrescription drug golden', async () => {
    const supplier = await prisma.supplier.create({
      data: { tenantId: fixtures.tenantA.id, name: 'P1', category: 'pharmacy' },
    });
    const res = await trpcMutation<PrescriptionRow>(
      app,
      doctorToken,
      'pharmacy.createPrescription',
      {
        patientId: fixtures.tenantA.patientId,
        type: 'drug',
        supplierId: supplier.id,
        items: [{ name: 'Tobradex', dose: '1 damla', frequency: '4x', duration: '7 gün' }],
        notes: 'Ameliyat sonrası',
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.result.data.type).toBe('drug');
    expect(res.body.result.data.createdById).toBe(doctorUserId);
  });

  it('createPrescription: supplier kategori uyumsuz (eyewear → pharmacy) → 400', async () => {
    const supplier = await prisma.supplier.create({
      data: { tenantId: fixtures.tenantA.id, name: 'P1', category: 'pharmacy' },
    });
    const res = await trpcMutation<unknown>(app, doctorToken, 'pharmacy.createPrescription', {
      patientId: fixtures.tenantA.patientId,
      type: 'eyewear',
      supplierId: supplier.id,
      items: [{ eye: 'OD', sphere: '-2.00' }],
    });
    expect(res.status).toBe(400);
  });

  it('sendPrescription: tedarikçi yoksa 400, varsa 200 + sentAt set', async () => {
    // Önce supplier'sız RX → send 400
    const rx1 = await trpcMutation<PrescriptionRow>(
      app,
      doctorToken,
      'pharmacy.createPrescription',
      {
        patientId: fixtures.tenantA.patientId,
        type: 'drug',
        supplierId: null,
        items: [{ name: 'X' }],
      },
    );
    const noSupplier = await trpcMutation<unknown>(app, doctorToken, 'pharmacy.sendPrescription', {
      id: rx1.body.result.data.id,
    });
    expect(noSupplier.status).toBe(400);

    // Supplier ekle, send → 200
    const supplier = await prisma.supplier.create({
      data: { tenantId: fixtures.tenantA.id, name: 'P1', category: 'pharmacy' },
    });
    const rx2 = await trpcMutation<PrescriptionRow>(
      app,
      doctorToken,
      'pharmacy.createPrescription',
      {
        patientId: fixtures.tenantA.patientId,
        type: 'drug',
        supplierId: supplier.id,
        items: [{ name: 'X' }],
      },
    );
    const sent = await trpcMutation<PrescriptionRow>(
      app,
      doctorToken,
      'pharmacy.sendPrescription',
      {
        id: rx2.body.result.data.id,
      },
    );
    expect(sent.status).toBe(200);
    expect(sent.body.result.data.sentAt).toBeTruthy();
  });

  it('sendPrescription: ikinci kez gönderme → 409', async () => {
    const supplier = await prisma.supplier.create({
      data: { tenantId: fixtures.tenantA.id, name: 'P1', category: 'pharmacy' },
    });
    const rx = await trpcMutation<PrescriptionRow>(
      app,
      doctorToken,
      'pharmacy.createPrescription',
      {
        patientId: fixtures.tenantA.patientId,
        type: 'drug',
        supplierId: supplier.id,
        items: [{ name: 'X' }],
      },
    );
    await trpcMutation<PrescriptionRow>(app, doctorToken, 'pharmacy.sendPrescription', {
      id: rx.body.result.data.id,
    });
    const again = await trpcMutation<unknown>(app, doctorToken, 'pharmacy.sendPrescription', {
      id: rx.body.result.data.id,
    });
    expect(again.status).toBe(409);
  });

  // #712 — İç eczane dispense: supplier YOK → dispenseToPharmacy 200 + sentAt;
  // supplier'a atanmış reçete iç eczaneye gönderilemez (400); ikinci dispense 409.
  it('dispenseToPharmacy: supplier yok → 200 + sentAt; supplier var → 400', async () => {
    const rxInHouse = await trpcMutation<PrescriptionRow>(
      app,
      doctorToken,
      'pharmacy.createPrescription',
      {
        patientId: fixtures.tenantA.patientId,
        type: 'drug',
        supplierId: null,
        items: [{ name: 'Parol' }],
      },
    );
    const dispensed = await trpcMutation<PrescriptionRow>(
      app,
      doctorToken,
      'pharmacy.dispenseToPharmacy',
      { id: rxInHouse.body.result.data.id },
    );
    expect(dispensed.status).toBe(200);
    expect(dispensed.body.result.data.sentAt).toBeTruthy();

    const again = await trpcMutation<unknown>(app, doctorToken, 'pharmacy.dispenseToPharmacy', {
      id: rxInHouse.body.result.data.id,
    });
    expect(again.status).toBe(409);

    const supplier = await prisma.supplier.create({
      data: { tenantId: fixtures.tenantA.id, name: 'Dış Ecza', category: 'pharmacy' },
    });
    const rxExternal = await trpcMutation<PrescriptionRow>(
      app,
      doctorToken,
      'pharmacy.createPrescription',
      {
        patientId: fixtures.tenantA.patientId,
        type: 'drug',
        supplierId: supplier.id,
        items: [{ name: 'X' }],
      },
    );
    const blocked = await trpcMutation<unknown>(app, doctorToken, 'pharmacy.dispenseToPharmacy', {
      id: rxExternal.body.result.data.id,
    });
    expect(blocked.status).toBe(400);
  });

  it('updatePrescription: gönderilmişi düzenleme → 400', async () => {
    const supplier = await prisma.supplier.create({
      data: { tenantId: fixtures.tenantA.id, name: 'P1', category: 'pharmacy' },
    });
    const rx = await trpcMutation<PrescriptionRow>(
      app,
      doctorToken,
      'pharmacy.createPrescription',
      {
        patientId: fixtures.tenantA.patientId,
        type: 'drug',
        supplierId: supplier.id,
        items: [{ name: 'X' }],
      },
    );
    await trpcMutation<PrescriptionRow>(app, doctorToken, 'pharmacy.sendPrescription', {
      id: rx.body.result.data.id,
    });
    const upd = await trpcMutation<unknown>(app, doctorToken, 'pharmacy.updatePrescription', {
      id: rx.body.result.data.id,
      data: { notes: 'edit' },
    });
    expect(upd.status).toBe(400);
  });

  it('softDeleteSupplier: pending RX varsa 409', async () => {
    const supplier = await prisma.supplier.create({
      data: { tenantId: fixtures.tenantA.id, name: 'P1', category: 'pharmacy' },
    });
    await trpcMutation<PrescriptionRow>(app, doctorToken, 'pharmacy.createPrescription', {
      patientId: fixtures.tenantA.patientId,
      type: 'drug',
      supplierId: supplier.id,
      items: [{ name: 'X' }],
    });
    const res = await trpcMutation<unknown>(app, adminToken, 'pharmacy.softDeleteSupplier', {
      id: supplier.id,
    });
    expect(res.status).toBe(409);
  });

  it('zod: type bilinmeyen → 400', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/pharmacy.createPrescription')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        patientId: fixtures.tenantA.patientId,
        type: 'unknown-type',
        items: [{ name: 'X' }],
      });
    expect(res.status).toBe(400);
  });

  it('cross-tenant: tenantB token tenantA hastaya rx açamaz (404)', async () => {
    const tokenB = await login(
      app,
      fixtures.tenantB.slug,
      fixtures.tenantB.adminEmail,
      fixtures.tenantB.adminPassword,
    );
    const res = await trpcMutation<unknown>(app, tokenB, 'pharmacy.createPrescription', {
      patientId: fixtures.tenantA.patientId,
      type: 'drug',
      items: [{ name: 'X' }],
    });
    expect(res.status).toBe(404);
  });
});
