import type { ConfigService } from '@nestjs/config';
import { PlatformIpAllowlistGuard } from './platform-ip-allowlist.guard';

// #918 — DEV_PLATFORM_OPEN_IPS prod'da IP allowlist'i sessizce kapatır.
// Boot-time fail-fast: guard constructor'ı prod + devOpen kombinasyonunda throw.
function makeConfig(devOpen: boolean): ConfigService {
  return {
    get: (key: string) =>
      key === 'DEV_PLATFORM_OPEN_IPS' ? (devOpen ? 'true' : 'false') : undefined,
  } as unknown as ConfigService;
}

describe('PlatformIpAllowlistGuard boot-time fail-fast (#918)', () => {
  const reflector = {} as never;
  const prisma = {} as never;
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('prod + DEV_PLATFORM_OPEN_IPS=true → construction throws', () => {
    process.env.NODE_ENV = 'production';
    expect(() => new PlatformIpAllowlistGuard(reflector, prisma, makeConfig(true))).toThrow(
      /DEV_PLATFORM_OPEN_IPS/,
    );
  });

  it('development + DEV_PLATFORM_OPEN_IPS=true → no throw (dev bypass korunur)', () => {
    process.env.NODE_ENV = 'development';
    expect(() => new PlatformIpAllowlistGuard(reflector, prisma, makeConfig(true))).not.toThrow();
  });

  it('prod + DEV_PLATFORM_OPEN_IPS kapalı → no throw', () => {
    process.env.NODE_ENV = 'production';
    expect(() => new PlatformIpAllowlistGuard(reflector, prisma, makeConfig(false))).not.toThrow();
  });
});
