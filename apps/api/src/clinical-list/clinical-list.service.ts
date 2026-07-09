import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { MedicationCreateInput, ProblemCreateInput } from './clinical-list.schemas';

// R1 (#723) — Kalıcı klinik problem + ilaç listesi servisi. RLS tenant-scoped
// (prisma.scoped); soft-delete; createdById audit. Problem 'active'→'resolved',
// ilaç 'active'→'stopped' (append-only mantığı; silme yalnız yanlış-giriş için).
@Injectable()
export class ClinicalListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ---- Problemler -----------------------------------------------------------

  listProblems(patientId: string) {
    return this.prisma.scoped.patientProblem.findMany({
      where: { patientId, deletedAt: null },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  createProblem(input: ProblemCreateInput, createdById: string) {
    const tenantId = this.tenantContext.requireTenantId();
    return this.prisma.scoped.patientProblem.create({
      data: {
        tenantId,
        patientId: input.patientId,
        description: input.description,
        icd10: input.icd10 ?? null,
        onsetDate: input.onsetDate ? new Date(input.onsetDate) : null,
        createdById,
      },
    });
  }

  async resolveProblem(id: string) {
    const existing = await this.prisma.scoped.patientProblem.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Problem bulunamadı');
    return this.prisma.scoped.patientProblem.update({
      where: { id },
      data: { status: 'resolved', resolvedAt: new Date() },
    });
  }

  async deleteProblem(id: string) {
    const existing = await this.prisma.scoped.patientProblem.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Problem bulunamadı');
    await this.prisma.scoped.patientProblem.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ---- İlaçlar ---------------------------------------------------------------

  listMedications(patientId: string) {
    return this.prisma.scoped.patientMedication.findMany({
      where: { patientId, deletedAt: null },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  createMedication(input: MedicationCreateInput, createdById: string) {
    const tenantId = this.tenantContext.requireTenantId();
    return this.prisma.scoped.patientMedication.create({
      data: {
        tenantId,
        patientId: input.patientId,
        name: input.name,
        dose: input.dose ?? null,
        frequency: input.frequency ?? null,
        startedAt: input.startedAt ? new Date(input.startedAt) : null,
        createdById,
      },
    });
  }

  async stopMedication(id: string) {
    const existing = await this.prisma.scoped.patientMedication.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('İlaç kaydı bulunamadı');
    return this.prisma.scoped.patientMedication.update({
      where: { id },
      data: { status: 'stopped', stoppedAt: new Date() },
    });
  }

  async deleteMedication(id: string) {
    const existing = await this.prisma.scoped.patientMedication.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('İlaç kaydı bulunamadı');
    await this.prisma.scoped.patientMedication.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
