import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { buildPostOpProposalsByType, getDefaultOffsetDays } from '../src/surgery/post-op-defaults';
import { completeSafetyChecklist, resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// B1 PR 3 — markCompleted hook + auto post-op control schedule.

interface LoginBody {
  accessToken: string;
}
interface TrpcSuccess<T> {
  result: { data: T };
}
interface MarkCompletedResult {
  surgery: {
    id: string;
    status: string;
    performedAt: string | null;
  };
  autoScheduledAppointments: Array<{ id: string; startsAt: string }>;
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

describe('B1 PR 3 — markCompleted + auto post-op schedule', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let doctorToken: string;
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
        email: 'b1mc@a.tj',
        passwordHash: hash,
        name: 'Dr. MarkCompleted',
        status: 'active',
      },
    });
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: u.id, roleId: doktorRole.id },
    });
    const dp = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        userId: u.id,
        name: 'Dr. MarkCompleted',
        specialty: 'Cataract',
        isActive: true,
      },
    });
    doctorProfileId = dp.id;
    doctorToken = await login(app, fixtures.tenantA.slug, 'b1mc@a.tj', 'doktor-pass-1234');
  });

  beforeEach(async () => {
    await prisma.appointment.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.surgicalSafetyCheck.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.consentSigning.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.surgery.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
  });

  async function ensureSignedConsent(patientId: string) {
    // S15-PR8 — markCompleted artık imzalı onam ister. Test seed'ine sessiz
    // bir onam koyuyoruz (template + signing). Tek beforeEach gerçek consent
    // yapısını bozar, bu helper her testten önce inline çağrılır.
    let template = await prisma.consentTemplate.findFirst({
      where: { tenantId: fixtures.tenantA.id, isActive: true },
    });
    if (!template) {
      template = await prisma.consentTemplate.create({
        data: {
          tenantId: fixtures.tenantA.id,
          procedureType: 'cataract',
          language: 'tr',
          version: 1,
          title: 'b1mc test consent',
          content: 'Test snapshot',
          isActive: true,
        },
      });
    }
    await prisma.consentSigning.create({
      data: {
        tenantId: fixtures.tenantA.id,
        templateId: template.id,
        patientId,
        language: 'tr',
        contentSnapshot: template.content,
        signatureData:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==',
      },
    });
  }

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createSurgery(type: string, withSafety = true): Promise<string> {
    const s = await prisma.surgery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        type,
        status: 'planned',
        scheduledAt: new Date('2026-07-20T09:00:00.000Z'),
      },
    });
    // S15-PR8 — markCompleted guard'ı için onam zorunlu.
    await ensureSignedConsent(fixtures.tenantA.patientId);
    // #392 — markCompleted guard'ı için WHO checklist 3 fazı tamamlanmalı.
    if (withSafety) await completeSafetyChecklist(prisma, fixtures.tenantA.id, s.id);
    return s.id;
  }

  it('getDefaultOffsetDays: cataract → [1,7,30,90]', () => {
    expect(getDefaultOffsetDays('Cataract')).toEqual([1, 7, 30, 90]);
    expect(getDefaultOffsetDays('cataract / phaco')).toEqual([1, 7, 30, 90]);
    expect(getDefaultOffsetDays('retina')).toEqual([1, 7, 14, 30, 90]);
    expect(getDefaultOffsetDays('glaucoma')).toEqual([1, 7, 30, 180]);
    expect(getDefaultOffsetDays('strabismus')).toEqual([7, 30, 90]);
    expect(getDefaultOffsetDays('UnknownType')).toEqual([7, 30, 90]); // default fallback
  });

  it('buildPostOpProposalsByType: 30dk slot, doğru offset günler', () => {
    const performedAt = new Date('2026-07-20T10:00:00.000Z');
    const proposals = buildPostOpProposalsByType('Cataract', performedAt);
    expect(proposals.length).toBe(4);
    expect(proposals[0].daysFromSurgery).toBe(1);
    // İlk slot: 21 Temmuz (1 gün sonra) — slot saat 10
    const first = new Date(proposals[0].startsAt);
    expect(first.getDate()).toBe(21);
    // End - start = 30dk
    const last = new Date(proposals[0].endsAt);
    expect(last.getTime() - first.getTime()).toBe(30 * 60_000);
  });

  it('markCompleted: cataract → status=performed + 4 appointment otomatik', async () => {
    const surgeryId = await createSurgery('Cataract');
    const res = await trpcMutation<MarkCompletedResult>(app, doctorToken, 'surgery.markCompleted', {
      surgeryId,
      performedAt: new Date('2026-07-20T10:00:00.000Z').toISOString(),
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.surgery.status).toBe('performed');
    expect(res.body.result.data.surgery.performedAt).not.toBeNull();
    expect(res.body.result.data.autoScheduledAppointments.length).toBe(4);

    // DB'de Appointment kayıtları gerçekten var mı?
    const appts = await prisma.appointment.findMany({
      where: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        type: 'control',
        notes: { contains: '#surgery:' },
      },
      orderBy: { startsAt: 'asc' },
    });
    expect(appts.length).toBe(4);
  });

  it('markCompleted: retina → 5 appointment otomatik', async () => {
    const surgeryId = await createSurgery('Retina detachment');
    const res = await trpcMutation<MarkCompletedResult>(app, doctorToken, 'surgery.markCompleted', {
      surgeryId,
      performedAt: new Date('2026-07-21T10:00:00.000Z').toISOString(),
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.autoScheduledAppointments.length).toBe(5);
  });

  it('markCompleted skipAutoSchedule=true → status=performed + 0 appointment', async () => {
    const surgeryId = await createSurgery('Cataract');
    const res = await trpcMutation<MarkCompletedResult>(app, doctorToken, 'surgery.markCompleted', {
      surgeryId,
      performedAt: new Date('2026-07-22T10:00:00.000Z').toISOString(),
      skipAutoSchedule: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.surgery.status).toBe('performed');
    expect(res.body.result.data.autoScheduledAppointments.length).toBe(0);
  });

  it('markCompleted performedAt verilmezse server now() kullanır', async () => {
    const surgeryId = await createSurgery('Glaucoma');
    const before = Date.now();
    const res = await trpcMutation<MarkCompletedResult>(app, doctorToken, 'surgery.markCompleted', {
      surgeryId,
      skipAutoSchedule: true,
    });
    expect(res.status).toBe(200);
    const performedAt = new Date(res.body.result.data.surgery.performedAt!).getTime();
    expect(performedAt).toBeGreaterThanOrEqual(before);
    expect(performedAt).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('#392 markCompleted REJECTED if WHO safety checklist not fully complete (400)', async () => {
    const surgeryId = await createSurgery('Cataract', false);
    const res = await trpcMutation<MarkCompletedResult>(app, doctorToken, 'surgery.markCompleted', {
      surgeryId,
      performedAt: new Date('2026-07-24T10:00:00.000Z').toISOString(),
      skipAutoSchedule: true,
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('güvenlik');
  });

  it('#392 markCompleted REJECTED if only sign-in + time-out done (sign-out eksik)', async () => {
    const surgeryId = await createSurgery('Cataract', false);
    await prisma.surgicalSafetyCheck.create({
      data: {
        tenantId: fixtures.tenantA.id,
        surgeryId,
        items: {},
        signInCompletedAt: new Date(),
        timeOutCompletedAt: new Date(),
      },
    });
    const res = await trpcMutation<MarkCompletedResult>(app, doctorToken, 'surgery.markCompleted', {
      surgeryId,
      skipAutoSchedule: true,
    });
    expect(res.status).toBe(400);
  });

  it('markCompleted idempotency: ikinci kez çağırırsan conflict (post-op zaten var)', async () => {
    const surgeryId = await createSurgery('Cataract');
    const first = await trpcMutation<MarkCompletedResult>(
      app,
      doctorToken,
      'surgery.markCompleted',
      {
        surgeryId,
        performedAt: new Date('2026-07-23T10:00:00.000Z').toISOString(),
      },
    );
    expect(first.status).toBe(200);
    const second = await trpcMutation<MarkCompletedResult>(
      app,
      doctorToken,
      'surgery.markCompleted',
      {
        surgeryId,
        performedAt: new Date('2026-07-23T10:00:00.000Z').toISOString(),
      },
    );
    // PostOp.scheduleFollowUps ConflictException → 409
    expect(second.status).toBe(409);
  });
});
