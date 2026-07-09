import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PlatformIpAllowlistGuard } from './platform-ip-allowlist.guard';

// #933 — PlatformIpAllowlistGuard canActivate suite: CIDR match, fail-closed,
// dev-bypass, IPv6-mapped/loopback normalizasyon. (Boot fail-fast #918 ayrı spec.)
// Not: X-Forwarded-For → req.ip çözümü Express `trust proxy 1` (main.ts) işidir;
// guard, çözülmüş req.ip'yi allowlist'e karşı değerlendirir → burada req.ip verilir.
function makeGuard(opts: { isPlatform: boolean; devOpen?: boolean; cidrs?: string[] }) {
  const reflector = { getAllAndOverride: () => opts.isPlatform } as unknown as Reflector;
  const prisma = {
    platformAdminIpAllowlist: {
      findMany: async () =>
        (opts.cidrs ?? []).map((cidr, i) => ({ id: String(i), cidr, isActive: true })),
    },
  } as never;
  const config = {
    get: (k: string) =>
      k === 'DEV_PLATFORM_OPEN_IPS' ? (opts.devOpen ? 'true' : 'false') : undefined,
  } as unknown as ConfigService;
  return new PlatformIpAllowlistGuard(reflector, prisma, config);
}

function ctx(ip: string): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ ip }) }),
  } as unknown as ExecutionContext;
}

describe('PlatformIpAllowlistGuard.canActivate (#933)', () => {
  it('non-platform route → allow (guard skip, IP kontrolü yok)', async () => {
    await expect(makeGuard({ isPlatform: false }).canActivate(ctx('8.8.8.8'))).resolves.toBe(true);
  });

  it('dev bypass (DEV_PLATFORM_OPEN_IPS=true) → allow', async () => {
    await expect(
      makeGuard({ isPlatform: true, devOpen: true }).canActivate(ctx('9.9.9.9')),
    ).resolves.toBe(true);
  });

  it('IP allowlist CIDR içinde → allow', async () => {
    const g = makeGuard({ isPlatform: true, cidrs: ['10.0.0.0/8', '192.168.1.0/24'] });
    await expect(g.canActivate(ctx('10.5.6.7'))).resolves.toBe(true);
  });

  it('IP allowlist dışında → deny (fail-closed)', async () => {
    const g = makeGuard({ isPlatform: true, cidrs: ['192.168.1.0/24'] });
    await expect(g.canActivate(ctx('8.8.8.8'))).rejects.toThrow(ForbiddenException);
  });

  it('boş allowlist → deny (fail-closed, hepsini reddet)', async () => {
    const g = makeGuard({ isPlatform: true, cidrs: [] });
    await expect(g.canActivate(ctx('10.0.0.1'))).rejects.toThrow(ForbiddenException);
  });

  it('IPv6-mapped IPv4 (::ffff:10.0.0.5) → normalise + match', async () => {
    const g = makeGuard({ isPlatform: true, cidrs: ['10.0.0.0/8'] });
    await expect(g.canActivate(ctx('::ffff:10.0.0.5'))).resolves.toBe(true);
  });

  it('IPv6 loopback (::1) → 127.0.0.1 normalise + match', async () => {
    const g = makeGuard({ isPlatform: true, cidrs: ['127.0.0.0/8'] });
    await expect(g.canActivate(ctx('::1'))).resolves.toBe(true);
  });

  it('boş/eksik IP → deny', async () => {
    const g = makeGuard({ isPlatform: true, cidrs: ['10.0.0.0/8'] });
    await expect(g.canActivate(ctx(''))).rejects.toThrow(ForbiddenException);
  });
});
