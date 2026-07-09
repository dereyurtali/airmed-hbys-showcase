import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { NotificationType, RoleKey } from '@airmed/db';
import { PrismaService } from '../prisma/prisma.service';
import { SyncGateway } from '../sync/sync.gateway';
import { TenantContextService } from '../tenant/tenant-context.service';
import type { NotificationListQuery } from './notification.schemas';

// S15b — Notification (uygulama-içi bildirim / inbox).
//
// create() satır insert eder VE SyncGateway üzerinden tenant room'a yayar
// (real-time "düşme"). Kullanıcı-içi scope (recipientUserId) servis katmanında;
// RLS tenant sınırını korur. İstasyon servisleri (encounter/measurement/surgery)
// bu servisi çağırarak rol/kişi bildirimleri üretir.

export interface CreateNotificationInput {
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  payload?: Prisma.InputJsonValue;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly gateway: SyncGateway,
  ) {}

  async create(input: CreateNotificationInput) {
    const tenantId = this.tenantContext.requireTenantId();
    const created = await this.prisma.scoped.notification.create({
      data: {
        tenantId,
        recipientUserId: input.recipientUserId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        payload: input.payload ?? {},
      },
    });

    // Real-time push — best-effort, broadcast düşse de kalıcı kayıt durur.
    try {
      this.gateway.broadcastNotification({
        tenantId,
        recipientUserId: created.recipientUserId,
        notification: {
          id: created.id,
          type: created.type,
          title: created.title,
          body: created.body,
          payload: created.payload,
          readAt: created.readAt ? created.readAt.toISOString() : null,
          createdAt: created.createdAt.toISOString(),
        },
      });
    } catch (err) {
      this.logger.warn(`notification broadcast failed for ${created.id}: ${asMsg(err)}`);
    }

    return created;
  }

  /** Birden çok alıcıya aynı bildirim (örn. tüm ameliyat_satis kullanıcıları). */
  async createForUsers(
    recipientUserIds: readonly string[],
    input: Omit<CreateNotificationInput, 'recipientUserId'>,
  ) {
    const results = [];
    for (const recipientUserId of recipientUserIds) {
      results.push(await this.create({ ...input, recipientUserId }));
    }
    return results;
  }

  /**
   * Bir role sahip tüm (silinmemiş) kullanıcılara bildirim (örn. hemşire ölçüm
   * birimi, resepsiyon kasa, ameliyat_satis devir). İstasyon servisleri kullanır.
   */
  async createForRole(roleKey: string, input: Omit<CreateNotificationInput, 'recipientUserId'>) {
    const users = await this.prisma.scoped.user.findMany({
      where: { deletedAt: null, userRoles: { some: { role: { key: roleKey as RoleKey } } } },
      select: { id: true },
    });
    return this.createForUsers(
      users.map((u) => u.id),
      input,
    );
  }

  listForUser(userId: string, query: NotificationListQuery) {
    return this.prisma.scoped.notification.findMany({
      where: {
        recipientUserId: userId,
        ...(query.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.scoped.notification.count({
      where: { recipientUserId: userId, readAt: null },
    });
  }

  async markRead(id: string, userId: string) {
    // Sahiplik kontrolü: yalnız kendi bildirimini okundu işaretler.
    const existing = await this.prisma.scoped.notification.findFirst({
      where: { id, recipientUserId: userId },
      select: { id: true, readAt: true },
    });
    if (!existing) throw new NotFoundException('Bildirim bulunamadı');
    if (existing.readAt) return existing;
    return this.prisma.scoped.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<{ count: number }> {
    const res = await this.prisma.scoped.notification.updateMany({
      where: { recipientUserId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: res.count };
  }
}

function asMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
