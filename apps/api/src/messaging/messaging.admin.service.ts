import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { MessagingService } from './messaging.service';
import type {
  AdminTemplateUpdateInput,
  AdminTriggerConfigInput,
  AdminTriggerListQuery,
  AdminTemplateListQuery,
  AdminDeliveryListQuery,
} from './messaging.admin.schemas';

// D1 PR 3 — Admin-facing read/update operations for messaging config.
//
// Yetki kuralı: yalnızca yonetici + yonetici_asistani template/trigger
// düzenleyebilir; listeleme + delivery audit tüm klinik personeline açık
// (kişisel mesaj geçmişi PII; recipient field hassas — RLS scoped query).
//
// Mandatory triggers (`is_mandatory=true`) için isEnabled=false set
// edilemez (UI'da disabled görünür; backend de korur).

interface Actor {
  id: string;
  roles: readonly string[];
}

const MANAGER_ROLES = ['yonetici', 'yonetici_asistani'];

@Injectable()
export class MessagingAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly messaging: MessagingService,
  ) {}

  // ---------- Triggers ----------

  async listTriggers({ category }: AdminTriggerListQuery) {
    const tenantId = this.tenantContext.requireTenantId();
    await this.messaging.ensureDefaults(tenantId);
    return this.prisma.scoped.messageTrigger.findMany({
      where: { ...(category ? { category } : {}) },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async updateTriggerConfig(input: AdminTriggerConfigInput, actor: Actor) {
    this.assertManager(actor);
    const trigger = await this.prisma.scoped.messageTrigger.findFirst({
      where: { id: input.id },
    });
    if (!trigger) throw new NotFoundException('Trigger not found');

    if (trigger.isMandatory && input.isEnabled === false) {
      throw new BadRequestException('Bu trigger zorunludur (komplikasyon vb.) ve kapatılamaz');
    }
    // Quiet hours sanity: 0..23
    if (
      input.quietHoursStart != null &&
      (input.quietHoursStart < 0 || input.quietHoursStart > 23)
    ) {
      throw new BadRequestException('quietHoursStart 0-23 aralığında olmalı');
    }
    if (input.quietHoursEnd != null && (input.quietHoursEnd < 0 || input.quietHoursEnd > 23)) {
      throw new BadRequestException('quietHoursEnd 0-23 aralığında olmalı');
    }
    return this.prisma.scoped.messageTrigger.update({
      where: { id: input.id },
      data: {
        ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
        ...(input.channels !== undefined ? { channels: input.channels } : {}),
        ...(input.quietHoursStart !== undefined ? { quietHoursStart: input.quietHoursStart } : {}),
        ...(input.quietHoursEnd !== undefined ? { quietHoursEnd: input.quietHoursEnd } : {}),
      },
    });
  }

  // ---------- Templates ----------

  async listTemplates({ triggerKey, language, channelType }: AdminTemplateListQuery) {
    const tenantId = this.tenantContext.requireTenantId();
    await this.messaging.ensureDefaults(tenantId);
    return this.prisma.scoped.messageTemplate.findMany({
      where: {
        deletedAt: null,
        ...(triggerKey ? { triggerKey } : {}),
        ...(language ? { language } : {}),
        ...(channelType ? { channelType } : {}),
      },
      orderBy: [{ triggerKey: 'asc' }, { language: 'asc' }, { channelType: 'asc' }],
    });
  }

  async updateTemplate(input: AdminTemplateUpdateInput, actor: Actor) {
    this.assertManager(actor);
    const tpl = await this.prisma.scoped.messageTemplate.findFirst({
      where: { id: input.id, deletedAt: null },
    });
    if (!tpl) throw new NotFoundException('Template not found');
    return this.prisma.scoped.messageTemplate.update({
      where: { id: input.id },
      data: {
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
  }

  // ---------- Deliveries (audit / list) ----------

  async listDeliveries({
    triggerKey,
    status,
    recipient,
    dateFrom,
    dateTo,
    page,
    pageSize,
  }: AdminDeliveryListQuery) {
    const where = {
      ...(triggerKey ? { triggerKey } : {}),
      ...(status ? { status } : {}),
      ...(recipient ? { recipient: { contains: recipient } } : {}),
      ...(dateFrom || dateTo
        ? {
            scheduledAt: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lt: new Date(dateTo) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.scoped.messageDelivery.findMany({
        where,
        orderBy: { scheduledAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scoped.messageDelivery.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async listByPatient(patientId: string) {
    // Hasta detay sayfası mesajlar sekmesi — hastanın phone field'ından match.
    const patient = await this.prisma.scoped.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { phone: true },
    });
    if (!patient?.phone) return [];
    return this.prisma.scoped.messageDelivery.findMany({
      where: { recipient: patient.phone },
      orderBy: { scheduledAt: 'desc' },
      take: 100,
    });
  }

  private assertManager(actor: Actor) {
    if (!actor.roles.some((r) => MANAGER_ROLES.includes(r))) {
      throw new ForbiddenException('Yalnızca yönetici düzenleyebilir');
    }
  }
}
