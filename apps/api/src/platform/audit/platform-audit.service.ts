import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type PlatformRole } from '@airmed/db';
import { PrismaService } from '../../prisma/prisma.service';
import { ListAuditQueryDto } from './audit-query.dto';

interface PlatformAuditEntry {
  action: string;
  adminId?: string | null;
  email?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  payload?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
}

interface PlatformActor {
  id: string;
  email: string;
  role: PlatformRole;
}

/**
 * Writes platform-side audit rows to `platform_audit_logs`. Distinct from
 * tenant `AuditService` because:
 *  - retention differs (1y vs 180d)
 *  - tenant_id is N/A
 *  - platform_audit_logs is RLS-disabled
 *
 * `record` is best-effort: a failed audit never bubbles up and breaks login.
 */
@Injectable()
export class PlatformAuditService {
  private readonly logger = new Logger(PlatformAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: PlatformAuditEntry): Promise<void> {
    try {
      await this.prisma.platformAuditLog.create({
        data: {
          adminId: entry.adminId ?? null,
          email: entry.email ?? null,
          action: entry.action,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          payload: entry.payload ?? {},
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `platform audit write failed for ${entry.action}: ${(err as Error).message}`,
      );
    }
  }

  // #945 (F3) — audit READ tüm platform rollerine açık (okuma serbest).
  private assertReader(actor: PlatformActor): void {
    if (
      actor.role === 'platform_owner' ||
      actor.role === 'platform_engineer' ||
      actor.role === 'platform_support'
    )
      return;
    throw new ForbiddenException('Platform admin gerekiyor');
  }

  /**
   * #945 (F3) — audit log OKUMA. Mutasyon yok → audit yazılmaz. createdAt desc +
   * cursor pagination; unbounded findMany yasak (default 50, max 200).
   */
  async list(filters: ListAuditQueryDto, actor: PlatformActor) {
    this.assertReader(actor);
    const take = Math.min(filters.take ?? 50, 200);
    const where: Prisma.PlatformAuditLogWhereInput = {
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.adminId ? { adminId: filters.adminId } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
    };
    // take+1 çek → sonraki sayfa var mı bil; cursor = son görülen id.
    const rows = await this.prisma.platformAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    return { items, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null };
  }
}
