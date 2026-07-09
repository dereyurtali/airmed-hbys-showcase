import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtPayload } from '../auth.types';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

function makeContext(user: Partial<JwtPayload> | undefined): ExecutionContext {
  const req = user ? { user } : {};
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows requests when no @Roles metadata is set', () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext({ roles: [] }))).toBe(true);
  });

  it('allows requests when required role list is empty', () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext({ roles: ['resepsiyon'] }))).toBe(true);
  });

  it('allows when user holds at least one required role', () => {
    const reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key) => (key === ROLES_KEY ? ['yonetici', 'doktor'] : undefined));
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext({ roles: ['doktor', 'resepsiyon'] }))).toBe(true);
  });

  it('throws ForbiddenException when user holds none of the required roles', () => {
    const reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key) => (key === ROLES_KEY ? ['yonetici'] : undefined));
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(makeContext({ roles: ['resepsiyon'] }))).toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException when request has no user (e.g. JwtAuthGuard skipped)', () => {
    const reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key) => (key === ROLES_KEY ? ['yonetici'] : undefined));
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });

  // #665 — kilitli mod (olcum kiosk) @Roles-gated REST endpoint'ine erişemez,
  // kullanıcı gerekli role sahip olsa bile (mode-blind bypass kapandı).
  it('kilitli modda (olcum) gerekli rol olsa bile reddeder', () => {
    const reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key) => (key === ROLES_KEY ? ['yonetici'] : undefined));
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(makeContext({ roles: ['yonetici'], mode: 'olcum' }))).toThrow(
      ForbiddenException,
    );
  });

  it('kilitsiz mod (genel) gerekli rol varsa izin verir', () => {
    const reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key) => (key === ROLES_KEY ? ['yonetici'] : undefined));
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext({ roles: ['yonetici'], mode: 'genel' }))).toBe(true);
  });
});
