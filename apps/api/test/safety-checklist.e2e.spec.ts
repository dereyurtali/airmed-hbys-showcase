import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// S15-PR3 — WHO Surgical Safety Checklist tRPC endpoint'leri:
// catalog (21 item) + get/create + confirmItem + markPhase complete.

interface LoginBody {
  accessToken: string;
}

interface TrpcSuccess<T> {
  result: { data: T };
}

interface ChecklistState {
  id: string;
  surgeryId: string;
  items: Record<
    string,
    {
      confirmed: boolean;
      confirmedBy: string | null;
      confirmedAt: string | null;
      notes: string | null;
    }
  >;
  phaseStatus: {
    sign_in: { complete: boolean; completedAt: string | null; completedBy: string | null };
    time_out: { complete: boolean; completedAt: string | null; completedBy: string | null };
    sign_out: { complete: boolean; completedAt: string | null; completedBy: string | null };
  };
  fullyComplete: boolean;
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

describe('S15-PR3 Surgical Safety Checklist', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let surgeryId: string;

  // 7 sign_in + 9 time_out (incl. 2 ICO ophth items, 1 optional) + 5 sign_out =
  // 21 toplam. Aşağıdaki listelerde testin kullandığı kanonik key'ler.
  const SIGN_IN_REQUIRED = [
    'sign_in.patient_identity',
    'sign_in.site_marked',
    'sign_in.anesthesia_safety_check',
    'sign_in.pulse_oximeter',
    'sign_in.allergies_known',
    'sign_in.difficult_airway_risk',
    'sign_in.blood_loss_risk',
  ];

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
    // Doktor yoksa yarat — fixtures default seed'inde olmayabilir
    let doctor = await prisma.doctor.findFirst({
      where: { tenantId: fixtures.tenantA.id, deletedAt: null },
      select: { id: true },
    });
    if (!doctor) {
      doctor = await prisma.doctor.create({
        data: {
          tenantId: fixtures.tenantA.id,
          name: 'Test Doctor',
          specialty: 'ophthalmology',
        },
        select: { id: true },
      });
    }
    const surgery = await prisma.surgery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctor.id,
        type: 'cataract',
        scheduledAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
    surgeryId = surgery.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('catalog returns 21 items across 3 phases', async () => {
    const res = await trpcQuery<
      Array<{ key: string; phase: string; required: boolean; i18nLabelKey: string }>
    >(app, adminToken, 'surgery.safetyChecklist.catalog', undefined);
    expect(res.status).toBe(200);
    const items = res.body.result.data;
    expect(items.length).toBe(21);
    const phaseCounts = items.reduce<Record<string, number>>((acc, it) => {
      acc[it.phase] = (acc[it.phase] ?? 0) + 1;
      return acc;
    }, {});
    expect(phaseCounts.sign_in).toBe(7);
    expect(phaseCounts.time_out).toBe(9);
    expect(phaseCounts.sign_out).toBe(5);
  });

  it('get creates empty checklist on first access (idempotent)', async () => {
    const res1 = await trpcQuery<ChecklistState>(app, adminToken, 'surgery.safetyChecklist.get', {
      surgeryId,
    });
    expect(res1.status).toBe(200);
    expect(res1.body.result.data.fullyComplete).toBe(false);
    expect(res1.body.result.data.phaseStatus.sign_in.complete).toBe(false);

    const res2 = await trpcQuery<ChecklistState>(app, adminToken, 'surgery.safetyChecklist.get', {
      surgeryId,
    });
    expect(res2.body.result.data.id).toBe(res1.body.result.data.id);
  });

  it('confirmItem toggles state and stamps confirmedBy + confirmedAt', async () => {
    const res = await trpcMutation<ChecklistState>(
      app,
      adminToken,
      'surgery.safetyChecklist.confirmItem',
      { surgeryId, itemKey: 'sign_in.patient_identity', confirmed: true },
    );
    expect(res.status).toBe(200);
    const item = res.body.result.data.items['sign_in.patient_identity'];
    expect(item.confirmed).toBe(true);
    expect(item.confirmedBy).toBeTruthy();
    expect(item.confirmedAt).toBeTruthy();
  });

  it('confirmItem rejects unknown itemKey', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/surgery.safetyChecklist.confirmItem')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ surgeryId, itemKey: 'sign_in.fictional_step', confirmed: true });
    expect(res.status).toBe(400);
  });

  it('markPhase fails when required items missing', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/surgery.safetyChecklist.markPhase')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ surgeryId, phase: 'sign_in' });
    expect(res.status).toBe(400);
  });

  it('markPhase succeeds after all required confirmed', async () => {
    for (const key of SIGN_IN_REQUIRED) {
      await trpcMutation(app, adminToken, 'surgery.safetyChecklist.confirmItem', {
        surgeryId,
        itemKey: key,
        confirmed: true,
      });
    }
    const res = await trpcMutation<ChecklistState>(
      app,
      adminToken,
      'surgery.safetyChecklist.markPhase',
      { surgeryId, phase: 'sign_in' },
    );
    expect(res.status).toBe(200);
    expect(res.body.result.data.phaseStatus.sign_in.complete).toBe(true);
    expect(res.body.result.data.phaseStatus.sign_in.completedAt).toBeTruthy();
  });

  it('reception role rejected from confirmItem (permission gate)', async () => {
    const recToken = await login(
      app,
      fixtures.tenantA.slug,
      fixtures.tenantA.receptionistEmail,
      fixtures.tenantA.receptionistPassword,
    );
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/surgery.safetyChecklist.confirmItem')
      .set('Authorization', `Bearer ${recToken}`)
      .send({ surgeryId, itemKey: 'sign_in.patient_identity', confirmed: true });
    // Resepsiyon surgicalSafetyCheck.confirm yetkisinde değil.
    expect(res.status).toBe(403);
  });
});
