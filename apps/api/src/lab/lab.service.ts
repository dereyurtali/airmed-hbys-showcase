import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  type StreamableFile,
} from '@nestjs/common';
import { StreamableFile as NestStreamableFile } from '@nestjs/common';
import type { Prisma } from '@airmed/db';
import { InvoiceService } from '../billing/invoice.service';
import { CommissionService } from '../commission/commission.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { StorageService } from '../storage/storage.service';
import { LabTestCreateInput, LabTestListQuery, LabTestUpdateInput } from './lab.schemas';

// B2 Tetkik servisi.
//
// Yetki kuralı (A7/A8/A9 paritesinde):
// - Create: doktor/yonetici/yönetici_asistani/hemsire/resepsiyon (klinik personeli)
// - Update / soft-delete: yonetici her zaman override; aksi halde sadece
//   `createdById === actor.id` + 24 saatlik pencere
// - createdById null (sistem/import) → sadece yonetici düzenleyebilir
//
// External tetkikte dosya: REST `/api/lab-tests/upload-file` ile multipart;
// PDF + image MIME'leri kabul edilir, max 25MB (photo'dan daha cömert,
// klinik dış raporlar büyük olabilir).

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_FILE_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);
const SAME_DAY_WINDOW_HOURS = 24;

interface Actor {
  id: string;
  roles: readonly string[];
}

interface AttachFileInput {
  id: string;
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

@Injectable()
export class LabService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly storage: StorageService,
    // S12b — müşteri görüşmesi sonrası: lab başına otomatik hakediş
    private readonly commission: CommissionService,
    // S12c — "Önce öde sonra hizmet" sıkı engel
    private readonly invoice: InvoiceService,
  ) {}

  async create(input: LabTestCreateInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    await this.assertPatient(input.patientId);
    // S12c — müşteri görüşmesi karar 3: lab tetkiki açılmadan önce bugün
    // bu hasta için lab kategorisinde ödenmiş invoice olmalı.
    await this.invoice.assertPaidSession(input.patientId, 'lab');

    const created = await this.prisma.scoped.labTest.create({
      data: {
        tenantId,
        patientId: input.patientId,
        source: input.source,
        testType: input.testType as Prisma.LabTestCreateInput['testType'],
        performedAt: new Date(input.performedAt),
        results: (input.results ?? {}) as Prisma.InputJsonValue,
        notes: input.notes ?? null,
        externalLab: input.externalLab ?? null,
        createdById: actor.id,
      },
    });

    // S12b — Hakediş eşleme: actor doktor profilinde varsa hesaplanır.
    // Delta audit C-9: yalnız actor doktorsa komisyon yazılır; primary doctor
    // fallback'i yanlış hakediş ürettiği için kaldırıldı.
    const doctorProfile = await this.findDoctorForCommission(actor.id);
    if (doctorProfile) {
      const baseAmount = await this.lookupLabBaseAmount();
      await this.commission.tryAutoCalculate({
        sourceType: 'lab',
        sourceId: created.id,
        doctorId: doctorProfile.id,
        baseAmount,
      });
    }

    return created;
  }

  /**
   * S12b — Hakediş için doktor seçimi: SADECE actor user kendi doktor profile'ı
   * varsa o doktora yazılır. Delta audit C-9: patient primary doctor fallback'i
   * KALDIRILDI — yanlış hakediş üretiyordu (lab kaydını resepsiyon/hemşire
   * giriyorsa, başka bir doktorun hesabına hakediş yazılıyordu). Doktor olmayan
   * actor'lar için komisyon hesabı yapılmaz.
   *
   * Not: Uzun vade — `LabTest.requestedById` zorunlu hale getirilirse fallback'a
   * gerek kalmaz (P2 migration).
   */
  private async findDoctorForCommission(actorUserId: string): Promise<{ id: string } | null> {
    const ownDoctor = await this.prisma.scoped.doctor.findFirst({
      where: { userId: actorUserId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    return ownDoctor ?? null;
  }

  private async lookupLabBaseAmount(): Promise<string> {
    const item = await this.prisma.scoped.serviceItem.findFirst({
      where: { category: 'lab', isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { defaultPrice: 'desc' }],
      select: { defaultPrice: true },
    });
    return item?.defaultPrice.toString() ?? '0';
  }

  async list({ patientId, testType, source, page, pageSize }: LabTestListQuery) {
    const where: Prisma.LabTestWhereInput = {
      deletedAt: null,
      ...(patientId ? { patientId } : {}),
      ...(testType ? { testType: testType as Prisma.LabTestWhereInput['testType'] } : {}),
      ...(source ? { source } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.scoped.labTest.findMany({
        where,
        orderBy: { performedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          createdBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.scoped.labTest.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async listByPatient(patientId: string) {
    return this.prisma.scoped.labTest.findMany({
      where: { patientId, deletedAt: null },
      orderBy: { performedAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  async findById(id: string) {
    const test = await this.prisma.scoped.labTest.findFirst({
      where: { id, deletedAt: null },
      include: {
        patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!test) throw new NotFoundException('Lab test not found');
    return test;
  }

  async update(id: string, input: LabTestUpdateInput, actor: Actor) {
    const current = await this.findById(id);
    this.assertEditAllowed(current.createdAt, current.createdById, actor);

    const data: Prisma.LabTestUpdateInput = {};
    if (input.testType !== undefined) {
      data.testType = input.testType as Prisma.LabTestUpdateInput['testType'];
    }
    if (input.performedAt !== undefined) data.performedAt = new Date(input.performedAt);
    if (input.results !== undefined) data.results = input.results as Prisma.InputJsonValue;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.externalLab !== undefined) data.externalLab = input.externalLab;

    return this.prisma.scoped.labTest.update({ where: { id }, data });
  }

  async softDelete(id: string, actor: Actor) {
    const current = await this.findById(id);
    this.assertEditAllowed(current.createdAt, current.createdById, actor);
    await this.prisma.scoped.labTest.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async attachFile(input: AttachFileInput, actor: Actor) {
    const current = await this.findById(input.id);
    this.assertEditAllowed(current.createdAt, current.createdById, actor);

    if (current.source !== 'external') {
      throw new BadRequestException('Files can only be attached to external lab tests');
    }
    if (!ALLOWED_FILE_MIMES.has(input.mimeType.toLowerCase())) {
      throw new BadRequestException(`Unsupported mime type: ${input.mimeType}`);
    }
    if (input.buffer.length > MAX_FILE_BYTES) {
      throw new BadRequestException(
        `File too large (${input.buffer.length} bytes, max ${MAX_FILE_BYTES})`,
      );
    }

    const tenantId = this.tenantContext.requireTenantId();
    const fileKey = this.storage.buildKey(
      `${tenantId}/lab-tests`,
      current.patientId,
      current.id,
      input.mimeType,
    );

    await this.storage.saveBuffer(fileKey, input.buffer);

    try {
      return await this.prisma.scoped.labTest.update({
        where: { id: current.id },
        data: {
          fileKey,
          fileName: input.fileName.slice(0, 255),
          fileMimeType: input.mimeType,
          fileSizeBytes: input.buffer.length,
        },
      });
    } catch (err) {
      await this.storage.remove(fileKey).catch(() => undefined);
      throw err;
    }
  }

  async serveFile(id: string): Promise<StreamableFile> {
    const test = await this.findById(id);
    if (!test.fileKey || !test.fileMimeType) {
      throw new NotFoundException('No file attached');
    }
    if (!(await this.storage.exists(test.fileKey))) {
      throw new NotFoundException('Lab test file missing on disk');
    }
    const stream = this.storage.readStream(test.fileKey);
    return new NestStreamableFile(stream, {
      type: test.fileMimeType,
      disposition: `inline; filename="${encodeURIComponent(test.fileName ?? 'lab-test.bin')}"`,
    });
  }

  private assertEditAllowed(createdAt: Date, ownerUserId: string | null, actor: Actor): void {
    const isAdmin = actor.roles.includes('yonetici');
    if (isAdmin) return;
    if (!ownerUserId) {
      throw new ForbiddenException('System-imported lab tests can only be edited by yonetici');
    }
    if (actor.id !== ownerUserId) {
      throw new ForbiddenException('Only the recording user or yonetici can edit this lab test');
    }
    const hoursElapsed = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursElapsed > SAME_DAY_WINDOW_HOURS) {
      throw new BadRequestException('Same-day edit window expired');
    }
  }

  private async assertPatient(patientId: string): Promise<void> {
    const patient = await this.prisma.scoped.patient.findFirst({
      where: { id: patientId, deletedAt: null },
    });
    if (!patient) throw new NotFoundException('Patient not found');
  }
}
