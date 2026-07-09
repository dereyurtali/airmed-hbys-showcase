import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// D1 PR 3 — Admin tRPC router: listTriggers / updateTriggerConfig /
// listTemplates / updateTemplate / listDeliveries / listByPatient.

interface LoginBody {
  accessToken: string;
}
interface TrpcSuccess<T> {
  result: { data: T };
}
interface TriggerRow {
  id: string;
  key: string;
  isEnabled: boolean;
  isMandatory: boolean;
  channels: string[];
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
}
interface TemplateRow {
  id: string;
  triggerKey: string;
  language: string;
  channelType: string;
  subject: string | null;
  body: string;
  isActive: boolean;
}
interface DeliveryRow {
  id: string;
  triggerKey: string;
  recipient: string;
  status: string;
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

async function trpcQuery<T>(app: INestApplication, token: string, path: string, input: unknown) {
  const res = await request(app.getHttpServer() as App)
    .get(`/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body as TrpcSuccess<T> };
}

async function trpcMutation<T>(app: INestApplication, token: string, path: string, body: unknown) {
  const res = await request(app.getHttpServer() as App)
    .post(`/api/trpc/${path}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  return { status: res.status, body: res.body as TrpcSuccess<T> };
}

describe('D1 PR 3 — admin tRPC router (templates + triggers + deliveries)', () => {
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
        email: 'd1pr3@a.tj',
        passwordHash: hash,
        name: 'Dr. Admin Test',
        status: 'active',
      },
    });
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: u.id, roleId: doktorRole.id },
    });
    doctorToken = await login(app, fixtures.tenantA.slug, 'd1pr3@a.tj', 'doktor-pass-1234');
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.messageDelivery.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ---------- Triggers ----------

  it('listTriggers (idempotent ensureDefaults) → 24 trigger', async () => {
    const res = await trpcQuery<TriggerRow[]>(app, adminToken, 'messaging.listTriggers', {});
    expect(res.status).toBe(200);
    expect(res.body.result.data.length).toBe(24);
    const complication = res.body.result.data.find((t) => t.key === 'COMPLICATION_DOCTOR_ALERT');
    expect(complication?.isMandatory).toBe(true);
  });

  it('listTriggers filtered by category', async () => {
    const res = await trpcQuery<TriggerRow[]>(app, adminToken, 'messaging.listTriggers', {
      category: 'RANDEVU',
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.length).toBe(8);
  });

  it('updateTriggerConfig: yönetici isEnabled toggle + quiet hours set', async () => {
    const list = await trpcQuery<TriggerRow[]>(app, adminToken, 'messaging.listTriggers', {});
    const target = list.body.result.data.find((t) => t.key === 'NEW_PATIENT_WELCOME')!;
    const res = await trpcMutation<TriggerRow>(app, adminToken, 'messaging.updateTriggerConfig', {
      id: target.id,
      isEnabled: true,
      quietHoursStart: 22,
      quietHoursEnd: 7,
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.isEnabled).toBe(true);
    expect(res.body.result.data.quietHoursStart).toBe(22);
    expect(res.body.result.data.quietHoursEnd).toBe(7);
  });

  it('updateTriggerConfig: mandatory trigger isEnabled=false → 400', async () => {
    const list = await trpcQuery<TriggerRow[]>(app, adminToken, 'messaging.listTriggers', {});
    const mandatory = list.body.result.data.find((t) => t.key === 'COMPLICATION_DOCTOR_ALERT')!;
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/messaging.updateTriggerConfig')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ id: mandatory.id, isEnabled: false });
    expect(res.status).toBe(400);
  });

  it('updateTriggerConfig: doktor (non-manager) → 403', async () => {
    const list = await trpcQuery<TriggerRow[]>(app, doctorToken, 'messaging.listTriggers', {});
    const target = list.body.result.data[0];
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/messaging.updateTriggerConfig')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ id: target.id, isEnabled: false });
    expect(res.status).toBe(403);
  });

  // ---------- Templates ----------

  it('listTemplates: 24 template default (18 TR + 6 post-op çok dilli)', async () => {
    const res = await trpcQuery<TemplateRow[]>(app, adminToken, 'messaging.listTemplates', {});
    expect(res.status).toBe(200);
    expect(res.body.result.data.length).toBe(24);
  });

  it('listTemplates filtered by triggerKey', async () => {
    const res = await trpcQuery<TemplateRow[]>(app, adminToken, 'messaging.listTemplates', {
      triggerKey: 'APPOINTMENT_CONFIRMATION',
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.length).toBe(1);
    expect(res.body.result.data[0].body).toContain('Sayın');
  });

  it('updateTemplate: yönetici subject + body düzenler', async () => {
    const list = await trpcQuery<TemplateRow[]>(app, adminToken, 'messaging.listTemplates', {
      triggerKey: 'APPOINTMENT_CONFIRMATION',
    });
    const tpl = list.body.result.data[0];
    const res = await trpcMutation<TemplateRow>(app, adminToken, 'messaging.updateTemplate', {
      id: tpl.id,
      subject: 'Yeni başlık',
      body: 'Yeni gövde {{patientName}}',
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.subject).toBe('Yeni başlık');
    expect(res.body.result.data.body).toContain('Yeni gövde');
  });

  it('updateTemplate: doktor → 403', async () => {
    const list = await trpcQuery<TemplateRow[]>(app, adminToken, 'messaging.listTemplates', {
      triggerKey: 'APPOINTMENT_CONFIRMATION',
    });
    const tpl = list.body.result.data[0];
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/messaging.updateTemplate')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ id: tpl.id, body: 'hack' });
    expect(res.status).toBe(403);
  });

  // ---------- Deliveries ----------

  it('listDeliveries: yeni delivery insert + listede görünür', async () => {
    await prisma.messageDelivery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        triggerKey: 'APPOINTMENT_CONFIRMATION',
        channelType: 'MOCK',
        recipient: '+992777111000',
        subject: 'X',
        body: 'Y',
        contextSnapshot: {},
        status: 'SENT',
        scheduledAt: new Date(),
        sentAt: new Date(),
      },
    });
    const res = await trpcQuery<{ items: DeliveryRow[]; total: number }>(
      app,
      adminToken,
      'messaging.listDeliveries',
      { page: 1, pageSize: 50 },
    );
    expect(res.status).toBe(200);
    expect(res.body.result.data.total).toBe(1);
    expect(res.body.result.data.items[0].recipient).toBe('+992777111000');
  });

  it('listDeliveries filtered by status', async () => {
    await prisma.messageDelivery.createMany({
      data: [
        {
          tenantId: fixtures.tenantA.id,
          triggerKey: 'APPOINTMENT_CONFIRMATION',
          channelType: 'MOCK',
          recipient: '+992111111111',
          subject: null,
          body: 'a',
          contextSnapshot: {},
          status: 'SENT',
          scheduledAt: new Date(),
        },
        {
          tenantId: fixtures.tenantA.id,
          triggerKey: 'APPOINTMENT_CONFIRMATION',
          channelType: 'MOCK',
          recipient: '+992222222222',
          subject: null,
          body: 'b',
          contextSnapshot: {},
          status: 'FAILED',
          scheduledAt: new Date(),
        },
      ],
    });
    const res = await trpcQuery<{ items: DeliveryRow[]; total: number }>(
      app,
      adminToken,
      'messaging.listDeliveries',
      { status: 'FAILED', page: 1, pageSize: 50 },
    );
    expect(res.status).toBe(200);
    expect(res.body.result.data.total).toBe(1);
    expect(res.body.result.data.items[0].status).toBe('FAILED');
  });

  it('listByPatient: patient.phone match → kendi delivery satırlarını döner', async () => {
    const patient = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'D1PR3-P1',
        firstName: 'P',
        lastName: 'Phone',
        birthDate: new Date('1990-01-01'),
        gender: 'female',
        phone: '+992999888777',
      },
    });
    await prisma.messageDelivery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        triggerKey: 'APPOINTMENT_CONFIRMATION',
        channelType: 'MOCK',
        recipient: '+992999888777',
        subject: null,
        body: 'patient-msg',
        contextSnapshot: {},
        status: 'SENT',
        scheduledAt: new Date(),
      },
    });
    const res = await trpcQuery<DeliveryRow[]>(app, adminToken, 'messaging.listByPatient', {
      patientId: patient.id,
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.length).toBe(1);
    expect(res.body.result.data[0].body).toBe('patient-msg');
  });
});
