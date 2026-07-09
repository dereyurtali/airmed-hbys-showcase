import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import request from 'supertest';
import { resetAndSeedFixtures } from './fixtures';
import { createTestApp } from './test-app';

// #948 (Feature 4) — IP allowlist yönetimi. list okuma tüm rollere; add/remove
// yalnız platform_owner. Self-lockout: silme sonrası actor IP'si (test=127.0.0.1)
// kalan kurallarla eşleşmezse 409. DoD: owner-200 / engineer-403 / invalid-400 /
// self-lockout-409 / audit.

const OWNER_EMAIL = 'platform-owner-ipallow@dna.test';
const OWNER_PASSWORD = 'ipallow-owner-pass';
const ENG_EMAIL = 'platform-eng-ipallow@dna.test';
const ENG_PASSWORD = 'ipallow-eng-pass';
const CIDR_OTHER = '10.0.0.0/8'; // actor'ı (127.0.0.1) KAPSAMAZ
const CIDR_LOCAL = '127.0.0.0/8'; // actor'ı KAPSAR

describe('Feature 4 Platform IP Allowlist (/platform/ip-allowlist)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ownerId: string;
  let engId: string;
  let ownerToken: string;
  let engToken: string;

  authenticator.options = { window: 1, step: 30 };

  async function fullLogin(email: string, password: string): Promise<string> {
    const login = await request(app.getHttpServer())
      .post('/platform/auth/login')
      .send({ email, password })
      .expect(200);
    const setup = await request(app.getHttpServer())
      .post('/platform/auth/setup-totp')
      .set('Authorization', `Bearer ${login.body.challengeToken}`)
      .expect(200);
    const secret = setup.body.secret as string;
    const challenge2 = (
      await request(app.getHttpServer())
        .post('/platform/auth/login')
        .send({ email, password })
        .expect(200)
    ).body.challengeToken as string;
    const verify = await request(app.getHttpServer())
      .post('/platform/auth/verify-totp')
      .set('Authorization', `Bearer ${challenge2}`)
      .send({ code: authenticator.generate(secret) })
      .expect(200);
    return verify.body.accessToken as string;
  }

  beforeAll(async () => {
    await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

    await prisma.platformAdmin.deleteMany({ where: { email: { in: [OWNER_EMAIL, ENG_EMAIL] } } });
    await prisma.platformAdminIpAllowlist.deleteMany({
      where: { cidr: { in: [CIDR_OTHER, CIDR_LOCAL] } },
    });
    const owner = await prisma.platformAdmin.create({
      data: {
        email: OWNER_EMAIL,
        passwordHash: await bcrypt.hash(OWNER_PASSWORD, 4),
        name: 'IP Owner',
        role: 'platform_owner',
      },
    });
    ownerId = owner.id;
    const eng = await prisma.platformAdmin.create({
      data: {
        email: ENG_EMAIL,
        passwordHash: await bcrypt.hash(ENG_PASSWORD, 4),
        name: 'IP Eng',
        role: 'platform_engineer',
      },
    });
    engId = eng.id;
    ownerToken = await fullLogin(OWNER_EMAIL, OWNER_PASSWORD);
    engToken = await fullLogin(ENG_EMAIL, ENG_PASSWORD);
  });

  afterAll(async () => {
    await prisma.platformAdminIpAllowlist.deleteMany({
      where: { cidr: { in: [CIDR_OTHER, CIDR_LOCAL] } },
    });
    await prisma.platformAdminSession.deleteMany({ where: { adminId: { in: [ownerId, engId] } } });
    await prisma.platformAdminRecoveryCode.deleteMany({
      where: { adminId: { in: [ownerId, engId] } },
    });
    await prisma.platformAuditLog.deleteMany({ where: { entityType: 'ip_allowlist' } });
    await prisma.platformAdmin.deleteMany({ where: { email: { in: [OWNER_EMAIL, ENG_EMAIL] } } });
    await prisma.$disconnect();
    await app.close();
  });

  let ruleOtherId = '';
  let ruleLocalId = '';

  it('JWT yoksa 401', async () => {
    await request(app.getHttpServer()).get('/platform/ip-allowlist').expect(401);
  });

  it('add: engineer 403', async () => {
    await request(app.getHttpServer())
      .post('/platform/ip-allowlist')
      .set('Authorization', `Bearer ${engToken}`)
      .send({ cidr: CIDR_OTHER })
      .expect(403);
  });

  it('add: geçersiz CIDR 400', async () => {
    await request(app.getHttpServer())
      .post('/platform/ip-allowlist')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ cidr: 'not-a-cidr' })
      .expect(400);
    // Regex geçer ama octet geçersiz → servis Ipv4Cidr 400.
    await request(app.getHttpServer())
      .post('/platform/ip-allowlist')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ cidr: '300.1.1.1/8' })
      .expect(400);
  });

  it('add: owner 201 (iki kural) + audit', async () => {
    const a = await request(app.getHttpServer())
      .post('/platform/ip-allowlist')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ cidr: CIDR_OTHER, label: 'ofis' })
      .expect(201);
    ruleOtherId = a.body.id as string;
    const b = await request(app.getHttpServer())
      .post('/platform/ip-allowlist')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ cidr: CIDR_LOCAL })
      .expect(201);
    ruleLocalId = b.body.id as string;

    const audit = await prisma.platformAuditLog.findFirst({
      where: { action: 'ip_allowlist.add', entityId: ruleOtherId },
    });
    expect(audit).toBeTruthy();
  });

  it('list: owner 200 içerir', async () => {
    const res = await request(app.getHttpServer())
      .get('/platform/ip-allowlist')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const cidrs = (res.body as Array<{ cidr: string }>).map((r) => r.cidr);
    expect(cidrs).toEqual(expect.arrayContaining([CIDR_OTHER, CIDR_LOCAL]));
  });

  it('remove: engineer 403', async () => {
    await request(app.getHttpServer())
      .delete(`/platform/ip-allowlist/${ruleOtherId}`)
      .set('Authorization', `Bearer ${engToken}`)
      .expect(403);
  });

  it('remove: owner actor hâlâ kapsanıyorsa 200', async () => {
    // CIDR_OTHER sil → actor (127.0.0.1) hâlâ CIDR_LOCAL ile kapsanır → izin.
    await request(app.getHttpServer())
      .delete(`/platform/ip-allowlist/${ruleOtherId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
  });

  it('remove: self-lockout 409 (son kapsayan kural)', async () => {
    // CIDR_LOCAL kalan tek kural + actor'ı kapsıyor; silmek kilitler → 409.
    await request(app.getHttpServer())
      .delete(`/platform/ip-allowlist/${ruleLocalId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(409);
  });
});
