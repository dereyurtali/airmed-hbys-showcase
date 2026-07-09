import type { INestApplication } from '@nestjs/common';
import { PrismaClient, DEFAULT_CLINIC_ROLES } from '@airmed/db';
import request from 'supertest';
import { createTestApp } from './test-app';
import { truncateAllTables } from './fixtures';

/**
 * /api/setup/* — ilk açılış kurulum endpoint'leri.
 *
 * Bu suite GERÇEKTEN boş bir DB bekler (tenant + admin setup akışı içinden
 * yaratılıyor). Diğer e2e suite'lar `resetAndSeedFixtures` ile kendi state'lerini
 * kurar; bu suite onlardan bağımsız, sıfırdan başlar — bu yüzden TÜM tabloları
 * (global/platform dahil) `truncateAllTables` ile temizler, yoksa önceki suite'in
 * feature-flag / platform satırları kalıp duplicate-key veriyordu.
 */
describe('Setup wizard (/api/setup)', () => {
  let app: INestApplication;
  let admin: PrismaClient;

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
  });

  afterAll(async () => {
    await admin.$disconnect();
  });

  beforeEach(async () => {
    // Hard reset — setup ilk açılış senaryosunu simüle eder (gerçekten boş DB).
    await truncateAllTables(admin);
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const validPayload = {
    slug: 'demoeye-test',
    clinicName: 'DemoEye Test Clinic',
    mrnPrefix: 'TT',
    locale: 'tr',
    timezone: 'Asia/Dushanbe',
    adminName: 'Klinik Yöneticisi',
    adminEmail: 'admin@demoeye.test',
    adminPassword: 'StrongInitialPass2026',
  };

  it('boş DB → status: needsSetup=true', async () => {
    const res = await request(app.getHttpServer()).get('/api/setup/status').expect(200);
    expect(res.body).toEqual({ needsSetup: true, tenant: null });
  });

  it('boş DB → bootstrap → tenant + yonetici user + 7 rol oluşur', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/setup/bootstrap')
      .send(validPayload)
      .expect(201);
    expect(res.body).toEqual({
      tenantSlug: 'demoeye-test',
      adminEmail: 'admin@demoeye.test',
    });

    const tenant = await admin.tenant.findUnique({ where: { slug: 'demoeye-test' } });
    expect(tenant).toBeTruthy();
    expect(tenant?.mrnPrefix).toBe('TT');

    // Sayı + key listesi kanonik DEFAULT_CLINIC_ROLES'a bağlı → yeni rol eklenince
    // (v0.4 finans/stok_satinalma/eczane gibi) test kendiliğinden güncel kalır, bayatlamaz.
    const roles = await admin.role.findMany({ where: { tenantId: tenant!.id } });
    expect(roles).toHaveLength(DEFAULT_CLINIC_ROLES.length);
    expect(roles.map((r) => r.key).sort()).toEqual(DEFAULT_CLINIC_ROLES.map((r) => r.key).sort());

    const adminUser = await admin.user.findFirst({ where: { email: 'admin@demoeye.test' } });
    expect(adminUser).toBeTruthy();
    expect(adminUser?.tenantId).toBe(tenant!.id);
    expect(adminUser?.mustChangePassword).toBe(false);

    const userRoles = await admin.userRole.findMany({
      where: { userId: adminUser!.id },
      include: { role: true },
    });
    expect(userRoles).toHaveLength(1);
    expect(userRoles[0]!.role.key).toBe('yonetici');

    const statusAfter = await request(app.getHttpServer()).get('/api/setup/status').expect(200);
    expect(statusAfter.body).toMatchObject({
      needsSetup: false,
      tenant: { slug: 'demoeye-test' },
    });
  });

  it('zaten kurulduktan sonra bootstrap → 409 Conflict', async () => {
    await request(app.getHttpServer()).post('/api/setup/bootstrap').send(validPayload).expect(201);

    await request(app.getHttpServer())
      .post('/api/setup/bootstrap')
      .send({ ...validPayload, slug: 'farkli-slug', adminEmail: 'baska@admin.test' })
      .expect(409);
  });

  it('geçersiz slug → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/setup/bootstrap')
      .send({ ...validPayload, slug: 'AB' }) // küçük harf değil + min uzunluk değil
      .expect(400);
  });

  it('kısa şifre → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/setup/bootstrap')
      .send({ ...validPayload, adminPassword: 'kisa' })
      .expect(400);
  });

  it('geçersiz MRN prefix → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/setup/bootstrap')
      .send({ ...validPayload, mrnPrefix: 'td' }) // büyük harf değil
      .expect(400);
  });

  it('multipart bootstrap + logo → tenant.logoUrl set olur', async () => {
    // 1x1 transparent PNG (smallest valid PNG).
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    );

    const res = await request(app.getHttpServer())
      .post('/api/setup/bootstrap')
      .field('slug', validPayload.slug)
      .field('clinicName', validPayload.clinicName)
      .field('mrnPrefix', validPayload.mrnPrefix)
      .field('locale', validPayload.locale)
      .field('timezone', validPayload.timezone)
      .field('adminName', validPayload.adminName)
      .field('adminEmail', validPayload.adminEmail)
      .field('adminPassword', validPayload.adminPassword)
      .attach('logo', pngBuffer, { filename: 'logo.png', contentType: 'image/png' })
      .expect(201);
    expect(res.body.tenantSlug).toBe('demoeye-test');

    const tenant = await admin.tenant.findUnique({ where: { slug: 'demoeye-test' } });
    expect(tenant?.logoUrl).toMatch(
      /^\/api\/clinic-settings\/logo\/file\?tenantId=[0-9a-f-]+&v=\d+$/i,
    );
  });

  it('multipart bootstrap geçersiz MIME logo → 400', async () => {
    const badBuffer = Buffer.from('not really an image', 'utf-8');
    await request(app.getHttpServer())
      .post('/api/setup/bootstrap')
      .field('slug', validPayload.slug)
      .field('clinicName', validPayload.clinicName)
      .field('mrnPrefix', validPayload.mrnPrefix)
      .field('locale', validPayload.locale)
      .field('timezone', validPayload.timezone)
      .field('adminName', validPayload.adminName)
      .field('adminEmail', validPayload.adminEmail)
      .field('adminPassword', validPayload.adminPassword)
      .attach('logo', badBuffer, { filename: 'logo.txt', contentType: 'text/plain' })
      .expect(400);

    // Validation hata atınca transaction rollback olmalı → tenant yaratılmamış olmalı.
    const tenantCount = await admin.tenant.count();
    expect(tenantCount).toBe(0);
  });

  it('paralel iki bootstrap → biri 201, biri 409 (race-safe, advisory lock)', async () => {
    const [a, b] = await Promise.allSettled([
      request(app.getHttpServer()).post('/api/setup/bootstrap').send(validPayload),
      request(app.getHttpServer())
        .post('/api/setup/bootstrap')
        .send({ ...validPayload, slug: 'demoeye-alt', adminEmail: 'alt@admin.test' }),
    ]);
    const statuses = [a, b]
      .map((r) => (r.status === 'fulfilled' ? r.value.status : 500))
      .sort((x, y) => x - y);
    expect(statuses).toEqual([201, 409]);
    // Advisory lock garantili: tek tenant + tek admin user kalır.
    const tenantCount = await admin.tenant.count();
    expect(tenantCount).toBe(1);
    const userCount = await admin.user.count();
    expect(userCount).toBe(1);
  });
});
