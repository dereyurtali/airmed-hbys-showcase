import type { INestApplication } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/auth/auth.service';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

describe('AuthService cross-tenant lookups', () => {
  let app: INestApplication;
  let auth: AuthService;
  let jwt: JwtService;
  let fixtures: IsolationFixtures;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    auth = app.get(AuthService);
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('login on tenant A returns a JWT scoped to tenant A', async () => {
    const result = await auth.login(
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    const decoded = jwt.verify<{ tenantId: string; sub: string; email: string }>(
      result.accessToken,
      {
        secret: process.env.JWT_ACCESS_SECRET!,
      },
    );
    expect(decoded.tenantId).toBe(fixtures.tenantA.id);
    expect(decoded.email).toBe(fixtures.tenantA.adminEmail);
  });

  it('login on tenant B returns a JWT scoped to tenant B', async () => {
    const result = await auth.login(
      fixtures.tenantB.slug,
      fixtures.tenantB.adminEmail,
      fixtures.tenantB.adminPassword,
    );
    const decoded = jwt.verify<{ tenantId: string }>(result.accessToken, {
      secret: process.env.JWT_ACCESS_SECRET!,
    });
    expect(decoded.tenantId).toBe(fixtures.tenantB.id);
  });

  it("rejects tenant A's slug paired with tenant B's email (cross-tenant credential confusion)", async () => {
    await expect(
      auth.login(
        fixtures.tenantA.slug,
        fixtures.tenantB.adminEmail,
        fixtures.tenantB.adminPassword,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects tenant B's password against tenant A's email", async () => {
    await expect(
      auth.login(fixtures.tenantA.slug, fixtures.tenantA.adminEmail, 'wrongpass1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refresh cookie issued for tenant A cannot be used to mint tenant B tokens', async () => {
    const a = await auth.login(
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    const refreshed = await auth.refresh(a.refreshToken);
    const decoded = jwt.verify<{ tenantId: string }>(refreshed.accessToken, {
      secret: process.env.JWT_ACCESS_SECRET!,
    });
    expect(decoded.tenantId).toBe(fixtures.tenantA.id);
  });

  it('login is rejected when tenant A is suspended (cleared again so later tests work)', async () => {
    const { PrismaClient } = await import('@airmed/db');
    const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
    try {
      await admin.tenant.update({
        where: { id: fixtures.tenantA.id },
        data: { status: 'suspended', suspendedAt: new Date() },
      });
      await expect(
        auth.login(
          fixtures.tenantA.slug,
          fixtures.tenantA.adminEmail,
          fixtures.tenantA.adminPassword,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    } finally {
      await admin.tenant.update({
        where: { id: fixtures.tenantA.id },
        data: { status: 'active', suspendedAt: null },
      });
      await admin.$disconnect();
    }
  });
});
