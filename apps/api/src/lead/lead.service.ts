import { Injectable, NotFoundException } from '@nestjs/common';
import type { LeadSource, Prisma } from '@airmed/db';
import { PrismaService } from '../prisma/prisma.service';
import { LEAD_SOURCES } from '../patient/patient.schemas';
import type { LeadFunnelQuery, LeadListQuery, LeadSetSourceInput } from './lead.schemas';

type FunnelRow = {
  source: LeadSource | 'unset';
  leads: number;
  withAppointment: number;
  withExamination: number;
  withSurgery: number;
};

@Injectable()
export class LeadService {
  constructor(private readonly prisma: PrismaService) {}

  async funnel({ from, to }: LeadFunnelQuery): Promise<FunnelRow[]> {
    const where = this.dateWhere(from, to);
    const patients = await this.prisma.scoped.patient.findMany({
      where: { deletedAt: null, ...where },
      select: {
        id: true,
        leadSource: true,
        appointments: { select: { id: true }, take: 1 },
        examinations: { select: { id: true }, take: 1 },
        surgeries: { select: { id: true }, take: 1 },
      },
    });

    const buckets = new Map<LeadSource | 'unset', FunnelRow>();
    const init = (key: LeadSource | 'unset'): FunnelRow => ({
      source: key,
      leads: 0,
      withAppointment: 0,
      withExamination: 0,
      withSurgery: 0,
    });
    for (const s of LEAD_SOURCES) buckets.set(s, init(s));
    buckets.set('unset', init('unset'));

    for (const p of patients) {
      const key: LeadSource | 'unset' = p.leadSource ?? 'unset';
      const row = buckets.get(key) ?? init(key);
      row.leads += 1;
      if (p.appointments.length > 0) row.withAppointment += 1;
      if (p.examinations.length > 0) row.withExamination += 1;
      if (p.surgeries.length > 0) row.withSurgery += 1;
      buckets.set(key, row);
    }

    return Array.from(buckets.values()).filter((r) => r.leads > 0);
  }

  async list({ source, stage, from, to, page, pageSize }: LeadListQuery) {
    const dateWhere = this.dateWhere(from, to);
    const sourceFilter: Prisma.PatientWhereInput =
      source === null ? { leadSource: null } : source ? { leadSource: source } : {};
    const stageFilter: Prisma.PatientWhereInput = (() => {
      switch (stage) {
        case 'appointment':
          return { appointments: { some: {} } };
        case 'examination':
          return { examinations: { some: {} } };
        case 'surgery':
          return { surgeries: { some: { status: { not: 'refused' } } } };
        // S15-PR16 — refused stage: hasta cerrahi öneriyi reddetti.
        case 'surgery_refused':
          return { surgeries: { some: { status: 'refused' } } };
        default:
          return {};
      }
    })();

    const where: Prisma.PatientWhereInput = {
      deletedAt: null,
      ...dateWhere,
      ...sourceFilter,
      ...stageFilter,
    };

    const [items, total] = await Promise.all([
      this.prisma.scoped.patient.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          mrn: true,
          firstName: true,
          lastName: true,
          phone: true,
          leadSource: true,
          leadSourceNote: true,
          createdAt: true,
        },
      }),
      this.prisma.scoped.patient.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async setSource({ patientId, source, note }: LeadSetSourceInput) {
    const existing = await this.prisma.scoped.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Patient not found');

    return this.prisma.scoped.patient.update({
      where: { id: patientId },
      data: {
        leadSource: source,
        leadSourceNote: note ?? null,
      },
      select: { id: true, leadSource: true, leadSourceNote: true },
    });
  }

  private dateWhere(from?: string, to?: string): Prisma.PatientWhereInput {
    if (!from && !to) return {};
    const createdAt: Prisma.DateTimeFilter = {};
    if (from) createdAt.gte = new Date(`${from}T00:00:00.000Z`);
    if (to) createdAt.lte = new Date(`${to}T23:59:59.999Z`);
    return { createdAt };
  }
}
