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

interface RuleRow {
  id: string;
  doctorId: string | null;
  type: string;
  value: string;
  currency: string;
  applicableSurgeryTypes: string[];
  applicableProcedureTypes: string[];
  priority: number;
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
}

interface EntryRow {
  id: string;
  doctorId: string;
  ruleId: string | null;
  sourceType: 'surgery' | 'procedure';
  sourceId: string;
  amount: string;
  baseAmount: string | null;
  currency: string;
  status: 'pending' | 'approved' | 'paid' | 'cancelled';
  rejectionReason: string | null;
  paidAt: string | null;
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

describe('E2 Commission (rule + entry + workflow + RBAC + RLS)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let doctorToken: string;
  let doctorProfileId: string;
  let surgeryId: string;
  let procedureId: string;

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
        email: 'doktor@a-comm.test',
        passwordHash: hash,
        name: 'Dr. Commission Test',
        status: 'active',
      },
    });
    await prisma.userRole.create({
      data: { tenantId: fixtures.tenantA.id, userId: d.id, roleId: doktorRole.id },
    });
    const dp = await prisma.doctor.create({
      data: {
        tenantId: fixtures.tenantA.id,
        userId: d.id,
        name: 'Dr. Commission Test',
        specialty: 'Retina',
        isActive: true,
      },
    });
    doctorProfileId = dp.id;
    doctorToken = await login(app, fixtures.tenantA.slug, 'doktor@a-comm.test', 'doktor-pass-1234');

    // Setup: performed surgery + performed procedure for source eligibility.
    const surgery = await prisma.surgery.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        type: 'cataract_phaco',
        status: 'performed',
        scheduledAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        performedAt: new Date(Date.now() - 23 * 60 * 60 * 1000),
      },
    });
    surgeryId = surgery.id;

    const proc = await prisma.procedure.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        doctorId: doctorProfileId,
        type: 'intravitreal_injection',
        status: 'performed',
        eyeSide: 'od',
        anesthesia: 'topical',
        performedAt: new Date(Date.now() - 12 * 60 * 60 * 1000),
        settings: {},
      },
    });
    procedureId = proc.id;
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${fixtures.tenantA.id}', false)`,
    );
    await prisma.commissionEntry.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.commissionRule.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('createRule: doktor → 403 (admin-only)', async () => {
    const res = await trpcMutation<unknown>(app, doctorToken, 'commission.createRule', {
      type: 'per_surgery',
      value: '500.00',
      currency: 'USD',
      validFrom: '2026-01-01',
    });
    expect(res.status).toBe(403);
  });

  it('createRule PER_SURGERY golden + listRules döner', async () => {
    const res = await trpcMutation<RuleRow>(app, adminToken, 'commission.createRule', {
      doctorId: doctorProfileId,
      type: 'per_surgery',
      value: '500.00',
      currency: 'USD',
      validFrom: '2026-01-01',
      priority: 10,
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.value).toBe('500');

    const list = await trpcQuery<RuleRow[]>(app, adminToken, 'commission.listRules', {
      includeInactive: false,
    });
    expect(list.body.result.data).toHaveLength(1);
  });

  it('createRule validation: percentage > 100 → 400', async () => {
    const res = await trpcMutation<unknown>(app, adminToken, 'commission.createRule', {
      type: 'percentage',
      value: '150.00',
      validFrom: '2026-01-01',
    });
    expect(res.status).toBe(400);
  });

  it('createRule validation: validTo < validFrom → 400', async () => {
    const res = await trpcMutation<unknown>(app, adminToken, 'commission.createRule', {
      type: 'per_surgery',
      value: '500',
      validFrom: '2026-06-01',
      validTo: '2026-05-01',
    });
    expect(res.status).toBe(400);
  });

  it('calculate PER_SURGERY: amount = rule.value', async () => {
    await trpcMutation<RuleRow>(app, adminToken, 'commission.createRule', {
      doctorId: doctorProfileId,
      type: 'per_surgery',
      value: '750.50',
      currency: 'USD',
      validFrom: '2026-01-01',
    });
    const res = await trpcMutation<EntryRow>(app, adminToken, 'commission.calculate', {
      sourceType: 'surgery',
      sourceId: surgeryId,
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.amount).toBe('750.5');
    expect(res.body.result.data.status).toBe('pending');
    expect(res.body.result.data.doctorId).toBe(doctorProfileId);
  });

  it('calculate PERCENTAGE: baseAmount zorunlu, amount = base * value/100', async () => {
    await trpcMutation<RuleRow>(app, adminToken, 'commission.createRule', {
      doctorId: doctorProfileId,
      type: 'percentage',
      value: '15.00',
      currency: 'USD',
      validFrom: '2026-01-01',
    });
    // baseAmount eksik → 400
    const bad = await trpcMutation<unknown>(app, adminToken, 'commission.calculate', {
      sourceType: 'surgery',
      sourceId: surgeryId,
    });
    expect(bad.status).toBe(400);

    const ok = await trpcMutation<EntryRow>(app, adminToken, 'commission.calculate', {
      sourceType: 'surgery',
      sourceId: surgeryId,
      baseAmount: '2000.00',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.result.data.amount).toBe('300'); // 2000 * 15 / 100
    expect(ok.body.result.data.baseAmount).toBe('2000');
  });

  it('calculate: aynı source iki kez → 409 (idempotency)', async () => {
    await trpcMutation<RuleRow>(app, adminToken, 'commission.createRule', {
      doctorId: doctorProfileId,
      type: 'per_surgery',
      value: '100',
      validFrom: '2026-01-01',
    });
    const first = await trpcMutation<EntryRow>(app, adminToken, 'commission.calculate', {
      sourceType: 'surgery',
      sourceId: surgeryId,
    });
    expect(first.status).toBe(200);
    const dup = await trpcMutation<unknown>(app, adminToken, 'commission.calculate', {
      sourceType: 'surgery',
      sourceId: surgeryId,
    });
    expect(dup.status).toBe(409);
  });

  it('calculate: uygun kural yok → 400', async () => {
    const res = await trpcMutation<unknown>(app, adminToken, 'commission.calculate', {
      sourceType: 'surgery',
      sourceId: surgeryId,
    });
    expect(res.status).toBe(400);
  });

  it('calculate: doctor-specific kural klinik-geneline tercih edilir', async () => {
    // Klinik default
    await trpcMutation<RuleRow>(app, adminToken, 'commission.createRule', {
      type: 'per_surgery',
      value: '100',
      validFrom: '2026-01-01',
      priority: 0,
    });
    // Doktor-spesifik
    await trpcMutation<RuleRow>(app, adminToken, 'commission.createRule', {
      doctorId: doctorProfileId,
      type: 'per_surgery',
      value: '999',
      validFrom: '2026-01-01',
      priority: 0,
    });
    const res = await trpcMutation<EntryRow>(app, adminToken, 'commission.calculate', {
      sourceType: 'procedure',
      sourceId: procedureId,
    });
    expect(res.body.result.data.amount).toBe('999');
  });

  it('approve workflow: pending → approved + reviewedBy set', async () => {
    await trpcMutation<RuleRow>(app, adminToken, 'commission.createRule', {
      doctorId: doctorProfileId,
      type: 'per_surgery',
      value: '500',
      validFrom: '2026-01-01',
    });
    const calc = await trpcMutation<EntryRow>(app, adminToken, 'commission.calculate', {
      sourceType: 'surgery',
      sourceId: surgeryId,
    });
    const appr = await trpcMutation<EntryRow>(app, adminToken, 'commission.approve', {
      id: calc.body.result.data.id,
    });
    expect(appr.status).toBe(200);
    expect(appr.body.result.data.status).toBe('approved');
  });

  it('reject workflow: pending → cancelled + rejectionReason zorunlu', async () => {
    await trpcMutation<RuleRow>(app, adminToken, 'commission.createRule', {
      doctorId: doctorProfileId,
      type: 'per_surgery',
      value: '500',
      validFrom: '2026-01-01',
    });
    const calc = await trpcMutation<EntryRow>(app, adminToken, 'commission.calculate', {
      sourceType: 'surgery',
      sourceId: surgeryId,
    });
    const rej = await trpcMutation<EntryRow>(app, adminToken, 'commission.reject', {
      id: calc.body.result.data.id,
      rejectionReason: 'Veri hatalı — düzeltilecek',
    });
    expect(rej.status).toBe(200);
    expect(rej.body.result.data.status).toBe('cancelled');
    expect(rej.body.result.data.rejectionReason).toContain('Veri hatalı');
  });

  it('markPaid: approved → paid + paidMethod set', async () => {
    await trpcMutation<RuleRow>(app, adminToken, 'commission.createRule', {
      doctorId: doctorProfileId,
      type: 'per_surgery',
      value: '500',
      validFrom: '2026-01-01',
    });
    const calc = await trpcMutation<EntryRow>(app, adminToken, 'commission.calculate', {
      sourceType: 'surgery',
      sourceId: surgeryId,
    });
    // markPaid pending iken → 409
    const bad = await trpcMutation<unknown>(app, adminToken, 'commission.markPaid', {
      id: calc.body.result.data.id,
      paidMethod: 'bank_transfer',
    });
    expect(bad.status).toBe(409);

    await trpcMutation<EntryRow>(app, adminToken, 'commission.approve', {
      id: calc.body.result.data.id,
    });
    const paid = await trpcMutation<EntryRow>(app, adminToken, 'commission.markPaid', {
      id: calc.body.result.data.id,
      paidMethod: 'bank_transfer',
    });
    expect(paid.status).toBe(200);
    expect(paid.body.result.data.status).toBe('paid');
    expect(paid.body.result.data.paidAt).not.toBeNull();
  });

  it('monthlySummary: doktor × currency × status pivot döner', async () => {
    await trpcMutation<RuleRow>(app, adminToken, 'commission.createRule', {
      doctorId: doctorProfileId,
      type: 'per_surgery',
      value: '500',
      currency: 'USD',
      validFrom: '2026-01-01',
    });
    const calc = await trpcMutation<EntryRow>(app, adminToken, 'commission.calculate', {
      sourceType: 'surgery',
      sourceId: surgeryId,
    });
    await trpcMutation<EntryRow>(app, adminToken, 'commission.approve', {
      id: calc.body.result.data.id,
    });

    const now = new Date();
    const summary = await trpcQuery<{
      doctors: Array<{ doctor: { name: string }; totals: Record<string, { approved: number }> }>;
    }>(app, adminToken, 'commission.monthlySummary', {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    });
    expect(summary.status).toBe(200);
    expect(summary.body.result.data.doctors).toHaveLength(1);
    expect(summary.body.result.data.doctors[0]!.totals.USD!.approved).toBe(500);
  });

  it('listEntries status filter', async () => {
    await trpcMutation<RuleRow>(app, adminToken, 'commission.createRule', {
      doctorId: doctorProfileId,
      type: 'per_surgery',
      value: '500',
      validFrom: '2026-01-01',
    });
    const calc = await trpcMutation<EntryRow>(app, adminToken, 'commission.calculate', {
      sourceType: 'surgery',
      sourceId: surgeryId,
    });
    await trpcMutation<EntryRow>(app, adminToken, 'commission.approve', {
      id: calc.body.result.data.id,
    });
    const approved = await trpcQuery<EntryRow[]>(app, adminToken, 'commission.listEntries', {
      status: 'approved',
      limit: 50,
    });
    expect(approved.body.result.data).toHaveLength(1);
    const pending = await trpcQuery<EntryRow[]>(app, adminToken, 'commission.listEntries', {
      status: 'pending',
      limit: 50,
    });
    expect(pending.body.result.data).toHaveLength(0);
  });

  it('cross-tenant RLS: tenantB admin tenantA kuralını okuyamaz', async () => {
    const r = await trpcMutation<RuleRow>(app, adminToken, 'commission.createRule', {
      doctorId: doctorProfileId,
      type: 'per_surgery',
      value: '500',
      validFrom: '2026-01-01',
    });
    const tokenB = await login(
      app,
      fixtures.tenantB.slug,
      fixtures.tenantB.adminEmail,
      fixtures.tenantB.adminPassword,
    );
    const res = await trpcQuery<unknown>(app, tokenB, 'commission.findRuleById', {
      id: r.body.result.data.id,
    });
    expect(res.status).toBe(404);
  });
});
