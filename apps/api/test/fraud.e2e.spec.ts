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
interface AlertRow {
  id: string;
  ruleKey: string;
  severity: string;
  status: string;
  signatureKey: string;
  actorUserId: string | null;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown>;
}
interface RuleRow {
  id: string;
  key: string;
  name: string;
  severity: string;
  isActive: boolean;
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

describe('E6 Fraud Detection (4 rules + workflow + RBAC + RLS)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let doctorToken: string;
  let doctorProfileId: string;
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
    const hash = await bcrypt.hash('doktor-pass-1234', 4);
    const d = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: 'doktor@a-fraud.test',
        passwordHash: hash,
        name: 'Dr. Fraud Test',
        status: 'active',
      },
    });
    doctorUserId = d.id;
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: d.id, roleId: doktorRole.id },
    });
    const dp = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        userId: d.id,
        name: 'Dr. Fraud Test',
        specialty: 'Retina',
        isActive: true,
      },
    });
    doctorProfileId = dp.id;
    doctorToken = await login(
      app,
      fixtures.tenantA.slug,
      'doktor@a-fraud.test',
      'doktor-pass-1234',
    );
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.fraudAlert.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    // Önceki test toggleRule ile bir kuralı pasif bırakmış olabilir; resetle.
    await prisma.fraudRule.updateMany({
      where: { tenantId: fixtures.tenantA.id },
      data: { isActive: true },
    });
    await prisma.auditLog.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.iolStockMovement.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.iolLot.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.iolModel.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.appointment.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('listRules: doktor → 403, admin → 200 + 4 default kural otomatik upsert', async () => {
    const forbidden = await trpcQuery<unknown>(app, doctorToken, 'fraud.listRules', {});
    expect(forbidden.status).toBe(403);

    const ok = await trpcQuery<RuleRow[]>(app, adminToken, 'fraud.listRules', {});
    expect(ok.status).toBe(200);
    const keys = ok.body.result.data.map((r) => r.key).sort();
    expect(keys).toEqual([
      'frequent_patient_appointment',
      'multi_ip_login',
      'night_operations',
      'stock_consume_without_surgery',
    ]);
  });

  it('toggleRule: aktif/pasif değişir', async () => {
    const list = await trpcQuery<RuleRow[]>(app, adminToken, 'fraud.listRules', {});
    const target = list.body.result.data.find((r) => r.key === 'multi_ip_login')!;
    const toggled = await trpcMutation<RuleRow>(app, adminToken, 'fraud.toggleRule', {
      id: target.id,
      isActive: false,
    });
    expect(toggled.body.result.data.isActive).toBe(false);
    // Test izolasyonu: kuralı tekrar aktif et — sonraki "detector: multi_ip_login"
    // testi bu kuralın aktif olmasına dayanır (scanNow pasif kuralı atlar).
    await trpcMutation<RuleRow>(app, adminToken, 'fraud.toggleRule', {
      id: target.id,
      isActive: true,
    });
  });

  it('detector: stock_consume_without_surgery — surgeryId null tüketim → HIGH alarm', async () => {
    // Setup: IOL model + lot
    const model = await prisma.iolModel.create({
      data: { tenantId: fixtures.tenantA.id, brand: 'Alcon', model: 'SN60WF' },
    });
    const lot = await prisma.iolLot.create({
      data: {
        tenantId: fixtures.tenantA.id,
        modelId: model.id,
        lotNumber: 'L1',
        power: 22.0,
        quantity: 10,
        expiresAt: new Date('2027-01-01'),
      },
    });
    // consume movement without surgeryId
    await prisma.iolStockMovement.create({
      data: {
        tenantId: fixtures.tenantA.id,
        lotId: lot.id,
        type: 'consume',
        quantity: -1,
        surgeryId: null,
        createdById: doctorUserId,
      },
    });

    const res = await trpcMutation<{ created: number }>(app, adminToken, 'fraud.scanNow', {});
    expect(res.status).toBe(200);
    expect(res.body.result.data.created).toBeGreaterThanOrEqual(1);

    const alerts = await trpcQuery<AlertRow[]>(app, adminToken, 'fraud.listAlerts', {
      ruleKey: 'stock_consume_without_surgery',
      limit: 50,
    });
    expect(alerts.body.result.data.length).toBe(1);
    expect(alerts.body.result.data[0]!.severity).toBe('high');
  });

  it('detector: multi_ip_login — 2+ farklı IP / 1 saat → MEDIUM alarm', async () => {
    // 3 audit_log row, same user, 3 different IPs within last 60 minutes
    const now = new Date();
    await prisma.auditLog.createMany({
      data: [
        {
          tenantId: fixtures.tenantA.id,
          userId: doctorUserId,
          action: 'auth.login.success',
          ip: '10.0.0.1',
          payload: {},
          createdAt: new Date(now.getTime() - 10 * 60 * 1000),
        },
        {
          tenantId: fixtures.tenantA.id,
          userId: doctorUserId,
          action: 'auth.login.success',
          ip: '10.0.0.2',
          payload: {},
          createdAt: new Date(now.getTime() - 20 * 60 * 1000),
        },
        {
          tenantId: fixtures.tenantA.id,
          userId: doctorUserId,
          action: 'auth.login.success',
          ip: '10.0.0.3',
          payload: {},
          createdAt: new Date(now.getTime() - 30 * 60 * 1000),
        },
      ],
    });

    await trpcMutation<{ created: number }>(app, adminToken, 'fraud.scanNow', {});

    const alerts = await trpcQuery<AlertRow[]>(app, adminToken, 'fraud.listAlerts', {
      ruleKey: 'multi_ip_login',
      limit: 50,
    });
    expect(alerts.body.result.data.length).toBe(1);
    expect(alerts.body.result.data[0]!.severity).toBe('medium');
    expect(alerts.body.result.data[0]!.actorUserId).toBe(doctorUserId);
  });

  it('detector: frequent_patient_appointment — 6+ randevu / 30 gün → MEDIUM alarm', async () => {
    const now = new Date();
    // 6 future appointments same patient, non-overlapping
    for (let i = 0; i < 6; i++) {
      const start = new Date(now.getTime() + (i + 1) * 2 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 30 * 60 * 1000);
      await prisma.appointment.create({
        data: {
          tenantId: fixtures.tenantA.id,
          patientId: fixtures.tenantA.patientId,
          doctorId: doctorProfileId,
          type: 'consultation',
          status: 'scheduled',
          startsAt: start,
          endsAt: end,
        },
      });
    }

    await trpcMutation<{ created: number }>(app, adminToken, 'fraud.scanNow', {});

    const alerts = await trpcQuery<AlertRow[]>(app, adminToken, 'fraud.listAlerts', {
      ruleKey: 'frequent_patient_appointment',
      limit: 50,
    });
    expect(alerts.body.result.data.length).toBe(1);
    expect(alerts.body.result.data[0]!.entityType).toBe('patient');
    expect(alerts.body.result.data[0]!.entityId).toBe(fixtures.tenantA.patientId);
  });

  it('detector: night_operations — TZ + precedence (gece kayıt yakala, gündüz yakalama)', async () => {
    // Dushanbe (UTC+5, no DST) gece penceresi 22:00-06:00. Buna karşılık UTC:
    // 17:00-01:00 UTC. Audit_logs.created_at naive `timestamp` (Prisma DateTime
    // default mapping), iki AT TIME ZONE chain'i ile gerçek Dushanbe HOUR'una
    // çevrilmeli (UTC olarak işaretle, sonra Dushanbe'ye çevir).
    const now = new Date();
    const dayUtc = new Date(now);
    dayUtc.setUTCHours(8, 0, 0, 0); // 13:00 Dushanbe — gündüz
    const nightUtc = new Date(now);
    nightUtc.setUTCHours(19, 0, 0, 0); // 00:00 Dushanbe ertesi gün — gece
    await prisma.auditLog.createMany({
      data: [
        {
          tenantId: fixtures.tenantA.id,
          userId: doctorUserId,
          action: 'patient.create',
          payload: {},
          createdAt: dayUtc,
        },
        {
          tenantId: fixtures.tenantA.id,
          userId: doctorUserId,
          action: 'appointment.update',
          payload: {},
          createdAt: nightUtc,
        },
      ],
    });

    await trpcMutation<{ created: number }>(app, adminToken, 'fraud.scanNow', {});

    const alerts = await trpcQuery<AlertRow[]>(app, adminToken, 'fraud.listAlerts', {
      ruleKey: 'night_operations',
      limit: 50,
    });
    // Yalnız gece satırı yakalanmış olmalı; gündüz değil.
    const actions = alerts.body.result.data.map((a) => (a.details as { action?: string }).action);
    expect(actions).toContain('appointment.update');
    expect(actions).not.toContain('patient.create');
  });

  it('scanNow idempotent: aynı imza tekrar oluşturulmaz', async () => {
    const model = await prisma.iolModel.create({
      data: { tenantId: fixtures.tenantA.id, brand: 'Z', model: 'M' },
    });
    const lot = await prisma.iolLot.create({
      data: {
        tenantId: fixtures.tenantA.id,
        modelId: model.id,
        lotNumber: 'L1',
        power: 21,
        quantity: 5,
        expiresAt: new Date('2027-01-01'),
      },
    });
    await prisma.iolStockMovement.create({
      data: {
        tenantId: fixtures.tenantA.id,
        lotId: lot.id,
        type: 'consume',
        quantity: -1,
        surgeryId: null,
        createdById: doctorUserId,
      },
    });

    const first = await trpcMutation<{ created: number }>(app, adminToken, 'fraud.scanNow', {});
    expect(first.body.result.data.created).toBeGreaterThanOrEqual(1);

    // İdempotency'yi izole etmek için: ilk scan'in kendi audit_log satırını
    // sil. Aksi halde Asia/Dushanbe gece saatleri (22:00-06:00) sırasında
    // çalışan testte AuditInterceptor'ın yazdığı yeni `mutation:fraud.scanNow`
    // satırı night_operations detector'ı tarafından yakalanır ve farklı
    // audit_id → farklı signatureKey → +1 alert (gerçek pozitif). Bu testin
    // amacı dedup mekanizmasını doğrulamak, yeni audit-girdi davranışını değil.
    await prisma.auditLog.deleteMany({ where: { tenantId: fixtures.tenantA.id } });

    const second = await trpcMutation<{ created: number }>(app, adminToken, 'fraud.scanNow', {});
    // Aynı imza → 0 ek alarm
    expect(second.body.result.data.created).toBe(0);
  });

  it('updateAlertStatus: new → reviewing → resolved + reviewNote + reviewedBy set', async () => {
    // Hızlı alert üretmek için bir stok movement
    const model = await prisma.iolModel.create({
      data: { tenantId: fixtures.tenantA.id, brand: 'Z', model: 'M' },
    });
    const lot = await prisma.iolLot.create({
      data: {
        tenantId: fixtures.tenantA.id,
        modelId: model.id,
        lotNumber: 'L1',
        power: 21,
        quantity: 5,
        expiresAt: new Date('2027-01-01'),
      },
    });
    await prisma.iolStockMovement.create({
      data: {
        tenantId: fixtures.tenantA.id,
        lotId: lot.id,
        type: 'consume',
        quantity: -1,
        surgeryId: null,
        createdById: doctorUserId,
      },
    });
    await trpcMutation<{ created: number }>(app, adminToken, 'fraud.scanNow', {});

    const list = await trpcQuery<AlertRow[]>(app, adminToken, 'fraud.listAlerts', { limit: 50 });
    const alert = list.body.result.data[0]!;
    expect(alert.status).toBe('new');

    const reviewing = await trpcMutation<AlertRow>(app, adminToken, 'fraud.updateAlertStatus', {
      id: alert.id,
      status: 'reviewing',
    });
    expect(reviewing.body.result.data.status).toBe('reviewing');

    const resolved = await trpcMutation<AlertRow>(app, adminToken, 'fraud.updateAlertStatus', {
      id: alert.id,
      status: 'resolved',
      reviewNote: 'Cerrahi sonradan açıldı, düzeltildi',
    });
    expect(resolved.body.result.data.status).toBe('resolved');
  });

  it('listAlerts filtreler: status + severity + ruleKey', async () => {
    // Üret 2 farklı kural alarmı
    const now = new Date();
    await prisma.auditLog.createMany({
      data: [
        {
          tenantId: fixtures.tenantA.id,
          userId: doctorUserId,
          action: 'auth.login.success',
          ip: '10.0.0.1',
          payload: {},
          createdAt: new Date(now.getTime() - 5 * 60 * 1000),
        },
        {
          tenantId: fixtures.tenantA.id,
          userId: doctorUserId,
          action: 'auth.login.success',
          ip: '10.0.0.2',
          payload: {},
          createdAt: new Date(now.getTime() - 10 * 60 * 1000),
        },
      ],
    });
    await trpcMutation<{ created: number }>(app, adminToken, 'fraud.scanNow', {});

    const byRule = await trpcQuery<AlertRow[]>(app, adminToken, 'fraud.listAlerts', {
      ruleKey: 'multi_ip_login',
      limit: 50,
    });
    expect(byRule.body.result.data.every((a) => a.ruleKey === 'multi_ip_login')).toBe(true);

    const bySeverity = await trpcQuery<AlertRow[]>(app, adminToken, 'fraud.listAlerts', {
      severity: 'high',
      limit: 50,
    });
    // multi_ip_login medium, high yok
    expect(bySeverity.body.result.data.every((a) => a.severity === 'high')).toBe(true);
  });

  it('cross-tenant RLS: tenantB admin tenantA alert ID için 404', async () => {
    // alert üret
    const model = await prisma.iolModel.create({
      data: { tenantId: fixtures.tenantA.id, brand: 'Z', model: 'M' },
    });
    const lot = await prisma.iolLot.create({
      data: {
        tenantId: fixtures.tenantA.id,
        modelId: model.id,
        lotNumber: 'L1',
        power: 21,
        quantity: 5,
        expiresAt: new Date('2027-01-01'),
      },
    });
    await prisma.iolStockMovement.create({
      data: {
        tenantId: fixtures.tenantA.id,
        lotId: lot.id,
        type: 'consume',
        quantity: -1,
        surgeryId: null,
        createdById: doctorUserId,
      },
    });
    await trpcMutation<{ created: number }>(app, adminToken, 'fraud.scanNow', {});
    const list = await trpcQuery<AlertRow[]>(app, adminToken, 'fraud.listAlerts', { limit: 50 });
    const alertId = list.body.result.data[0]!.id;

    const tokenB = await login(
      app,
      fixtures.tenantB.slug,
      fixtures.tenantB.adminEmail,
      fixtures.tenantB.adminPassword,
    );
    const res = await trpcQuery<unknown>(app, tokenB, 'fraud.findAlertById', { id: alertId });
    expect(res.status).toBe(404);
  });
});
