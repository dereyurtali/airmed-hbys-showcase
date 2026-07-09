import type { INestApplication } from '@nestjs/common';
import { PrismaClient, DEFAULT_CLINIC_ROLES } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import request from 'supertest';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

// F3 Platform Tenants — REST endpoint'leri.
// Platform JWT'si üzerinden konuşur (TOTP setup + verify ile alınır).

const OWNER_EMAIL = 'platform-owner-tenants@dna.test';
const OWNER_PASSWORD = 'tenants-test-pass';
const SUPPORT_EMAIL = 'platform-support-tenants@dna.test';
const SUPPORT_PASSWORD = 'tenants-support-pass';

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan: string;
  locale: string;
  suspendReason: string | null;
  suspendNote: string | null;
  _count?: { users: number };
}

interface CreateResponse {
  tenant: TenantRow;
  adminEmail: string;
  adminTempPassword: string;
}

describe('F3 Platform Tenants (CRUD + onboarding + suspend + RBAC + audit)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixtures: IsolationFixtures;
  let ownerId: string;
  let supportId: string;
  let ownerAccessToken: string;
  let supportAccessToken: string;

  authenticator.options = { window: 1, step: 30 };

  // Login + TOTP setup + verify → access token.
  async function fullLogin(email: string, password: string): Promise<string> {
    const login = await request(app.getHttpServer())
      .post('/platform/auth/login')
      .send({ email, password })
      .expect(200);
    const challenge = login.body.challengeToken as string;

    const setup = await request(app.getHttpServer())
      .post('/platform/auth/setup-totp')
      .set('Authorization', `Bearer ${challenge}`)
      .expect(200);
    const secret = setup.body.secret as string;

    const challenge2 = (
      await request(app.getHttpServer())
        .post('/platform/auth/login')
        .send({ email, password })
        .expect(200)
    ).body.challengeToken as string;

    const code = authenticator.generate(secret);
    const verify = await request(app.getHttpServer())
      .post('/platform/auth/verify-totp')
      .set('Authorization', `Bearer ${challenge2}`)
      .send({ code })
      .expect(200);
    return verify.body.accessToken as string;
  }

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

    await prisma.platformAdmin.deleteMany({
      where: { email: { in: [OWNER_EMAIL, SUPPORT_EMAIL] } },
    });

    const ownerHash = await bcrypt.hash(OWNER_PASSWORD, 4);
    const owner = await prisma.platformAdmin.create({
      data: {
        email: OWNER_EMAIL,
        passwordHash: ownerHash,
        name: 'Tenants Owner',
        role: 'platform_owner',
      },
    });
    ownerId = owner.id;

    const supportHash = await bcrypt.hash(SUPPORT_PASSWORD, 4);
    const support = await prisma.platformAdmin.create({
      data: {
        email: SUPPORT_EMAIL,
        passwordHash: supportHash,
        name: 'Tenants Support',
        role: 'platform_support',
      },
    });
    supportId = support.id;

    ownerAccessToken = await fullLogin(OWNER_EMAIL, OWNER_PASSWORD);
    supportAccessToken = await fullLogin(SUPPORT_EMAIL, SUPPORT_PASSWORD);
  });

  const cleanupF3Tenants = async () => {
    // FK RESTRICT → children'ı sırayla sil. e2e tenant'ların altında
    // role + user + userRole + refreshToken olabilir.
    const matching = await prisma.tenant.findMany({
      where: { slug: { startsWith: 'e2e-f3-' } },
      select: { id: true },
    });
    const ids = matching.map((t) => t.id);
    if (ids.length === 0) return;
    await prisma.refreshToken.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.userRole.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.role.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  };

  beforeEach(async () => {
    await cleanupF3Tenants();
  });

  afterAll(async () => {
    await cleanupF3Tenants();
    await prisma.platformAdminSession.deleteMany({
      where: { adminId: { in: [ownerId, supportId] } },
    });
    await prisma.platformAdminRecoveryCode.deleteMany({
      where: { adminId: { in: [ownerId, supportId] } },
    });
    await prisma.platformAuditLog.deleteMany({
      where: { email: { in: [OWNER_EMAIL, SUPPORT_EMAIL] } },
    });
    await prisma.platformAdmin.deleteMany({
      where: { email: { in: [OWNER_EMAIL, SUPPORT_EMAIL] } },
    });
    await prisma.$disconnect();
    await app.close();
  });

  it('list: JWT yoksa 401', async () => {
    await request(app.getHttpServer()).get('/platform/tenants').expect(401);
  });

  it('list: owner görür (seed tenant + tenantA/B + yeni eklenenler)', async () => {
    const res = await request(app.getHttpServer())
      .get('/platform/tenants')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it('create: owner golden + ilk admin user + temp password döner', async () => {
    const res = await request(app.getHttpServer())
      .post('/platform/tenants')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        slug: 'e2e-f3-golden',
        name: 'E2E F3 Golden',
        adminEmail: 'admin@e2e-f3-golden.test',
        adminName: 'F3 Admin',
      })
      .expect(201);
    const body = res.body as CreateResponse;
    expect(body.tenant.slug).toBe('e2e-f3-golden');
    expect(body.adminEmail).toBe('admin@e2e-f3-golden.test');
    expect(body.adminTempPassword).toMatch(/^[a-f0-9]{16}$/); // 8 byte hex

    // Tüm default roller oluştu — sayı DEFAULT_CLINIC_ROLES'a bağlı (yeni rol
    // eklenince bayatlamaz). Hepsi default aktif.
    const roles = await prisma.role.count({ where: { tenantId: body.tenant.id } });
    expect(roles).toBe(DEFAULT_CLINIC_ROLES.length);
    const inactiveRoles = await prisma.role.count({
      where: { tenantId: body.tenant.id, isActive: false },
    });
    expect(inactiveRoles).toBe(0);

    // Yonetici user atandı
    const adminUser = await prisma.user.findFirst({
      where: { tenantId: body.tenant.id, email: 'admin@e2e-f3-golden.test' },
      include: { userRoles: { include: { role: true } } },
    });
    expect(adminUser).not.toBeNull();
    expect(adminUser!.mustChangePassword).toBe(true);
    expect(adminUser!.userRoles[0]!.role.key).toBe('yonetici');
  });

  it('create: slug çakışması → 409', async () => {
    await request(app.getHttpServer())
      .post('/platform/tenants')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        slug: 'e2e-f3-dup',
        name: 'First',
        adminEmail: 'admin@first.test',
        adminName: 'A1',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/platform/tenants')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        slug: 'e2e-f3-dup',
        name: 'Second',
        adminEmail: 'admin@second.test',
        adminName: 'A2',
      })
      .expect(409);
  });

  it('create: platform_support → 403', async () => {
    await request(app.getHttpServer())
      .post('/platform/tenants')
      .set('Authorization', `Bearer ${supportAccessToken}`)
      .send({
        slug: 'e2e-f3-supp',
        name: 'Support Forbidden',
        adminEmail: 'admin@supp.test',
        adminName: 'AA',
      })
      .expect(403);
  });

  it('create: slug verilmezse name → kebab-case otomatik', async () => {
    const res = await request(app.getHttpServer())
      .post('/platform/tenants')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        name: 'e2e f3 Otomatik Slug Klinik',
        adminEmail: 'admin@auto.test',
        adminName: 'AA',
      })
      .expect(201);
    const body = res.body as CreateResponse;
    expect(body.tenant.slug).toBe('e2e-f3-otomatik-slug-klinik');
    // cleanup beforeEach prefix-bazlı tara — children FK'ları nedeniyle
    // burada direkt tenant.delete patlar; helper'la temizle.
    await cleanupF3Tenants();
  });

  it('update: name + plan değişir, audit log yazılır', async () => {
    const created = (
      await request(app.getHttpServer())
        .post('/platform/tenants')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .send({
          slug: 'e2e-f3-upd',
          name: 'Original',
          adminEmail: 'admin@upd.test',
          adminName: 'AA',
        })
        .expect(201)
    ).body as CreateResponse;

    await request(app.getHttpServer())
      .patch(`/platform/tenants/${created.tenant.id}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: 'Updated', plan: 'standard' })
      .expect(200);

    const after = await prisma.tenant.findUnique({ where: { id: created.tenant.id } });
    expect(after?.name).toBe('Updated');
    expect(after?.plan).toBe('standard');

    const audit = await prisma.platformAuditLog.findFirst({
      where: { action: 'tenant.update', entityId: created.tenant.id },
    });
    expect(audit).not.toBeNull();
  });

  it('suspend: status → suspended, refresh tokens revoke, login fail', async () => {
    const created = (
      await request(app.getHttpServer())
        .post('/platform/tenants')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .send({
          slug: 'e2e-f3-susp',
          name: 'Suspend Test',
          adminEmail: 'admin@susp.test',
          adminName: 'AA',
          adminPassword: 'super-secret-pw',
        })
        .expect(201)
    ).body as CreateResponse;

    // İlk olarak login yapılabilir
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        tenantSlug: created.tenant.slug,
        email: 'admin@susp.test',
        password: 'super-secret-pw',
      })
      .expect(200);

    // Suspend
    await request(app.getHttpServer())
      .post(`/platform/tenants/${created.tenant.id}/suspend`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ reason: 'payment_overdue', note: 'Test gerekçesi' })
      .expect(200);

    const after = await prisma.tenant.findUnique({ where: { id: created.tenant.id } });
    expect(after?.status).toBe('suspended');
    expect(after?.suspendReason).toBe('payment_overdue');

    const revoked = await prisma.refreshToken.count({
      where: { tenantId: created.tenant.id, revokedAt: { not: null } },
    });
    expect(revoked).toBeGreaterThan(0);

    // Suspended tenant'ta login denerse → 403 (TenantInterceptor status='suspended' bloklar)
    // Bu test mevcut interceptor davranışına bağlı; çalışmıyorsa skip.
    const loginAfter = await request(app.getHttpServer()).post('/api/auth/login').send({
      tenantSlug: created.tenant.slug,
      email: 'admin@susp.test',
      password: 'super-secret-pw',
    });
    // Beklenen 403 ya da 401 — tenant suspended olduğu için herhangi biri kabul.
    expect([401, 403]).toContain(loginAfter.status);
  });

  it('suspend: ikinci kez → 409', async () => {
    const created = (
      await request(app.getHttpServer())
        .post('/platform/tenants')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .send({
          slug: 'e2e-f3-susp2',
          name: 'Suspend Twice',
          adminEmail: 'admin@s2.test',
          adminName: 'AA',
        })
        .expect(201)
    ).body as CreateResponse;

    await request(app.getHttpServer())
      .post(`/platform/tenants/${created.tenant.id}/suspend`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ reason: 'violation' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/platform/tenants/${created.tenant.id}/suspend`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ reason: 'violation' })
      .expect(409);
  });

  it('reactivate: suspended → active, suspend metadata temizlenir', async () => {
    const created = (
      await request(app.getHttpServer())
        .post('/platform/tenants')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .send({
          slug: 'e2e-f3-react',
          name: 'Reactivate Test',
          adminEmail: 'admin@react.test',
          adminName: 'AA',
        })
        .expect(201)
    ).body as CreateResponse;

    await request(app.getHttpServer())
      .post(`/platform/tenants/${created.tenant.id}/suspend`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ reason: 'customer_request' })
      .expect(200);

    // reactivate suspended olmayan tenant'ta → 409 (sanity check)
    await request(app.getHttpServer())
      .post(`/platform/tenants/${created.tenant.id}/reactivate`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .expect(200);

    const after = await prisma.tenant.findUnique({ where: { id: created.tenant.id } });
    expect(after?.status).toBe('active');
    expect(after?.suspendReason).toBeNull();
    expect(after?.suspendedAt).toBeNull();
  });

  it('reactivate: zaten aktifse → 409', async () => {
    const created = (
      await request(app.getHttpServer())
        .post('/platform/tenants')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .send({
          slug: 'e2e-f3-act',
          name: 'Already Active',
          adminEmail: 'admin@act.test',
          adminName: 'AA',
        })
        .expect(201)
    ).body as CreateResponse;
    await request(app.getHttpServer())
      .post(`/platform/tenants/${created.tenant.id}/reactivate`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .expect(409);
  });

  it('stats: counts döner', async () => {
    const created = (
      await request(app.getHttpServer())
        .post('/platform/tenants')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .send({
          slug: 'e2e-f3-stats',
          name: 'Stats Test',
          adminEmail: 'admin@stats.test',
          adminName: 'AA',
        })
        .expect(201)
    ).body as CreateResponse;

    const res = await request(app.getHttpServer())
      .get(`/platform/tenants/${created.tenant.id}/stats`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .expect(200);
    expect(res.body.tenant.id).toBe(created.tenant.id);
    expect(res.body.stats.userCount).toBe(1); // sadece admin
    expect(res.body.stats.patientCount).toBe(0);
    expect(res.body.stats.recentAppointmentCount).toBe(0);
  });

  it("audit: create + suspend + reactivate eylemleri PlatformAuditLog'da", async () => {
    const created = (
      await request(app.getHttpServer())
        .post('/platform/tenants')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .send({
          slug: 'e2e-f3-aud',
          name: 'Audit Trail',
          adminEmail: 'admin@aud.test',
          adminName: 'AA',
        })
        .expect(201)
    ).body as CreateResponse;
    await request(app.getHttpServer())
      .post(`/platform/tenants/${created.tenant.id}/suspend`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ reason: 'other' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/platform/tenants/${created.tenant.id}/reactivate`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .expect(200);

    const actions = await prisma.platformAuditLog.findMany({
      where: { entityId: created.tenant.id },
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual([
      'tenant.create',
      'tenant.suspend',
      'tenant.reactivate',
    ]);
  });
});
