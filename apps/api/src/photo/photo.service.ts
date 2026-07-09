import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  type StreamableFile,
} from '@nestjs/common';
import { StreamableFile as NestStreamableFile } from '@nestjs/common';
import type { Prisma } from '@airmed/db';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { StorageService } from '../storage/storage.service';
import { PhotoListQuery, PhotoUpdateInput } from './photo.schemas';

// C3 patient photo servisi.
//
// Yetki kuralı:
// - Upload + list: doktor, hemşire, yönetici, yönetici_asistani, resepsiyon
//   (klinik personeli, herhangi bir hasta için)
// - Düzenleme / soft-delete: yonetici override; aksi halde sadece yükleyen
//   personel (uploadedById === actor.id) düzenleyebilir
// - Resepsiyon foto silebilir mi? Hayır — sadece yükleyen + admin
//
// Storage: local disk via StorageService (S3 swap-out hazır).
// Soft-delete: deletedAt; dosya hard-delete edilmez (audit/recovery için)
// — opsiyonel periyodik cleanup ileri faza.

const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  // #426 — Cihaz çıktısı (biyometri/OCT yazıcı PDF'i) iliştirme MVP.
  'application/pdf',
]);

interface Actor {
  id: string;
  roles: readonly string[];
}

interface UploadInput {
  patientId: string;
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  tag: string;
  description?: string | null;
  takenAt?: string | null;
}

@Injectable()
export class PhotoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly storage: StorageService,
  ) {}

  async upload(input: UploadInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();

    if (!ALLOWED_MIMES.has(input.mimeType.toLowerCase())) {
      throw new BadRequestException(`Unsupported mime type: ${input.mimeType}`);
    }
    if (input.buffer.length > MAX_BYTES) {
      throw new BadRequestException(
        `File too large (${input.buffer.length} bytes, max ${MAX_BYTES})`,
      );
    }

    await this.assertPatient(input.patientId);

    // Create DB row first (generates id), then write file with that id.
    const photoId = crypto.randomUUID();
    const fileKey = this.storage.buildKey(tenantId, input.patientId, photoId, input.mimeType);

    await this.storage.saveBuffer(fileKey, input.buffer);

    try {
      return await this.prisma.scoped.patientPhoto.create({
        data: {
          id: photoId,
          tenantId,
          patientId: input.patientId,
          uploadedById: actor.id,
          tag: input.tag as Prisma.PatientPhotoCreateInput['tag'],
          description: input.description ?? null,
          fileName: input.fileName.slice(0, 255),
          fileKey,
          mimeType: input.mimeType,
          sizeBytes: input.buffer.length,
          takenAt: input.takenAt ? new Date(input.takenAt) : null,
        },
      });
    } catch (err) {
      // DB insert failed → clean up the orphan file.
      await this.storage.remove(fileKey).catch(() => undefined);
      throw err;
    }
  }

  async list({ patientId, tag, page, pageSize }: PhotoListQuery) {
    const where: Prisma.PatientPhotoWhereInput = {
      deletedAt: null,
      ...(patientId ? { patientId } : {}),
      ...(tag ? { tag } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.scoped.patientPhoto.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          uploadedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.scoped.patientPhoto.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async listByPatient(patientId: string) {
    return this.prisma.scoped.patientPhoto.findMany({
      where: { patientId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        uploadedBy: { select: { id: true, name: true } },
      },
    });
  }

  async findById(id: string) {
    const photo = await this.prisma.scoped.patientPhoto.findFirst({
      where: { id, deletedAt: null },
      include: {
        patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
        uploadedBy: { select: { id: true, name: true } },
      },
    });
    if (!photo) throw new NotFoundException('Photo not found');
    return photo;
  }

  async serve(id: string): Promise<StreamableFile> {
    const photo = await this.findById(id);
    if (!(await this.storage.exists(photo.fileKey))) {
      throw new NotFoundException('Photo file missing on disk');
    }
    const stream = this.storage.readStream(photo.fileKey);
    return new NestStreamableFile(stream, {
      type: photo.mimeType,
      disposition: `inline; filename="${encodeURIComponent(photo.fileName)}"`,
    });
  }

  async update(id: string, input: PhotoUpdateInput, actor: Actor) {
    const current = await this.findById(id);
    this.assertEditAllowed(current.uploadedById, actor);

    const data: Prisma.PatientPhotoUpdateInput = {};
    if (input.tag !== undefined) {
      data.tag = input.tag as Prisma.PatientPhotoUpdateInput['tag'];
    }
    if (input.description !== undefined) data.description = input.description;
    if (input.takenAt !== undefined) {
      data.takenAt = input.takenAt ? new Date(input.takenAt) : null;
    }
    return this.prisma.scoped.patientPhoto.update({ where: { id }, data });
  }

  async softDelete(id: string, actor: Actor) {
    const current = await this.findById(id);
    this.assertEditAllowed(current.uploadedById, actor);
    await this.prisma.scoped.patientPhoto.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private assertEditAllowed(ownerUserId: string | null, actor: Actor): void {
    const isAdmin = actor.roles.includes('yonetici');
    if (isAdmin) return;
    if (!ownerUserId || actor.id !== ownerUserId) {
      throw new ForbiddenException('Only the uploading user or yonetici can edit this photo');
    }
  }

  private async assertPatient(patientId: string): Promise<void> {
    const patient = await this.prisma.scoped.patient.findFirst({
      where: { id: patientId, deletedAt: null },
    });
    if (!patient) throw new NotFoundException('Patient not found');
  }
}
