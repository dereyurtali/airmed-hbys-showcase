import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  resetAndSeedFixtures,
  seedPaidInvoiceForCategory,
  type IsolationFixtures,
} from './fixtures';
import { createTestApp } from './test-app';

interface LoginBody {
  accessToken: string;
}

interface TrpcSuccess<T> {
  result: { data: T };
}

interface LabTestRow {
  id: string;
  tenantId: string;
  patientId: string;
  source: 'internal' | 'external';
  testType: string;
  performedAt: string;
  results: Record<string, unknown>;
  notes: string | null;
  externalLab: string | null;
  fileKey: string | null;
  fileName: string | null;
  fileMimeType: string | null;
  fileSizeBytes: number | null;
  createdById: string | null;
  createdAt: string;
}

interface LabTestWithCreatedBy extends LabTestRow {
  createdBy: { id: string; name: string } | null;
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

// Tiny valid PDF (just enough bytes to satisfy MIME sniffing for tests).
const TINY_PDF = Buffer.concat([
  Buffer.from('%PDF-1.4\n', 'utf-8'),
  Buffer.from('%\xE2\xE3\xCF\xD3\n', 'binary'),
  Buffer.from('1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF', 'utf-8'),
]);

describe('B2 LabTest (Tetkik) — REST upload + tRPC CRUD + RBAC', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let doctorToken: string;
  let doctorUserId: string;
  let storageRoot: string;

  beforeAll(async () => {
    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'airmed-lab-test-'));
    process.env.STORAGE_LOCAL_PATH = storageRoot;

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
    const doctorEmail = 'doktor@a-lab.test';
    const doctorPassword = 'doktor-pass-1234';
    const hash = await bcrypt.hash(doctorPassword, 4);
    const doctorUser = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: doctorEmail,
        passwordHash: hash,
        name: 'Dr. Lab Test',
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
    await prisma.labTest.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    // S12c — assertPaidSession bypass için günlük paid invoice seed.
    await prisma.invoiceItem.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.invoice.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await seedPaidInvoiceForCategory(
      prisma,
      fixtures.tenantA.id,
      fixtures.tenantA.patientId,
      'lab',
      doctorUserId,
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    await fs.rm(storageRoot, { recursive: true, force: true });
  });

  it('create golden (internal): JSONB results + createdById doğru', async () => {
    const res = await trpcMutation<LabTestRow>(app, doctorToken, 'lab.create', {
      patientId: fixtures.tenantA.patientId,
      source: 'internal',
      testType: 'iop_curve',
      performedAt: new Date().toISOString(),
      results: { od: '16', os: '18' },
      notes: 'Sabah ölçümü',
    });
    expect(res.status).toBe(200);
    const row = res.body.result.data;
    expect(row.source).toBe('internal');
    expect(row.testType).toBe('iop_curve');
    expect(row.createdById).toBe(doctorUserId);
    expect(row.results).toEqual({ od: '16', os: '18' });
    expect(row.notes).toBe('Sabah ölçümü');
  });

  it('create external + REST dosya upload akışı', async () => {
    const create = await trpcMutation<LabTestRow>(app, doctorToken, 'lab.create', {
      patientId: fixtures.tenantA.patientId,
      source: 'external',
      testType: 'blood_test',
      performedAt: new Date().toISOString(),
      results: {},
      externalLab: 'ABC Lab Dushanbe',
    });
    expect(create.status).toBe(200);
    const id = create.body.result.data.id;

    const upload = await request(app.getHttpServer() as App)
      .post(`/api/lab-tests/${id}/file`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .attach('file', TINY_PDF, { filename: 'report.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(201);
    const updated = upload.body as LabTestRow;
    expect(updated.fileMimeType).toBe('application/pdf');
    expect(updated.fileName).toBe('report.pdf');
    expect(updated.fileSizeBytes).toBe(TINY_PDF.length);

    const absolute = path.join(storageRoot, updated.fileKey!);
    await expect(fs.access(absolute)).resolves.toBeUndefined();
  });

  it('internal tetkike dosya iliştirmek → 400', async () => {
    const create = await trpcMutation<LabTestRow>(app, doctorToken, 'lab.create', {
      patientId: fixtures.tenantA.patientId,
      source: 'internal',
      testType: 'visual_field',
      performedAt: new Date().toISOString(),
      results: { md: '-3.2' },
    });
    const id = create.body.result.data.id;
    const upload = await request(app.getHttpServer() as App)
      .post(`/api/lab-tests/${id}/file`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .attach('file', TINY_PDF, { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(400);
  });

  it('upload: izinsiz MIME (text/plain) → 400', async () => {
    const create = await trpcMutation<LabTestRow>(app, doctorToken, 'lab.create', {
      patientId: fixtures.tenantA.patientId,
      source: 'external',
      testType: 'blood_test',
      performedAt: new Date().toISOString(),
      results: {},
    });
    const id = create.body.result.data.id;
    const upload = await request(app.getHttpServer() as App)
      .post(`/api/lab-tests/${id}/file`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .attach('file', Buffer.from('hello'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(upload.status).toBe(400);
  });

  it('zod: geçersiz testType → 400', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/trpc/lab.create')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        patientId: fixtures.tenantA.patientId,
        source: 'internal',
        testType: 'not-a-real-test',
        performedAt: new Date().toISOString(),
        results: {},
      });
    expect(res.status).toBe(400);
  });

  it('create: hasta tenant dışı → 404', async () => {
    const res = await trpcMutation<unknown>(app, doctorToken, 'lab.create', {
      patientId: fixtures.tenantB.patientId,
      source: 'internal',
      testType: 'visual_field',
      performedAt: new Date().toISOString(),
      results: {},
    });
    expect(res.status).toBe(404);
  });

  it('listByPatient desc sıralı + createdBy include', async () => {
    await prisma.labTest.createMany({
      data: [
        {
          tenantId: fixtures.tenantA.id,
          patientId: fixtures.tenantA.patientId,
          source: 'internal',
          testType: 'visual_field',
          performedAt: new Date('2026-04-01'),
          results: { md: '-2.1' },
          createdById: doctorUserId,
        },
        {
          tenantId: fixtures.tenantA.id,
          patientId: fixtures.tenantA.patientId,
          source: 'external',
          testType: 'blood_test',
          performedAt: new Date('2026-05-01'),
          results: {},
          externalLab: 'ABC Lab',
          createdById: doctorUserId,
        },
      ],
    });
    const res = await trpcQuery<LabTestWithCreatedBy[]>(app, doctorToken, 'lab.listByPatient', {
      patientId: fixtures.tenantA.patientId,
    });
    expect(res.status).toBe(200);
    const items = res.body.result.data;
    expect(items).toHaveLength(2);
    expect(items[0]!.source).toBe('external');
    expect(items[0]!.createdBy?.name).toBe('Dr. Lab Test');
  });

  it('list: testType + source filtresi birlikte', async () => {
    await prisma.labTest.createMany({
      data: [
        {
          tenantId: fixtures.tenantA.id,
          patientId: fixtures.tenantA.patientId,
          source: 'internal',
          testType: 'visual_field',
          performedAt: new Date(),
          results: {},
          createdById: doctorUserId,
        },
        {
          tenantId: fixtures.tenantA.id,
          patientId: fixtures.tenantA.patientId,
          source: 'external',
          testType: 'visual_field',
          performedAt: new Date(),
          results: {},
          createdById: doctorUserId,
        },
        {
          tenantId: fixtures.tenantA.id,
          patientId: fixtures.tenantA.patientId,
          source: 'external',
          testType: 'blood_test',
          performedAt: new Date(),
          results: {},
          createdById: doctorUserId,
        },
      ],
    });
    const res = await trpcQuery<{ items: LabTestRow[]; total: number }>(
      app,
      doctorToken,
      'lab.list',
      { patientId: fixtures.tenantA.patientId, testType: 'visual_field', source: 'external' },
    );
    expect(res.status).toBe(200);
    expect(res.body.result.data.total).toBe(1);
    expect(res.body.result.data.items[0]!.source).toBe('external');
  });

  it('update: yükleyen doktor notes + results günceller', async () => {
    const created = await trpcMutation<LabTestRow>(app, doctorToken, 'lab.create', {
      patientId: fixtures.tenantA.patientId,
      source: 'internal',
      testType: 'pachymetry',
      performedAt: new Date().toISOString(),
      results: { od: '545' },
    });
    const id = created.body.result.data.id;

    const upd = await trpcMutation<LabTestRow>(app, doctorToken, 'lab.update', {
      id,
      data: {
        notes: 'Düşük ödem',
        results: { od: '545', os: '540' },
      },
    });
    expect(upd.status).toBe(200);
    expect(upd.body.result.data.notes).toBe('Düşük ödem');
    expect(upd.body.result.data.results).toEqual({ od: '545', os: '540' });
  });

  it('update: yönetici (yükleyici değil) override → 200', async () => {
    const created = await trpcMutation<LabTestRow>(app, doctorToken, 'lab.create', {
      patientId: fixtures.tenantA.patientId,
      source: 'internal',
      testType: 'topography',
      performedAt: new Date().toISOString(),
      results: {},
    });
    const id = created.body.result.data.id;

    const upd = await trpcMutation<LabTestRow>(app, adminToken, 'lab.update', {
      id,
      data: { notes: 'Admin override' },
    });
    expect(upd.status).toBe(200);
    expect(upd.body.result.data.notes).toBe('Admin override');
  });

  it('update: sistem kaydı (createdById null) doktor → 403, admin → 200', async () => {
    const created = await prisma.labTest.create({
      data: {
        tenantId: fixtures.tenantA.id,
        patientId: fixtures.tenantA.patientId,
        source: 'external',
        testType: 'blood_test',
        performedAt: new Date(),
        results: {},
        createdById: null,
      },
    });
    const forbidden = await trpcMutation<unknown>(app, doctorToken, 'lab.update', {
      id: created.id,
      data: { notes: 'try' },
    });
    expect(forbidden.status).toBe(403);

    const ok = await trpcMutation<LabTestRow>(app, adminToken, 'lab.update', {
      id: created.id,
      data: { notes: 'admin can' },
    });
    expect(ok.status).toBe(200);
  });

  it('softDelete: yükleyen doktor siler + list artık göstermez', async () => {
    const created = await trpcMutation<LabTestRow>(app, doctorToken, 'lab.create', {
      patientId: fixtures.tenantA.patientId,
      source: 'internal',
      testType: 'oct_macula',
      performedAt: new Date().toISOString(),
      results: {},
    });
    const id = created.body.result.data.id;

    const del = await trpcMutation<{ ok: true }>(app, doctorToken, 'lab.softDelete', { id });
    expect(del.status).toBe(200);

    const list = await trpcQuery<LabTestWithCreatedBy[]>(app, doctorToken, 'lab.listByPatient', {
      patientId: fixtures.tenantA.patientId,
    });
    expect(list.body.result.data).toHaveLength(0);
  });

  it('cross-tenant: tenantB token tenantA hastasına lab kaydı ekleyemez (404)', async () => {
    const tokenB = await login(
      app,
      fixtures.tenantB.slug,
      fixtures.tenantB.adminEmail,
      fixtures.tenantB.adminPassword,
    );
    const res = await trpcMutation<unknown>(app, tokenB, 'lab.create', {
      patientId: fixtures.tenantA.patientId,
      source: 'internal',
      testType: 'visual_field',
      performedAt: new Date().toISOString(),
      results: {},
    });
    expect(res.status).toBe(404);
  });
});
