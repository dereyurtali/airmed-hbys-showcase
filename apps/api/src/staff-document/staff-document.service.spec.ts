import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantContextService } from '../tenant/tenant-context.service';
import type { StorageService } from '../storage/storage.service';
import { StaffDocumentService } from './staff-document.service';

// #1049 — upload doğrulama (MIME/magic-byte/boyut/çift-FK), soft-delete,
// view-or-own erişim kuralı.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'uuuuuuuu-uuuu-uuuu-uuuu-uuuuuuuuuuuu';
const OTHER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DOC_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

const PDF_BUFFER = Buffer.from('%PDF-1.7 fake body');
const FAKE_PDF = Buffer.from('MZ not a pdf at all');

function makeService(overrides?: { docRow?: Record<string, unknown> | null }) {
  const scoped = {
    user: { findFirst: jest.fn().mockResolvedValue({ id: USER_ID }) },
    doctor: { findFirst: jest.fn().mockResolvedValue(null) },
    staffDocument: {
      create: jest.fn().mockImplementation((args: { data: unknown }) => Promise.resolve(args.data)),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(overrides?.docRow ?? null),
      update: jest.fn().mockResolvedValue({ id: DOC_ID }),
    },
  };
  const prisma = { scoped } as unknown as PrismaService;
  const tenantContext = {
    requireTenantId: jest.fn().mockReturnValue(TENANT_ID),
  } as unknown as TenantContextService;
  const storage = {
    buildScopedKey: jest.fn().mockReturnValue(`${TENANT_ID}/staff/${USER_ID}/x.pdf`),
    saveBuffer: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(true),
    readStream: jest.fn().mockReturnValue({}),
  } as unknown as StorageService;
  return { service: new StaffDocumentService(prisma, tenantContext, storage), scoped, storage };
}

const admin = { id: USER_ID, roles: ['yonetici'] as const };
const plainUser = { id: USER_ID, roles: ['resepsiyon'] as const };

const validUpload = {
  buffer: PDF_BUFFER,
  fileName: 'cv.pdf',
  mimeType: 'application/pdf',
  docType: 'cv',
  userId: USER_ID,
};

describe('StaffDocumentService.upload (#1049)', () => {
  it('geçerli PDF yüklenir (tenant + fileKey + uploadedBy doğru)', async () => {
    const { service, scoped, storage } = makeService();
    await service.upload(validUpload, admin);
    expect(storage.saveBuffer).toHaveBeenCalled();
    expect(scoped.staffDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          userId: USER_ID,
          docType: 'cv',
          uploadedById: USER_ID,
        }),
      }),
    );
  });

  it('userId + doctorId ikisi de boş → 400 (çift-FK kuralı)', async () => {
    const { service } = makeService();
    await expect(
      service.upload({ ...validUpload, userId: null, doctorId: null }, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('izinsiz MIME → 400', async () => {
    const { service } = makeService();
    await expect(
      service.upload({ ...validUpload, mimeType: 'image/svg+xml' }, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sahte içerik (magic-byte uyuşmaz) → 400, dosya yazılmaz', async () => {
    const { service, storage } = makeService();
    await expect(
      service.upload({ ...validUpload, buffer: FAKE_PDF }, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.saveBuffer).not.toHaveBeenCalled();
  });

  it('15MB üstü → 400', async () => {
    const { service } = makeService();
    const big = Buffer.concat([PDF_BUFFER, Buffer.alloc(15 * 1024 * 1024)]);
    await expect(service.upload({ ...validUpload, buffer: big }, admin)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('geçersiz docType → 400', async () => {
    const { service } = makeService();
    await expect(
      service.upload({ ...validUpload, docType: 'passport' }, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('DB insert patlarsa dosya temizlenir (orphan yok)', async () => {
    const { service, scoped, storage } = makeService();
    scoped.staffDocument.create.mockRejectedValue(new Error('db down'));
    await expect(service.upload(validUpload, admin)).rejects.toThrow('db down');
    expect(storage.remove).toHaveBeenCalled();
  });
});

describe('StaffDocumentService erişim kuralları (#1049)', () => {
  it('view:staffDocument olmayan kullanıcı listede kendi kayıtlarına daraltılır', async () => {
    const { service, scoped } = makeService();
    await service.list({}, plainUser);
    expect(scoped.staffDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: [{ userId: USER_ID }] }),
      }),
    );
  });

  it('yönetici (view:staffDocument) tüm kayıtları listeler (OR daraltması yok)', async () => {
    const { service, scoped } = makeService();
    await service.list({}, admin);
    const where = scoped.staffDocument.findMany.mock.calls[0][0].where as Record<string, unknown>;
    expect(where.OR).toBeUndefined();
  });

  it('serve: başkasının dökümanı + yetki yok → 403', async () => {
    const { service } = makeService({
      docRow: {
        fileKey: 'k',
        fileName: 'cv.pdf',
        mimeType: 'application/pdf',
        userId: OTHER_ID,
        doctorId: null,
      },
    });
    await expect(service.serve(DOC_ID, plainUser)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('serve: kendi dökümanı yetkisiz kullanıcıya açık', async () => {
    const { service } = makeService({
      docRow: {
        fileKey: 'k',
        fileName: 'cv.pdf',
        mimeType: 'application/pdf',
        userId: USER_ID,
        doctorId: null,
      },
    });
    await expect(service.serve(DOC_ID, plainUser)).resolves.toBeDefined();
  });

  it('softDelete: yoksa 404, varsa deletedAt set edilir', async () => {
    const missing = makeService();
    await expect(missing.service.softDelete(DOC_ID)).rejects.toBeInstanceOf(NotFoundException);

    const present = makeService({ docRow: { id: DOC_ID } });
    await present.service.softDelete(DOC_ID);
    expect(present.scoped.staffDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: expect.any(Date) } }),
    );
  });
});
