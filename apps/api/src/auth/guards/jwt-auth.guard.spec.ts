import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { JwtAuthGuard, isPlatformPath } from './jwt-auth.guard';
import { IS_PLATFORM_ROUTE_KEY } from '../../common/decorators/platform-route.decorator';

// #970 — global JwtAuthGuard fail-safe: @PlatformRoute() unutulmuş bir
// /platform/* controller'ı tenant 'jwt' stratejisine düşerse klinik JWT'si
// platform handler'ını tatmin ederdi. Path-tabanlı fail-closed 403.

function makeReflector(isPlatformRoute: boolean | undefined): Reflector {
  return {
    getAllAndOverride: (key: string) =>
      key === IS_PLATFORM_ROUTE_KEY ? isPlatformRoute : undefined,
  } as unknown as Reflector;
}

function makeContext(path: string): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ path }) }),
  } as unknown as ExecutionContext;
}

describe('isPlatformPath', () => {
  it.each([
    ['/platform', true],
    ['/platform/auth/login', true],
    ['/platform/tenants/abc', true],
    ['/api/patients', false],
    ['/api/platform-x', false],
    ['/health', false],
  ])('%s → %s', (path, expected) => {
    expect(isPlatformPath(path)).toBe(expected);
  });
});

describe('JwtAuthGuard platform fail-safe (#970)', () => {
  it('unmarked /platform/* path → 403 (fail-closed)', () => {
    const guard = new JwtAuthGuard(makeReflector(false));
    expect(() => guard.canActivate(makeContext('/platform/newfeature'))).toThrow(
      ForbiddenException,
    );
  });

  it('@PlatformRoute() işaretli /platform/* → true (mevcut davranış korunur)', () => {
    const guard = new JwtAuthGuard(makeReflector(true));
    expect(guard.canActivate(makeContext('/platform/auth/login'))).toBe(true);
  });
});
