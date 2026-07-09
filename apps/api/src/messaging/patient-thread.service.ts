import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

// S15-PR19 — Klinik personeli arası bağlamsal mesajlaşma (hasta-bağlı thread).
// Hasta GÖRMEZ; iç komünikasyon. Worklist hasta kartına gömülü panel ile
// kullanılır (PatientMessageThread.tsx).

export const createThreadSchema = z.object({
  patientId: z.string().uuid(),
  subject: z.string().trim().min(1).max(200).optional().nullable(),
  initialMessage: z.string().trim().min(1).max(4000),
});
export type CreateThreadInput = z.infer<typeof createThreadSchema>;

export const sendThreadMessageSchema = z.object({
  threadId: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
});
export type SendThreadMessageInput = z.infer<typeof sendThreadMessageSchema>;

interface Actor {
  id: string;
}

@Injectable()
export class PatientThreadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async listForPatient(patientId: string) {
    return this.prisma.scoped.patientMessageThread.findMany({
      where: { patientId, deletedAt: null, isArchived: false },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true } },
        _count: { select: { messages: { where: { deletedAt: null } } } },
      },
    });
  }

  async listMessages(threadId: string) {
    const thread = await this.prisma.scoped.patientMessageThread.findFirst({
      where: { id: threadId, deletedAt: null },
    });
    if (!thread) throw new NotFoundException('Thread not found');
    return this.prisma.scoped.patientThreadMessage.findMany({
      where: { threadId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, name: true } } },
    });
  }

  async createThread(input: CreateThreadInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    const patient = await this.prisma.scoped.patient.findFirst({
      where: { id: input.patientId, deletedAt: null },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException('Hasta bulunamadı');

    const thread = await this.prisma.scoped.patientMessageThread.create({
      data: {
        tenantId,
        patientId: input.patientId,
        subject: input.subject ?? null,
        createdById: actor.id,
        lastMessageAt: new Date(),
      },
    });

    await this.prisma.scoped.patientThreadMessage.create({
      data: {
        tenantId,
        threadId: thread.id,
        authorId: actor.id,
        body: input.initialMessage,
      },
    });

    return thread;
  }

  async sendMessage(input: SendThreadMessageInput, actor: Actor) {
    const tenantId = this.tenantContext.requireTenantId();
    const thread = await this.prisma.scoped.patientMessageThread.findFirst({
      where: { id: input.threadId, deletedAt: null },
    });
    if (!thread) throw new NotFoundException('Thread not found');
    if (thread.isArchived) {
      throw new BadRequestException("Arşivlenmiş thread'e mesaj eklenemez");
    }

    const now = new Date();
    const [message] = await this.prisma.$transaction([
      this.prisma.scoped.patientThreadMessage.create({
        data: {
          tenantId,
          threadId: input.threadId,
          authorId: actor.id,
          body: input.body,
        },
        include: { author: { select: { id: true, name: true } } },
      }),
      this.prisma.scoped.patientMessageThread.update({
        where: { id: input.threadId },
        data: { lastMessageAt: now },
      }),
    ]);

    return message;
  }

  async archive(threadId: string) {
    const thread = await this.prisma.scoped.patientMessageThread.findFirst({
      where: { id: threadId, deletedAt: null },
    });
    if (!thread) throw new NotFoundException('Thread not found');
    return this.prisma.scoped.patientMessageThread.update({
      where: { id: threadId },
      data: { isArchived: true },
    });
  }
}
