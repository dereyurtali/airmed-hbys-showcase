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

interface ChecklistItemRow {
  key: string;
  completed: boolean;
  completedById?: string | null;
  completedAt?: string | null;
  notes?: string | null;
}

interface PreOpRow {
  id: string;
  surgeryId: string;
  vitalSigns: Record<string, number | undefined>;
  dilatationAt: string | null;
  checklistItems: ChecklistItemRow[];
  anesthesiaNotes: string | null;
  lensIolLotId: string | null;
  lensReservedAt: string | null;
  readyForSurgery: boolean;
  readyAt: string | null;
  readyById: string | null;
  lensIolLot: {
    id: string;
    lotNumber: string;
    quantity: number;
    model: { brand: string; model: string };
  } | null;
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

const REQUIRED_KEYS = [
  'fasting_8h',
  'blood_sugar',
  'blood_pressure',
  'pupil_dilation',
  'antibiotic_prophylaxis',
  'consent_signed',
  // S15-PR15 — Anestezi konsültasyonu zorunlu pre-op item
  'anesthesia_consult_completed',
  'surgeon_ready',
];

describe('B3 Pre-op (tRPC + RBAC + readiness gate)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let doctorToken: string;
  let receptionToken: string;
  let doctorProfileId: string;
  let surgeryId: string;
  let iolModelId: string;
  let iolLotId: string;
  let emptyLotId: string;

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
    const recepRole = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: fixtures.tenantA.id, key: 'resepsiyon' } },
    });

    const doctorEmail = 'doktor@a-preop.test';
    const doctorPassword = 'doktor-pass-1234';
    const docHash = await bcrypt.hash(doctorPassword, 4);
    const doctorUser = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: doctorEmail,
        passwordHash: docHash,
        name: 'Dr. PreOp',
        status: 'active',
      },
    });
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: doctorUser.id, roleId: doktorRole.id },
    });
    const doctorProfile = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        userId: doctorUser.id,
        name: 'Dr. PreOp',
        specialty: 'Göz',
        type: 'local',
      },
    });
    doctorProfileId = doctorProfile.id;
    doctorToken = await login(app, fixtures.tenantA.slug, doctorEmail, doctorPassword);

    const recepEmail = 'recep@a-preop.test';
    const recepPassword = 'recep-pass-1234';
    const recHash = await bcrypt.hash(recepPassword, 4);
    const recepUser = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: recepEmail,
        passwordHash: recHash,
        name: 'Resepsiyon Test',
        status: 'active',
      },
    });
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: recepUser.id, roleId: recepRole.id },
    });
    receptionToken = await login(app, fixtures.tenantA.slug, recepEmail, recepPassword);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.preOp.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.iolStockMovement.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.iolLot.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.iolModel.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.surgery.deleteMany({ where: { tenantId: fixtures.tenantA.id } });

    const s = await prisma.surgery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        type: 'Cataract / Phaco',
        status: 'planned',
        scheduledAt: new Date('2026-06-15T08:00:00.000Z'),
      },
    });
    surgeryId = s.id;

    const model = await prisma.iolModel.create({
      data: {
        tenantId: fixtures.tenantA.id,
        brand: 'Alcon',
        model: 'SN60WF',
        isActive: true,
      },
    });
    iolModelId = model.id;
    const lot = await prisma.iolLot.create({
      data: {
        tenantId: fixtures.tenantA.id,
        modelId: iolModelId,
        lotNumber: 'L-PREOP-1',
        power: '22.0',
        quantity: 5,
        // #364 — 3-state: pre-op lens seçimi artık reserve() çağırır (available
        // → reserved), bu yüzden fixture availableQty set etmeli.
        availableQty: 5,
        expiresAt: new Date('2027-12-31'),
      },
    });
    iolLotId = lot.id;
    const empty = await prisma.iolLot.create({
      data: {
        tenantId: fixtures.tenantA.id,
        modelId: iolModelId,
        lotNumber: 'L-EMPTY-1',
        power: '20.0',
        quantity: 0,
        expiresAt: new Date('2027-12-31'),
      },
    });
    emptyLotId = empty.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function completeAllChecklist(token: string, ids: string[]) {
    for (const key of ids) {
      await trpcMutation<PreOpRow>(app, token, 'preOp.patchChecklistItem', {
        surgeryId,
        key,
        completed: true,
      });
    }
  }

  it('create golden: doktor pre-op açar, default checklist + boş vitals', async () => {
    const res = await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.create', { surgeryId });
    expect(res.status).toBe(200);
    expect(res.body.result.data.surgeryId).toBe(surgeryId);
    expect(res.body.result.data.readyForSurgery).toBe(false);
    const keys = res.body.result.data.checklistItems.map((i) => i.key).sort();
    expect(keys).toEqual([...REQUIRED_KEYS, 'lens_reserved'].sort());
  });

  it('create idempotency: ikinci kez 409', async () => {
    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.create', { surgeryId });
    const dup = await trpcMutation<unknown>(app, doctorToken, 'preOp.create', { surgeryId });
    expect(dup.status).toBe(409);
  });

  it('resepsiyon create → 403 (write rolü yok)', async () => {
    const res = await trpcMutation<unknown>(app, receptionToken, 'preOp.create', { surgeryId });
    expect(res.status).toBe(403);
  });

  it('update vital signs + dilatationAt + anesthesia notes', async () => {
    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.create', { surgeryId });
    const upd = await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.update', {
      surgeryId,
      vitalSigns: { systolic: 130, diastolic: 80, pulse: 72, bloodSugar: 110 },
      dilatationAt: '2026-06-15T07:30:00.000Z',
      anesthesiaNotes: 'Topikal anestezi planlandı',
    });
    expect(upd.status).toBe(200);
    expect(upd.body.result.data.vitalSigns.systolic).toBe(130);
    expect(upd.body.result.data.dilatationAt).toBeTruthy();
    expect(upd.body.result.data.anesthesiaNotes).toBe('Topikal anestezi planlandı');
  });

  it('lens reservation: lot connect + lensReservedAt set', async () => {
    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.create', { surgeryId });
    const res = await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.update', {
      surgeryId,
      lensIolLotId: iolLotId,
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.lensIolLotId).toBe(iolLotId);
    expect(res.body.result.data.lensReservedAt).toBeTruthy();
    expect(res.body.result.data.lensIolLot?.lotNumber).toBe('L-PREOP-1');
  });

  it('lens reservation: stoksuz lot → 400', async () => {
    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.create', { surgeryId });
    const res = await trpcMutation<unknown>(app, doctorToken, 'preOp.update', {
      surgeryId,
      lensIolLotId: emptyLotId,
    });
    expect(res.status).toBe(400);
  });

  it('patchChecklistItem: completed=true completedById + completedAt set', async () => {
    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.create', { surgeryId });
    const res = await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.patchChecklistItem', {
      surgeryId,
      key: 'fasting_8h',
      completed: true,
      notes: '8 saat açlık doğrulandı',
    });
    expect(res.status).toBe(200);
    const item = res.body.result.data.checklistItems.find((i) => i.key === 'fasting_8h');
    expect(item?.completed).toBe(true);
    expect(item?.completedById).toBeTruthy();
    expect(item?.completedAt).toBeTruthy();
    expect(item?.notes).toBe('8 saat açlık doğrulandı');
  });

  it('markReady gate: vitals eksikse 400', async () => {
    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.create', { surgeryId });
    const res = await trpcMutation<unknown>(app, doctorToken, 'preOp.markReady', { surgeryId });
    expect(res.status).toBe(400);
  });

  it('markReady gate: vitals ok ama dilatationAt eksik → 400', async () => {
    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.create', { surgeryId });
    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.update', {
      surgeryId,
      vitalSigns: { systolic: 120, diastolic: 78 },
    });
    const res = await trpcMutation<unknown>(app, doctorToken, 'preOp.markReady', { surgeryId });
    expect(res.status).toBe(400);
  });

  it('markReady golden: tüm gate koşulları dolu, readyForSurgery=true + readyAt + readyById', async () => {
    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.create', { surgeryId });
    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.update', {
      surgeryId,
      vitalSigns: { systolic: 120, diastolic: 78, pulse: 70 },
      dilatationAt: '2026-06-15T07:30:00.000Z',
    });
    await completeAllChecklist(doctorToken, REQUIRED_KEYS);
    const res = await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.markReady', { surgeryId });
    expect(res.status).toBe(200);
    expect(res.body.result.data.readyForSurgery).toBe(true);
    expect(res.body.result.data.readyAt).toBeTruthy();
    expect(res.body.result.data.readyById).toBeTruthy();
  });

  it('markReady gate: lens reserved ise lens_reserved checklist otomatik gerekli', async () => {
    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.create', { surgeryId });
    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.update', {
      surgeryId,
      vitalSigns: { systolic: 120, diastolic: 78 },
      dilatationAt: '2026-06-15T07:30:00.000Z',
      lensIolLotId: iolLotId,
    });
    await completeAllChecklist(doctorToken, REQUIRED_KEYS);
    // lens_reserved henüz işaretli değil
    const fail = await trpcMutation<unknown>(app, doctorToken, 'preOp.markReady', { surgeryId });
    expect(fail.status).toBe(400);

    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.patchChecklistItem', {
      surgeryId,
      key: 'lens_reserved',
      completed: true,
    });
    const ok = await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.markReady', { surgeryId });
    expect(ok.status).toBe(200);
    expect(ok.body.result.data.readyForSurgery).toBe(true);
  });

  it('update: readyForSurgery=true sonrası edit blocked (400)', async () => {
    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.create', { surgeryId });
    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.update', {
      surgeryId,
      vitalSigns: { systolic: 120, diastolic: 78 },
      dilatationAt: '2026-06-15T07:30:00.000Z',
    });
    await completeAllChecklist(doctorToken, REQUIRED_KEYS);
    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.markReady', { surgeryId });

    const blocked = await trpcMutation<unknown>(app, doctorToken, 'preOp.update', {
      surgeryId,
      anesthesiaNotes: 'sonradan eklenen not',
    });
    expect(blocked.status).toBe(400);
  });

  it('unmarkReady: sadece yönetici → doktor 403, yönetici 200', async () => {
    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.create', { surgeryId });
    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.update', {
      surgeryId,
      vitalSigns: { systolic: 120, diastolic: 78 },
      dilatationAt: '2026-06-15T07:30:00.000Z',
    });
    await completeAllChecklist(doctorToken, REQUIRED_KEYS);
    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.markReady', { surgeryId });

    const docTry = await trpcMutation<unknown>(app, doctorToken, 'preOp.unmarkReady', {
      surgeryId,
    });
    expect(docTry.status).toBe(403);

    const adminOk = await trpcMutation<PreOpRow>(app, adminToken, 'preOp.unmarkReady', {
      surgeryId,
    });
    expect(adminOk.status).toBe(200);
    expect(adminOk.body.result.data.readyForSurgery).toBe(false);
  });

  it('cross-tenant: tenantB token tenantA surgery için pre-op oluşturamaz (404)', async () => {
    const tokenB = await login(
      app,
      fixtures.tenantB.slug,
      fixtures.tenantB.adminEmail,
      fixtures.tenantB.adminPassword,
    );
    const res = await trpcMutation<unknown>(app, tokenB, 'preOp.create', { surgeryId });
    expect(res.status).toBe(404);
  });

  it('getBySurgery query: yok ise null döner', async () => {
    const res = await trpcQuery<PreOpRow | null>(app, doctorToken, 'preOp.getBySurgery', {
      surgeryId,
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data).toBeNull();
  });

  it('softDelete: sadece yönetici, sonra getBySurgery null döner', async () => {
    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.create', { surgeryId });
    const docTry = await trpcMutation<unknown>(app, doctorToken, 'preOp.softDelete', {
      surgeryId,
    });
    expect(docTry.status).toBe(403);

    const adminOk = await trpcMutation<null>(app, adminToken, 'preOp.softDelete', { surgeryId });
    expect(adminOk.status).toBe(200);

    const after = await trpcQuery<PreOpRow | null>(app, doctorToken, 'preOp.getBySurgery', {
      surgeryId,
    });
    expect(after.body.result.data).toBeNull();
  });
});
