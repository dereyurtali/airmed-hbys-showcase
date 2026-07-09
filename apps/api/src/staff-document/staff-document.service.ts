import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { hasPermission } from '@airmed/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { StorageService } from '../storage/storage.service';
import { matchesMagicBytes } from '../storage/magic-bytes';
import {
  STAFF_DOC_TYPES,
  type StaffDocTypeValue,
  type StaffDocumentListQuery,
} from './staff-document.schemas';

// #1049 — Personel dökümanı servisi (PatientPhoto şablonu).
//
// KVKK sınırı (EPIC #1052 Karar 3): CV/diploma = İÇ İK VERİSİ. Bu servis
// hasta-facing hiçbir yüzeye (bot dahil) bağlanamaz; serve auth'lu
// StreamableFile, static serve YOK.
//
// Yetki: upload/delete = action:staffDocument.manage (yönetici).
// Görüntüleme = view:staffDocument (yönetici) VEYA kendi dökümanı — doküman
// öznesi (userId === actor VEYA doctor.userId === actor) her zaman kendi
// dökümanını listeler/indirir (#1051 self-service /profile bunun üstüne gelir).

const MAX_BYTES = 15 * 1024 * 1024; // 15MB
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

interface Actor {
  id: string;
  roles: readonly string[];
  effectivePerms?: readonly string[];
}

interface UploadInput {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  docType: string;
  userId?: string | null;
  doctorId?: string | null;
  note?: string | null;
}

const DOCUMENT_SELECT = {
  id: true,
  userId: true,
  doctorId: true,
  docType: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  note: true,
  createdAt: true,
  uploadedBy: { select: { id: true, name: true } },
  user: { select: { id: true, name: true } },
  doctor: { select: { id: true, name: true } },
} as const;

// Açık DTO — tRPC AppRouter tip enflasyonunu keser (Prisma nested-select
// inference'ı TS2589'a itiyordu) ve wire şeklini sabitler.
export interface StaffDocumentDto {
  id: string;
  userId: string | null;
  doctorId: string | null;
  docType: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  note: string | null;
  createdAt: Date;
  uploadedBy: { id: string; name: string } | null;
  user: { id: string; name: string } | null;
  doctor: { id: string; name: string } | null;
}

@Injectable()
export class StaffDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly storage: StorageService,
  ) {}

  async upload(input: UploadInput, actor: Actor): Promise<StaffDocumentDto> {
    const tenantId = this.tenantContext.requireTenantId();

    if (!STAFF_DOC_TYPES.includes(input.docType as StaffDocTypeValue)) {
      throw new BadRequestException(`Invalid docType: ${input.docType}`);
    }
    if (!input.userId && !input.doctorId) {
      throw new BadRequestException('userId veya doctorId zorunlu (en az biri)');
    }
    const mime = input.mimeType.toLowerCase();
    if (!ALLOWED_MIMES.has(mime)) {
      throw new BadRequestException(`Unsupported mime type: ${input.mimeType}`);
    }
    if (input.buffer.length > MAX_BYTES) {
      throw new BadRequestException(
        `File too large (${input.buffer.length} bytes, max ${MAX_BYTES})`,
      );
    }
    // Magic-byte: Content-Type beyanına güvenme — gövde imzası eşleşmeli.
    if (!matchesMagicBytes(input.buffer, mime)) {
      throw new BadRequestException('Dosya içeriği beyan edilen türle eşleşmiyor');
    }

    if (input.userId) {
      const user = await this.prisma.scoped.user.findFirst({
        where: { id: input.userId, deletedAt: null },
        select: { id: true },
      });
      if (!user) throw new NotFoundException('User not found');
    }
    if (input.doctorId) {
      const doctor = await this.prisma.scoped.doctor.findFirst({
        where: { id: input.doctorId, deletedAt: null },
        select: { id: true },
      });
      if (!doctor) throw new NotFoundException('Doctor not found');
    }

    const docId = crypto.randomUUID();
    const subjectId = input.userId ?? input.doctorId!;
    const fileKey = this.storage.buildScopedKey(tenantId, `staff/${subjectId}`, docId, mime);

    await this.storage.saveBuffer(fileKey, input.buffer);
    try {
      return await this.prisma.scoped.staffDocument.create({
        data: {
          id: docId,
          tenantId,
          userId: input.userId ?? null,
          doctorId: input.doctorId ?? null,
          docType: input.docType as StaffDocTypeValue,
          fileKey,
          fileName: input.fileName.slice(0, 255),
          mimeType: mime,
          sizeBytes: input.buffer.length,
          note: input.note ?? null,
          uploadedById: actor.id,
        },
        select: DOCUMENT_SELECT,
      });
    } catch (err) {
      await this.storage.remove(fileKey).catch(() => undefined);
      throw err;
    }
  }

  async list(query: StaffDocumentListQuery, actor: Actor): Promise<StaffDocumentDto[]> {
    const scope = await this.accessScope(actor);
    const where = {
      deletedAt: null,
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.doctorId ? { doctorId: query.doctorId } : {}),
      // Yetkisiz kullanıcı yalnız kendi dökümanlarını görür (özne olarak).
      ...(scope.all
        ? {}
        : {
            OR: [
              { userId: actor.id },
              ...(scope.ownDoctorId ? [{ doctorId: scope.ownDoctorId }] : []),
            ],
          }),
    };
    return this.prisma.scoped.staffDocument.findMany({
      where,
      select: DOCUMENT_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async serve(id: string, actor: Actor): Promise<StreamableFile> {
    const doc = await this.prisma.scoped.staffDocument.findFirst({
      where: { id, deletedAt: null },
      select: { fileKey: true, fileName: true, mimeType: true, userId: true, doctorId: true },
    });
    if (!doc) throw new NotFoundException('Document not found');

    const scope = await this.accessScope(actor);
    const isOwn =
      doc.userId === actor.id || (scope.ownDoctorId && doc.doctorId === scope.ownDoctorId);
    if (!scope.all && !isOwn) {
      throw new ForbiddenException('Bu dökümanı görüntüleme yetkiniz yok');
    }

    if (!(await this.storage.exists(doc.fileKey))) {
      throw new NotFoundException('Document file missing from storage');
    }
    return new StreamableFile(this.storage.readStream(doc.fileKey), {
      type: doc.mimeType,
      disposition: `attachment; filename="${encodeURIComponent(doc.fileName)}"`,
    });
  }

  async softDelete(id: string) {
    const doc = await this.prisma.scoped.staffDocument.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!doc) throw new NotFoundException('Document not found');
    await this.prisma.scoped.staffDocument.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { ok: true as const };
  }

  // view:staffDocument → tümü; değilse yalnız kendi (user öznesi + kendi
  // doktor profili öznesi).
  private async accessScope(actor: Actor): Promise<{ all: boolean; ownDoctorId: string | null }> {
    if (hasPermission(actor.roles, 'view:staffDocument', actor.effectivePerms)) {
      return { all: true, ownDoctorId: null };
    }
    const doctor = await this.prisma.scoped.doctor.findFirst({
      where: { userId: actor.id, deletedAt: null },
      select: { id: true },
    });
    return { all: false, ownDoctorId: doctor?.id ?? null };
  }
}
