import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetAndSeedFixtures, type IsolationFixtures } from './fixtures';
import { createTestApp } from './test-app';

describe('Refresh cookie tampering', () => {
  let app: INestApplication;
  let auth: AuthService;
  let prisma: PrismaService;
  let fixtures: IsolationFixtures;

  beforeAll(async () => {
    fixtures = await resetAndSeedFixtures(process.env.DATABASE_URL!);
    app = await createTestApp();
    auth = app.get(AuthService);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('cookie issued for tenant A is prefixed with A.id and matches the format', async () => {
    const { refreshToken } = await auth.login(
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    expect(refreshToken).toMatch(new RegExp(`^${fixtures.tenantA.id}\\.[0-9a-f]{64}$`));
  });

  it("refresh fails when an attacker swaps the prefix to tenant B but keeps tenant A's hex", async () => {
    const { refreshToken } = await auth.login(
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    const [, hex] = refreshToken.split('.');
    const forged = `${fixtures.tenantB.id}.${hex}`;
    await expect(auth.refresh(forged)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('logout silently no-ops on a foreign cookie (no information leak about hash existence)', async () => {
    const { refreshToken: aCookie } = await auth.login(
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    const [, hex] = aCookie.split('.');
    const forged = `${fixtures.tenantB.id}.${hex}`;

    await expect(auth.logout(forged)).resolves.toBeUndefined();
    // The legitimate token must still be active.
    await expect(auth.refresh(aCookie)).resolves.toMatchObject({
      accessToken: expect.any(String),
    });
  });

  it('logout with the legitimate cookie revokes the row in the DB', async () => {
    const { refreshToken } = await auth.login(
      fixtures.tenantA.slug,
      fixtures.tenantA.adminEmail,
      fixtures.tenantA.adminPassword,
    );
    await auth.logout(refreshToken);
    await expect(auth.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refresh with malformed cookie rejects without touching the database', async () => {
    const before = await prisma.refreshToken.count();
    await expect(auth.refresh('not-a-valid-cookie')).rejects.toBeInstanceOf(UnauthorizedException);
    const after = await prisma.refreshToken.count();
    expect(after).toBe(before);
  });
});
