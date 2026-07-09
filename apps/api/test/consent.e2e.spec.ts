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

interface TemplateRow {
  id: string;
  procedureType: string;
  language: string;
  version: number;
  title: string;
  content: string;
  isActive: boolean;
}

interface SigningRow {
  id: string;
  templateId: string;
  patientId: string;
  surgeryId: string | null;
  language: string;
  contentSnapshot: string;
  signatureData: string;
  signedByUserId: string | null;
  witnessName: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  signedAt: string;
}

interface PreOpRow {
  id: string;
  checklistItems: Array<{ key: string; completed: boolean; completedById?: string | null }>;
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

const FAKE_SIG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' +
  'X'.repeat(200);

describe('C2 Consent (templates + signings + B3 integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let adminToken: string;
  let doctorToken: string;
  let receptionToken: string;
  let doctorProfileId: string;
  let surgeryId: string;
  let templateId: string;

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

    const doctorEmail = 'doktor@a-consent.test';
    const doctorPassword = 'doktor-pass-1234';
    const docHash = await bcrypt.hash(doctorPassword, 4);
    const doctorUser = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: doctorEmail,
        passwordHash: docHash,
        name: 'Dr. Consent',
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
        name: 'Dr. Consent',
        specialty: 'Göz',
        type: 'local',
      },
    });
    doctorProfileId = doctorProfile.id;
    doctorToken = await login(app, fixtures.tenantA.slug, doctorEmail, doctorPassword);

    const recepEmail = 'recep@a-consent.test';
    const recepPassword = 'recep-pass-1234';
    const recHash = await bcrypt.hash(recepPassword, 4);
    const recepUser = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantA.id,
        email: recepEmail,
        passwordHash: recHash,
        name: 'Resepsiyon Consent',
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
    await prisma.consentSigning.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.consentTemplate.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
    await prisma.preOp.deleteMany({ where: { tenantId: fixtures.tenantA.id } });
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

    const tpl = await prisma.consentTemplate.create({
      data: {
        tenantId: fixtures.tenantA.id,
        procedureType: 'cataract',
        language: 'tr',
        version: 1,
        title: 'Katarakt Ameliyatı Onamı',
        content:
          'Bu metin katarakt ameliyatının risk, alternatif ve faydalarını detaylı şekilde açıklar. ' +
          'Onayım açık ve gönüllü olarak verilmiştir.',
        isActive: true,
      },
    });
    templateId = tpl.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ============================ Templates ============================

  it('admin createTemplate golden + auto increment version + deactivate prev', async () => {
    const first = await trpcMutation<TemplateRow>(app, adminToken, 'consent.createTemplate', {
      procedureType: 'laser',
      language: 'tr',
      title: 'Lazer Onamı v1',
      content: 'Lazer tedavisinin riskleri ve faydaları detaylı açıklanmıştır.',
    });
    expect(first.status).toBe(200);
    expect(first.body.result.data.version).toBe(1);
    expect(first.body.result.data.isActive).toBe(true);

    const second = await trpcMutation<TemplateRow>(app, adminToken, 'consent.createTemplate', {
      procedureType: 'laser',
      language: 'tr',
      title: 'Lazer Onamı v2 — güncellenmiş',
      content: 'Yeni risk maddeleri eklendi. Lazer tedavisi hakkında güncel bilgiler.',
    });
    expect(second.body.result.data.version).toBe(2);
    expect(second.body.result.data.isActive).toBe(true);

    // İlk sürüm artık inaktif olmalı
    const list = await trpcQuery<TemplateRow[]>(app, adminToken, 'consent.listTemplates', {
      procedureType: 'laser',
      language: 'tr',
      includeInactive: true,
    });
    const v1 = list.body.result.data.find((t) => t.version === 1);
    expect(v1?.isActive).toBe(false);
  });

  it('doktor createTemplate → 403', async () => {
    const res = await trpcMutation<unknown>(app, doctorToken, 'consent.createTemplate', {
      procedureType: 'laser',
      language: 'tr',
      title: 'Bad Template',
      content: 'Should not be allowed because doctor is not admin.',
    });
    expect(res.status).toBe(403);
  });

  it('listTemplates filtered by procedureType + language, only active by default', async () => {
    await prisma.consentTemplate.create({
      data: {
        tenantId: fixtures.tenantA.id,
        procedureType: 'cataract',
        language: 'ru',
        version: 1,
        title: 'Катаракта',
        content: 'Russian template content.',
        isActive: true,
      },
    });
    const res = await trpcQuery<TemplateRow[]>(app, adminToken, 'consent.listTemplates', {
      procedureType: 'cataract',
    });
    expect(res.body.result.data).toHaveLength(2);
    const trOnly = await trpcQuery<TemplateRow[]>(app, adminToken, 'consent.listTemplates', {
      procedureType: 'cataract',
      language: 'tr',
    });
    expect(trOnly.body.result.data).toHaveLength(1);
    expect(trOnly.body.result.data[0]!.language).toBe('tr');
  });

  it('deleteTemplate: sadece yönetici → doktor 403, admin soft-delete', async () => {
    const fail = await trpcMutation<unknown>(app, doctorToken, 'consent.deleteTemplate', {
      id: templateId,
    });
    expect(fail.status).toBe(403);

    const ok = await trpcMutation<null>(app, adminToken, 'consent.deleteTemplate', {
      id: templateId,
    });
    expect(ok.status).toBe(200);
    const after = await trpcQuery<TemplateRow[]>(app, adminToken, 'consent.listTemplates', {
      procedureType: 'cataract',
      language: 'tr',
    });
    expect(after.body.result.data).toHaveLength(0);
  });

  // ============================ Signings ============================

  it('sign golden: doctor signs for patient, contentSnapshot frozen', async () => {
    const res = await trpcMutation<SigningRow>(app, doctorToken, 'consent.sign', {
      templateId,
      patientId: fixtures.tenantA.patientId,
      signatureData: FAKE_SIG_BASE64,
      witnessName: 'Refakatçi: Aile Üyesi',
    });
    expect(res.status).toBe(200);
    expect(res.body.result.data.contentSnapshot).toContain('katarakt ameliyatının');
    expect(res.body.result.data.signedByUserId).toBeTruthy();
    expect(res.body.result.data.witnessName).toBe('Refakatçi: Aile Üyesi');
    expect(res.body.result.data.language).toBe('tr');
  });

  it('sign: contentSnapshot template güncellense bile değişmez', async () => {
    const signed = await trpcMutation<SigningRow>(app, doctorToken, 'consent.sign', {
      templateId,
      patientId: fixtures.tenantA.patientId,
      signatureData: FAKE_SIG_BASE64,
    });
    const originalSnapshot = signed.body.result.data.contentSnapshot;

    await trpcMutation<TemplateRow>(app, adminToken, 'consent.updateTemplate', {
      id: templateId,
      content: 'Bu içerik TAMAMEN DEĞİŞTİRİLDİ — yeni metin.',
    });

    const fetched = await trpcQuery<SigningRow>(app, doctorToken, 'consent.getSigning', {
      signingId: signed.body.result.data.id,
    });
    expect(fetched.body.result.data.contentSnapshot).toBe(originalSnapshot);
    expect(fetched.body.result.data.contentSnapshot).not.toContain('TAMAMEN DEĞİŞTİRİLDİ');
  });

  it('sign: resepsiyon → 403 (sign yetkisi yok)', async () => {
    const res = await trpcMutation<unknown>(app, receptionToken, 'consent.sign', {
      templateId,
      patientId: fixtures.tenantA.patientId,
      signatureData: FAKE_SIG_BASE64,
    });
    expect(res.status).toBe(403);
  });

  it('sign: inactive template → 400', async () => {
    await trpcMutation<TemplateRow>(app, adminToken, 'consent.updateTemplate', {
      id: templateId,
      isActive: false,
    });
    const res = await trpcMutation<unknown>(app, doctorToken, 'consent.sign', {
      templateId,
      patientId: fixtures.tenantA.patientId,
      signatureData: FAKE_SIG_BASE64,
    });
    expect(res.status).toBe(400);
  });

  it('sign: signature data too short → 400', async () => {
    const res = await trpcMutation<unknown>(app, doctorToken, 'consent.sign', {
      templateId,
      patientId: fixtures.tenantA.patientId,
      signatureData: 'too-short',
    });
    expect(res.status).toBe(400);
  });

  it('sign: surgery başka hastaya ait → 400', async () => {
    // Yeni hasta
    const other = await prisma.patient.create({
      data: {
        tenantId: fixtures.tenantA.id,
        mrn: 'A-9999998',
        firstName: 'Other',
        lastName: 'Patient',
        birthDate: new Date('1990-01-01'),
        gender: 'female',
      },
    });
    const res = await trpcMutation<unknown>(app, doctorToken, 'consent.sign', {
      templateId,
      patientId: other.id,
      surgeryId,
      signatureData: FAKE_SIG_BASE64,
    });
    expect(res.status).toBe(400);
  });

  // ============================ B3 integration ============================

  it('sign with surgeryId: PreOp varsa consent_signed otomatik tamamlanır', async () => {
    // Önce pre-op oluştur
    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.create', { surgeryId });

    // İmza at
    const signed = await trpcMutation<SigningRow>(app, doctorToken, 'consent.sign', {
      templateId,
      patientId: fixtures.tenantA.patientId,
      surgeryId,
      signatureData: FAKE_SIG_BASE64,
    });
    expect(signed.status).toBe(200);

    // Pre-op çek → consent_signed completed olmalı
    const preOp = await trpcQuery<PreOpRow | null>(app, doctorToken, 'preOp.getBySurgery', {
      surgeryId,
    });
    const consentItem = preOp.body.result.data!.checklistItems.find(
      (i) => i.key === 'consent_signed',
    );
    expect(consentItem?.completed).toBe(true);
    expect(consentItem?.completedById).toBeTruthy();
  });

  it('sign without surgeryId: PreOp ilgili surgery yoksa hiçbir şey değişmez', async () => {
    // Pre-op oluştur ama surgery referansı vermeden imzala
    await trpcMutation<PreOpRow>(app, doctorToken, 'preOp.create', { surgeryId });
    await trpcMutation<SigningRow>(app, doctorToken, 'consent.sign', {
      templateId,
      patientId: fixtures.tenantA.patientId,
      signatureData: FAKE_SIG_BASE64,
    });
    const preOp = await trpcQuery<PreOpRow | null>(app, doctorToken, 'preOp.getBySurgery', {
      surgeryId,
    });
    const consentItem = preOp.body.result.data!.checklistItems.find(
      (i) => i.key === 'consent_signed',
    );
    expect(consentItem?.completed).toBe(false);
  });

  // ============================ List / Revoke ============================

  it('listByPatient: signed_at DESC, default revoked exclude', async () => {
    const a = await trpcMutation<SigningRow>(app, doctorToken, 'consent.sign', {
      templateId,
      patientId: fixtures.tenantA.patientId,
      signatureData: FAKE_SIG_BASE64,
    });
    // ikinci imza — küçük bir bekleme ile signedAt sırası belirgin
    await new Promise((r) => setTimeout(r, 20));
    const b = await trpcMutation<SigningRow>(app, doctorToken, 'consent.sign', {
      templateId,
      patientId: fixtures.tenantA.patientId,
      signatureData: FAKE_SIG_BASE64,
    });
    // Birini iptal et
    await trpcMutation<SigningRow>(app, adminToken, 'consent.revoke', {
      signingId: a.body.result.data.id,
      reason: 'Yanlış şablon seçildi',
    });

    const list = await trpcQuery<SigningRow[]>(app, doctorToken, 'consent.listByPatient', {
      patientId: fixtures.tenantA.patientId,
    });
    // Default revoked exclude → sadece b kalır
    expect(list.body.result.data).toHaveLength(1);
    expect(list.body.result.data[0]!.id).toBe(b.body.result.data.id);

    const all = await trpcQuery<SigningRow[]>(app, doctorToken, 'consent.listByPatient', {
      patientId: fixtures.tenantA.patientId,
      includeRevoked: true,
    });
    expect(all.body.result.data).toHaveLength(2);
    // En yeni önce
    expect(all.body.result.data[0]!.id).toBe(b.body.result.data.id);
  });

  it('revoke: sadece yönetici, ikinci revoke → 409', async () => {
    const signed = await trpcMutation<SigningRow>(app, doctorToken, 'consent.sign', {
      templateId,
      patientId: fixtures.tenantA.patientId,
      signatureData: FAKE_SIG_BASE64,
    });

    const docFail = await trpcMutation<unknown>(app, doctorToken, 'consent.revoke', {
      signingId: signed.body.result.data.id,
      reason: 'Doktor iptal etmeye çalıştı',
    });
    expect(docFail.status).toBe(403);

    const adminOk = await trpcMutation<SigningRow>(app, adminToken, 'consent.revoke', {
      signingId: signed.body.result.data.id,
      reason: 'Hatalı şablon',
    });
    expect(adminOk.status).toBe(200);
    expect(adminOk.body.result.data.revokedAt).toBeTruthy();
    expect(adminOk.body.result.data.revokeReason).toBe('Hatalı şablon');

    const dup = await trpcMutation<unknown>(app, adminToken, 'consent.revoke', {
      signingId: signed.body.result.data.id,
      reason: 'İkinci kez iptal',
    });
    expect(dup.status).toBe(409);
  });

  it('cross-tenant: tenantB token tenantA template ile imza atamaz (404)', async () => {
    const tokenB = await login(
      app,
      fixtures.tenantB.slug,
      fixtures.tenantB.adminEmail,
      fixtures.tenantB.adminPassword,
    );
    const res = await trpcMutation<unknown>(app, tokenB, 'consent.sign', {
      templateId,
      patientId: fixtures.tenantA.patientId,
      signatureData: FAKE_SIG_BASE64,
    });
    expect(res.status).toBe(404);
  });
});
