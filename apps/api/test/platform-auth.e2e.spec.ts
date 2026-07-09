import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

const ADMIN_EMAIL = 'platform-e2e-owner@dna.test';
const ADMIN_PASSWORD = 'platform-test-pass';

describe('Platform auth (F2b: login challenge → setup-totp → verify-totp)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let jwt: JwtService;
  let auth: AuthService;
  let fixtures: IsolationFixtures;
  let adminId: string;

  // Lock TOTP step option to match TotpService settings (window=1, step=30).
  authenticator.options = { window: 1, step: 30 };

  async function loginPassword(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/platform/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    return res.body.challengeToken as string;
  }

  async function fullLoginWithSecret(secret: string): Promise<{
    accessToken: string;
    cookies: string[];
  }> {
    const challenge = await loginPassword();
    const code = authenticator.generate(secret);
    const res = await request(app.getHttpServer())
      .post('/platform/auth/verify-totp')
      .set('Authorization', `Bearer ${challenge}`)
      .send({ code })
      .expect(200);
    return {
      accessToken: res.body.accessToken,
      cookies: res.headers['set-cookie'] as unknown as string[] | string | undefined as string[],
    };
  }

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    jwt = app.get(JwtService);
    auth = app.get(AuthService);
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

    await prisma.platformAdmin.deleteMany({ where: { email: ADMIN_EMAIL } });
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 4);
    const created = await prisma.platformAdmin.create({
      data: {
        email: ADMIN_EMAIL,
        passwordHash,
        name: 'Platform E2E',
        role: 'platform_owner',
      },
    });
    adminId = created.id;
  });

  beforeEach(async () => {
    await prisma.platformAdminSession.deleteMany({ where: { adminId } });
    await prisma.platformAdminRecoveryCode.deleteMany({ where: { adminId } });
    await prisma.platformAdmin.update({
      where: { id: adminId },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        totpSecret: null,
        totpVerifiedAt: null,
      },
    });
    await prisma.platformAdminLoginAttempt.deleteMany({ where: { email: ADMIN_EMAIL } });
    await prisma.platformAuditLog.deleteMany({ where: { email: ADMIN_EMAIL } });
  });

  afterAll(async () => {
    await prisma.platformAdminSession.deleteMany({ where: { adminId } });
    await prisma.platformAdminRecoveryCode.deleteMany({ where: { adminId } });
    await prisma.platformAdminLoginAttempt.deleteMany({ where: { email: ADMIN_EMAIL } });
    await prisma.platformAuditLog.deleteMany({ where: { email: ADMIN_EMAIL } });
    await prisma.platformAdmin.deleteMany({ where: { email: ADMIN_EMAIL } });
    await prisma.$disconnect();
    await app.close();
  });

  it('login OK (no totp yet) → challenge token + needsTotpSetup=true', async () => {
    const res = await request(app.getHttpServer())
      .post('/platform/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);

    expect(res.body.challengeToken).toBeDefined();
    expect(res.body.needsTotpSetup).toBe(true);
    // No refresh cookie at this stage — only after verify-totp.
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('login wrong password → 401, attempt + failure audit logged', async () => {
    await request(app.getHttpServer())
      .post('/platform/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'definitely-wrong' })
      .expect(401);

    const attempt = await prisma.platformAdminLoginAttempt.findFirst({
      where: { email: ADMIN_EMAIL, success: false },
    });
    expect(attempt?.failureReason).toBe('wrong_password');

    const failureAudit = await prisma.platformAuditLog.findFirst({
      where: { email: ADMIN_EMAIL, action: 'platform.auth.login.failure' },
    });
    expect(failureAudit).not.toBeNull();
  });

  it('3 wrong passwords → admin locked, 4th login rejected with locked message', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/platform/auth/login')
        .send({ email: ADMIN_EMAIL, password: 'definitely-wrong' })
        .expect(401);
    }

    const locked = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: adminId } });
    expect(locked.lockedUntil).not.toBeNull();

    const res = await request(app.getHttpServer())
      .post('/platform/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(401);
    expect(String(res.body.message)).toMatch(/locked/i);
  });

  it('setup-totp persists secret, returns otpauth URL + 10 recovery codes', async () => {
    const challenge = await loginPassword();

    const res = await request(app.getHttpServer())
      .post('/platform/auth/setup-totp')
      .set('Authorization', `Bearer ${challenge}`)
      .expect(200);

    expect(res.body.secret).toMatch(/^[A-Z2-7]{16,}$/);
    expect(res.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(Array.isArray(res.body.recoveryCodes)).toBe(true);
    expect(res.body.recoveryCodes).toHaveLength(10);

    const admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: adminId } });
    expect(admin.totpSecret).toBe(res.body.secret);

    const codes = await prisma.platformAdminRecoveryCode.findMany({ where: { adminId } });
    expect(codes).toHaveLength(10);
    expect(codes.every((c) => c.usedAt === null)).toBe(true);
  });

  it('setup-totp twice → second call rejected (already configured)', async () => {
    const challenge1 = await loginPassword();
    await request(app.getHttpServer())
      .post('/platform/auth/setup-totp')
      .set('Authorization', `Bearer ${challenge1}`)
      .expect(200);

    const challenge2 = await loginPassword();
    await request(app.getHttpServer())
      .post('/platform/auth/setup-totp')
      .set('Authorization', `Bearer ${challenge2}`)
      .expect(412);
  });

  it('verify-totp with correct code → access + refresh cookie + audit', async () => {
    const challengeSetup = await loginPassword();
    const setup = await request(app.getHttpServer())
      .post('/platform/auth/setup-totp')
      .set('Authorization', `Bearer ${challengeSetup}`)
      .expect(200);

    // Existing admin record now has totpSecret → next login will be 'totp_required'.
    const challenge = await loginPassword();
    const code = authenticator.generate(setup.body.secret as string);

    const res = await request(app.getHttpServer())
      .post('/platform/auth/verify-totp')
      .set('Authorization', `Bearer ${challenge}`)
      .send({ code })
      .expect(200);

    expect(res.body.accessToken).toBeDefined();
    const decoded = jwt.verify<{ sub: string; role: string }>(res.body.accessToken, {
      secret: process.env.PLATFORM_JWT_ACCESS_SECRET!,
    });
    expect(decoded.sub).toBe(adminId);
    expect(decoded.role).toBe('platform_owner');
    const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(cookies.some((c) => c.startsWith('airmed_platform_refresh='))).toBe(true);

    const audit = await prisma.platformAuditLog.findFirst({
      where: { adminId, action: 'platform.auth.login.success' },
    });
    expect(audit).not.toBeNull();
  });

  it('verify-totp wrong code → 401', async () => {
    const challengeSetup = await loginPassword();
    await request(app.getHttpServer())
      .post('/platform/auth/setup-totp')
      .set('Authorization', `Bearer ${challengeSetup}`)
      .expect(200);

    const challenge = await loginPassword();
    await request(app.getHttpServer())
      .post('/platform/auth/verify-totp')
      .set('Authorization', `Bearer ${challenge}`)
      .send({ code: '000000' })
      .expect(401);
  });

  it('recovery code: first use accepted, reuse rejected', async () => {
    const challengeSetup = await loginPassword();
    const setup = await request(app.getHttpServer())
      .post('/platform/auth/setup-totp')
      .set('Authorization', `Bearer ${challengeSetup}`)
      .expect(200);
    const recoveryCode = setup.body.recoveryCodes[0] as string;

    const c1 = await loginPassword();
    await request(app.getHttpServer())
      .post('/platform/auth/verify-totp')
      .set('Authorization', `Bearer ${c1}`)
      .send({ recoveryCode })
      .expect(200);

    const c2 = await loginPassword();
    await request(app.getHttpServer())
      .post('/platform/auth/verify-totp')
      .set('Authorization', `Bearer ${c2}`)
      .send({ recoveryCode })
      .expect(401);
  });

  it('verify-totp with both code+recoveryCode → 400, neither → 400', async () => {
    const challengeSetup = await loginPassword();
    const setup = await request(app.getHttpServer())
      .post('/platform/auth/setup-totp')
      .set('Authorization', `Bearer ${challengeSetup}`)
      .expect(200);

    const c1 = await loginPassword();
    await request(app.getHttpServer())
      .post('/platform/auth/verify-totp')
      .set('Authorization', `Bearer ${c1}`)
      .send({
        code: authenticator.generate(setup.body.secret as string),
        recoveryCode: setup.body.recoveryCodes[1],
      })
      .expect(400);

    const c2 = await loginPassword();
    await request(app.getHttpServer())
      .post('/platform/auth/verify-totp')
      .set('Authorization', `Bearer ${c2}`)
      .send({})
      .expect(400);
  });

  it('expired challenge token → 401', async () => {
    // Forge a challenge JWT signed with the right secret but a 1-second TTL.
    const expired = await jwt.signAsync(
      { sub: adminId, stage: 'totp_required' },
      { secret: process.env.PLATFORM_JWT_REFRESH_SECRET!, expiresIn: '1s' },
    );
    await new Promise((r) => setTimeout(r, 1100));

    await request(app.getHttpServer())
      .post('/platform/auth/verify-totp')
      .set('Authorization', `Bearer ${expired}`)
      .send({ code: '123456' })
      .expect(401);
  });

  it('refresh + logout still rotate sessions correctly post-totp', async () => {
    const challengeSetup = await loginPassword();
    const setup = await request(app.getHttpServer())
      .post('/platform/auth/setup-totp')
      .set('Authorization', `Bearer ${challengeSetup}`)
      .expect(200);
    const { cookies } = await fullLoginWithSecret(setup.body.secret as string);
    const cookieHeader = (cookies as unknown as string[]).join('; ');

    await request(app.getHttpServer())
      .post('/platform/auth/refresh')
      .set('Cookie', cookieHeader)
      .expect(200);

    // Old session revoked; one active row (the rotated one).
    const sessions = await prisma.platformAdminSession.findMany({ where: { adminId } });
    expect(sessions.length).toBe(2);
    expect(sessions.filter((s) => s.revokedAt !== null).length).toBe(1);
    expect(sessions.filter((s) => s.revokedAt === null).length).toBe(1);
  });

  it('GET /platform/auth/me requires platform JWT (tenant JWT rejected)', async () => {
    // Set up TOTP and complete a real login first.
    const challengeSetup = await loginPassword();
    const setup = await request(app.getHttpServer())
      .post('/platform/auth/setup-totp')
      .set('Authorization', `Bearer ${challengeSetup}`)
      .expect(200);
    const { accessToken } = await fullLoginWithSecret(setup.body.secret as string);

    // Tenant JWT is rejected.
    const tenantTokens = await auth.login(
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    await request(app.getHttpServer())
      .get('/platform/auth/me')
      .set('Authorization', `Bearer ${tenantTokens.accessToken}`)
      .expect(401);

    // Platform JWT works.
    const ok = await request(app.getHttpServer())
      .get('/platform/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(ok.body.email).toBe(ADMIN_EMAIL);
  });

  it('platform login does not touch tenant audit_logs', async () => {
    const challengeSetup = await loginPassword();
    const setup = await request(app.getHttpServer())
      .post('/platform/auth/setup-totp')
      .set('Authorization', `Bearer ${challengeSetup}`)
      .expect(200);
    await fullLoginWithSecret(setup.body.secret as string);

    const tenantAuditCount = await prisma.auditLog.count({
      where: { action: { startsWith: 'platform.' } },
    });
    expect(tenantAuditCount).toBe(0);
  });
});
