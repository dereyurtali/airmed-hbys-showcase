import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ClinicLogoService } from './clinic-logo.service';

// ClinicLogoService unit tests — file size + MIME validation + permission gating.
// Storage + Prisma are mocked; we only verify the contract (input → result).

describe('ClinicLogoService.validate (üzerinden upload + writeForTenant)', () => {
  const tenantContext = { requireTenantId: jest.fn().mockReturnValue('tenant-1') };
  const prisma = {
    tenant: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const storage = {
    saveBuffer: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(false),
    readStream: jest.fn(),
  };

  function makeService() {
    return new ClinicLogoService(prisma as never, storage as never, tenantContext as never);
  }

  const validBuffer = Buffer.from('fake png bytes');

  beforeEach(() => {
    jest.clearAllMocks();
    tenantContext.requireTenantId.mockReturnValue('tenant-1');
    prisma.tenant.updateMany.mockResolvedValue({ count: 1 });
  });

  it('yetkisiz aktör → ForbiddenException', async () => {
    const svc = makeService();
    await expect(
      svc.upload({ buffer: validBuffer, mimeType: 'image/png' }, { roles: ['doktor'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // #665 — effectivePerms (mod-daraltılmış) otoriter: yönetici rolü olsa bile
  // kilitli modda (effectivePerms perm içermez) logo değiştirilemez (mode-blind kapandı).
  it('yönetici ama effectivePerms kısıtlı (kilitli mod) → ForbiddenException', async () => {
    const svc = makeService();
    await expect(
      svc.upload(
        { buffer: validBuffer, mimeType: 'image/png' },
        { roles: ['yonetici'], effectivePerms: ['page:measurementQueue'] },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('yönetici + valid PNG → logoUrl döner + Tenant updateMany çağrılır', async () => {
    const svc = makeService();
    const res = await svc.upload(
      { buffer: validBuffer, mimeType: 'image/png' },
      { roles: ['yonetici'] },
    );
    expect(res.logoUrl).toMatch(/^\/api\/clinic-settings\/logo\/file\?tenantId=[^&]+&v=\d+$/);
    expect(storage.saveBuffer).toHaveBeenCalled();
    expect(prisma.tenant.updateMany).toHaveBeenCalledWith({
      where: { id: 'tenant-1', deletedAt: null, status: 'active' },
      data: {
        logoUrl: expect.stringMatching(
          /^\/api\/clinic-settings\/logo\/file\?tenantId=[^&]+&v=\d+$/,
        ),
      },
    });
  });

  it('boş buffer → BadRequest', async () => {
    const svc = makeService();
    await expect(
      svc.writeForTenant('t1', { buffer: Buffer.alloc(0), mimeType: 'image/png' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('2 MB üstü → BadRequest', async () => {
    const svc = makeService();
    const big = Buffer.alloc(2 * 1024 * 1024 + 1);
    await expect(svc.writeForTenant('t1', { buffer: big, mimeType: 'image/png' })).rejects.toThrow(
      /2 MB/,
    );
  });

  it('desteklenmeyen MIME → BadRequest', async () => {
    const svc = makeService();
    await expect(
      svc.writeForTenant('t1', { buffer: validBuffer, mimeType: 'application/pdf' }),
    ).rejects.toThrow(/Desteklenmeyen/);
  });

  it('writeForTenant başarılı → storage.saveBuffer çağrılır + logoUrl döner', async () => {
    const svc = makeService();
    const res = await svc.writeForTenant('t1', {
      buffer: validBuffer,
      mimeType: 'image/webp',
    });
    expect(res.logoUrl).toMatch(/^\/api\/clinic-settings\/logo\/file\?tenantId=[^&]+&v=\d+$/);
    expect(storage.saveBuffer).toHaveBeenCalledWith(
      expect.stringContaining('t1/clinic/logo.webp'),
      validBuffer,
    );
  });

  it('remove() yetkisiz → Forbidden', async () => {
    const svc = makeService();
    await expect(svc.remove({ roles: ['hemsire'] })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('remove() yönetici → Tenant.logoUrl null + storage temizlenir', async () => {
    const svc = makeService();
    await svc.remove({ roles: ['yonetici'] });
    expect(storage.remove).toHaveBeenCalled();
    expect(prisma.tenant.updateMany).toHaveBeenCalledWith({
      where: { id: 'tenant-1', deletedAt: null, status: 'active' },
      data: { logoUrl: null },
    });
  });
});
