import type { AdminPrismaService } from '../../prisma/admin-prisma.service';
import { PlatformSecurityService } from './platform-security.service';

// #1090 — güvenlik görünürlük servisi davranış kilidi (#938).

describe('PlatformSecurityService (#1090)', () => {
  it('summary: 4 sayacı paralel toplar', async () => {
    const admin = {
      platformAdminLoginAttempt: { count: jest.fn().mockResolvedValue(3) },
      auditLog: { count: jest.fn().mockResolvedValue(7) },
      user: { count: jest.fn().mockResolvedValue(2) },
      tenantImpersonation: { count: jest.fn().mockResolvedValue(1) },
    } as unknown as AdminPrismaService;
    const svc = new PlatformSecurityService(admin);
    const s = await svc.summary();
    expect(s).toEqual({
      platformLoginFails24h: 3,
      clinicLoginFails24h: 7,
      lockedClinicUsers: 2,
      activeImpersonations: 1,
    });
  });

  it('loginAttempts: take+1 ile nextCursor hesaplar', async () => {
    const mk = (id: number) => ({
      id,
      email: `a${id}@x.co`,
      ipAddress: '1.2.3.4',
      success: false,
      failureReason: 'bad_credentials',
      createdAt: new Date('2026-07-04T00:00:00Z'),
    });
    const admin = {
      platformAdminLoginAttempt: {
        // limit 2 → take 3 döner, hasMore
        findMany: jest.fn().mockResolvedValue([mk(3), mk(2), mk(1)]),
      },
    } as unknown as AdminPrismaService;
    const svc = new PlatformSecurityService(admin);
    const res = await svc.loginAttempts({ limit: 2 });
    expect(res.rows).toHaveLength(2);
    expect(res.nextCursor).toBe('2');
    expect(res.rows[0].ip).toBe('1.2.3.4');
  });

  it('loginAttempts: son sayfada nextCursor null', async () => {
    const admin = {
      platformAdminLoginAttempt: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            email: 'a@x.co',
            ipAddress: null,
            success: true,
            failureReason: null,
            createdAt: new Date('2026-07-04T00:00:00Z'),
          },
        ]),
      },
    } as unknown as AdminPrismaService;
    const svc = new PlatformSecurityService(admin);
    const res = await svc.loginAttempts({ limit: 50 });
    expect(res.nextCursor).toBeNull();
  });

  it('lockedUsers: tenant adıyla + null tenant → —', async () => {
    const admin = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'u1',
            email: 'x@c.co',
            name: 'X',
            lockedUntil: new Date('2026-07-04T01:00:00Z'),
            failedLoginCount: 5,
            tenant: { name: 'DemoEye' },
          },
        ]),
      },
    } as unknown as AdminPrismaService;
    const svc = new PlatformSecurityService(admin);
    const rows = await svc.lockedUsers();
    expect(rows[0].tenantName).toBe('DemoEye');
    expect(rows[0].failedLoginCount).toBe(5);
  });
});
