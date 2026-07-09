import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@airmed/db';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import {
  PrescriptionCreateInput,
  PrescriptionListQuery,
  PrescriptionUpdateInput,
  SupplierCreateInput,
  SupplierListQuery,
  SupplierUpdateInput,
} from './pharmacy.schemas';

// E3 Eczane / Optikçi servisi.
//
// Yetki:
// - Supplier CRUD: yonetici + yonetici_asistani
// - Prescription create/update/softDelete: doktor + yonetici/yonetici_asistani
// - send: kayıt sahibi veya yonetici
// - list/findById (her ikisi): tüm klinik personeli
//
// "send" v1'de: sadece sentAt timestamp + audit log. Fax/email transport yok.
// Klinik QR'ı tarayıp dış sisteme iletecek (frontend qrcode lib).

interface Actor {
  id: string;
  roles: readonly string[];
}

@Injectable()
export class PharmacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // -------------------- Suppliers --------------------

  async listSuppliers({ category, includeInactive, search }: SupplierListQuery) {
    const where: Prisma.SupplierWhereInput = {
      deletedAt: null,
      ...(category ? { category } : {}),
      ...(includeInactive ? {} : { isActive: true }),
      ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
    };
    return this.prisma.scoped.supplier.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async findSupplierById(id: string) {
    const s = await this.prisma.scoped.supplier.findFirst({
      where: { id, deletedAt: null },
    });
    if (!s) throw new NotFoundException('Supplier not found');
    return s;
  }

  async createSupplier(input: SupplierCreateInput, actor: Actor) {
    this.assertManager(actor);
    const tenantId = this.tenantContext.requireTenantId();
    return this.prisma.scoped.supplier.create({
      data: {
        tenantId,
        name: input.name.trim(),
        category: input.category,
        contactPhone: input.contactPhone ?? null,
        contactEmail: input.contactEmail ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
      },
    });
  }

  async updateSupplier(id: string, input: SupplierUpdateInput, actor: Actor) {
    this.assertManager(actor);
    await this.findSupplierById(id);
    return this.prisma.scoped.supplier.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
        ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
  }

  async softDeleteSupplier(id: string, actor: Actor) {
    this.assertManager(actor);
    const supplier = await this.findSupplierById(id);

    // Henüz gönderilmemiş reçete varsa engelle.
    const pendingRx = await this.prisma.scoped.prescription.count({
      where: { supplierId: supplier.id, sentAt: null, deletedAt: null },
    });
    if (pendingRx > 0) {
      throw new ConflictException('Supplier has pending prescriptions; resolve them first');
    }

    await this.prisma.scoped.supplier.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  // -------------------- Prescriptions --------------------

  async listPrescriptions({ patientId, type, sentOnly }: PrescriptionListQuery) {
    const where: Prisma.PrescriptionWhereInput = {
      deletedAt: null,
      ...(patientId ? { patientId } : {}),
      ...(type ? { type } : {}),
      ...(sentOnly !== undefined ? (sentOnly ? { sentAt: { not: null } } : { sentAt: null }) : {}),
    };
    return this.prisma.scoped.prescription.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        supplier: { select: { id: true, name: true, category: true } },
        createdBy: { select: { id: true, name: true } },
      },
      // #1064 — filtre verilmezse tüm reçeteler + include sınırsız büyürdü.
      take: 200,
    });
  }

  async findPrescriptionById(id: string) {
    const rx = await this.prisma.scoped.prescription.findFirst({
      where: { id, deletedAt: null },
      include: {
        patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
        supplier: { select: { id: true, name: true, category: true, contactPhone: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!rx) throw new NotFoundException('Prescription not found');
    return rx;
  }

  async createPrescription(input: PrescriptionCreateInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    await this.assertPatient(input.patientId);

    if (input.supplierId) {
      const supplier = await this.prisma.scoped.supplier.findFirst({
        where: { id: input.supplierId, deletedAt: null, isActive: true },
      });
      if (!supplier) {
        throw new BadRequestException('Supplier not found or inactive');
      }
      // Kategori-tip uyumu opsiyonel zorla — drug → pharmacy/other, eyewear → optic/other
      if (
        (input.type === 'drug' && supplier.category === 'optic') ||
        (input.type === 'eyewear' && supplier.category === 'pharmacy')
      ) {
        throw new BadRequestException('Supplier category does not match prescription type');
      }
    }

    return this.prisma.scoped.prescription.create({
      data: {
        tenantId,
        patientId: input.patientId,
        type: input.type,
        supplierId: input.supplierId ?? null,
        items: input.items as Prisma.InputJsonValue,
        notes: input.notes ?? null,
        createdById: actor.id,
      },
    });
  }

  async updatePrescription(id: string, input: PrescriptionUpdateInput, actor: Actor) {
    const current = await this.findPrescriptionById(id);
    this.assertOwner(current.createdById, actor);

    if (current.sentAt) {
      throw new BadRequestException('Cannot edit sent prescription');
    }

    return this.prisma.scoped.prescription.update({
      where: { id },
      data: {
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.supplierId !== undefined ? { supplierId: input.supplierId } : {}),
        ...(input.items !== undefined ? { items: input.items as Prisma.InputJsonValue } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });
  }

  async softDeletePrescription(id: string, actor: Actor) {
    const current = await this.findPrescriptionById(id);
    this.assertOwner(current.createdById, actor);
    await this.prisma.scoped.prescription.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async sendPrescription(id: string, actor: Actor) {
    const current = await this.findPrescriptionById(id);
    this.assertOwner(current.createdById, actor);
    if (current.sentAt) {
      throw new ConflictException('Prescription already sent');
    }
    if (!current.supplierId) {
      throw new BadRequestException('Cannot send: no supplier selected');
    }
    return this.prisma.scoped.prescription.update({
      where: { id },
      data: { sentAt: new Date() },
      include: {
        supplier: { select: { id: true, name: true, category: true } },
      },
    });
  }

  // #712 — Reçeteyi İÇ eczane POS kuyruğuna gönder. sendPrescription (dış
  // tedarikçi + QR, supplierId zorunlu) ile aynı `sentAt` damgasını kullanır ama
  // hedef farklı: supplierId NULL kalır → PharmacyRetailService.listDispensable-
  // Prescriptions bunu `supplierId: null` ile yakalar, dış siparişlerle karışmaz.
  // Yalnız ilaç reçetesi; tedarikçiye atanmış reçete iç eczaneye gönderilemez.
  async dispenseToPharmacy(id: string, actor: Actor) {
    const current = await this.findPrescriptionById(id);
    this.assertOwner(current.createdById, actor);
    if (current.type !== 'drug') {
      throw new BadRequestException('Only drug prescriptions can be dispensed in-house');
    }
    if (current.supplierId) {
      throw new BadRequestException(
        'Prescription is assigned to an external supplier; cannot dispense in-house',
      );
    }
    if (current.sentAt) {
      throw new ConflictException('Prescription already sent');
    }
    return this.prisma.scoped.prescription.update({
      where: { id },
      data: { sentAt: new Date() },
    });
  }

  // -------------------- helpers --------------------

  private assertManager(actor: Actor): void {
    const allowed = actor.roles.some((r) => r === 'yonetici' || r === 'yonetici_asistani');
    if (!allowed) {
      throw new ForbiddenException('Only yonetici or yonetici_asistani can manage suppliers');
    }
  }

  private assertOwner(ownerUserId: string | null, actor: Actor): void {
    const isAdmin = actor.roles.some((r) => r === 'yonetici' || r === 'yonetici_asistani');
    if (isAdmin) return;
    if (!ownerUserId) {
      throw new ForbiddenException('System-imported prescriptions can only be edited by yonetici');
    }
    if (actor.id !== ownerUserId) {
      throw new ForbiddenException('Only the prescriber or yonetici can edit this prescription');
    }
  }

  private async assertPatient(patientId: string): Promise<void> {
    const patient = await this.prisma.scoped.patient.findFirst({
      where: { id: patientId, deletedAt: null },
    });
    if (!patient) throw new NotFoundException('Patient not found');
  }
}
