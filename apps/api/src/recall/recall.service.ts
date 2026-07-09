import { Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { SURGERY_REF_TAG } from '../post-op/post-op.schemas';

// S15-PR20 — Recall (post-op kayıp takip) service. Post-op kontrol kaçıran
// veya yaklaşan hastaları listeler + telefon/SMS deneme audit'i tutar.

export const recallListQuerySchema = z.object({
  bucket: z.enum(['missed', 'today', 'next7days']).default('missed'),
  // Delta audit C-16: take 100 hardcoded değil; pilot trafikte 100 üstüne çıkabilir.
  // Klinik ekranda kullanıcı "daha fazla göster" ile yüksek limit alabilir; hard cap 500.
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type RecallListQuery = z.infer<typeof recallListQuerySchema>;

export const recallAttemptCreateSchema = z.object({
  appointmentId: z.string().uuid(),
  method: z.enum(['sms', 'phone', 'email']),
  result: z.enum(['reached', 'no_answer', 'rescheduled', 'voicemail', 'wrong_number']),
  notes: z.string().max(500).optional().nullable(),
});
export type RecallAttemptCreateInput = z.infer<typeof recallAttemptCreateSchema>;

interface Actor {
  id: string;
}

@Injectable()
export class RecallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async listForBucket(query: RecallListQuery) {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);
    const sevenDays = new Date(todayStart);
    sevenDays.setDate(sevenDays.getDate() + 7);

    let range: { gte?: Date; lt?: Date } = {};
    let statuses: ('scheduled' | 'no_show')[] = ['scheduled', 'no_show'];

    if (query.bucket === 'missed') {
      // Kaçırılan: post-op kontrolü (type=control + #surgery: tag), status
      // 'scheduled' veya 'no_show', startsAt < now
      range = { lt: now };
    } else if (query.bucket === 'today') {
      range = { gte: todayStart, lt: todayEnd };
      statuses = ['scheduled'];
    } else if (query.bucket === 'next7days') {
      range = { gte: todayEnd, lt: sevenDays };
      statuses = ['scheduled'];
    }

    return this.prisma.scoped.appointment.findMany({
      where: {
        // Post-op kontrolleri normal kontrollerden #surgery: tag'i ile ayrılır
        // (post-op.service control + tag üretir); recall yalnız bunları kovalar.
        type: 'control',
        notes: { contains: SURGERY_REF_TAG },
        deletedAt: null,
        startsAt: range,
        status: { in: statuses },
      },
      include: {
        patient: { select: { id: true, mrn: true, firstName: true, lastName: true, phone: true } },
        doctor: {
          select: {
            id: true,
            user: { select: { name: true } },
          },
        },
        recallAttempts: {
          select: {
            id: true,
            method: true,
            result: true,
            attemptedAt: true,
            attemptedBy: { select: { name: true } },
          },
          orderBy: { attemptedAt: 'desc' },
          take: 3,
        },
      },
      orderBy: { startsAt: 'asc' },
      take: query.limit,
    });
  }

  async logAttempt(input: RecallAttemptCreateInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    const appt = await this.prisma.scoped.appointment.findFirst({
      where: { id: input.appointmentId, deletedAt: null },
      select: { id: true, patientId: true },
    });
    if (!appt) throw new NotFoundException('Randevu bulunamadı');

    return this.prisma.scoped.recallAttempt.create({
      data: {
        tenantId,
        appointmentId: input.appointmentId,
        patientId: appt.patientId,
        method: input.method,
        result: input.result,
        notes: input.notes ?? null,
        attemptedById: actor.id,
      },
      include: {
        attemptedBy: { select: { id: true, name: true } },
      },
    });
  }
}
