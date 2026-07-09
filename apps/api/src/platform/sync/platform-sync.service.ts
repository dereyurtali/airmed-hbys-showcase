import { Injectable, NotFoundException } from '@nestjs/common';
import { scrubText } from '@airmed/observability';
import { AdminPrismaService } from '../../prisma/admin-prisma.service';

// #1091 — Hibrit senkron (A12) izleme servisi. SyncOutbox dead-letter + açık
// SyncConflict görünürlüğü + requeue. Cross-tenant tek sorgu (#1057). A12
// pilot sonrası aktifleşecek; şimdi kurulursa go-live'da hazır.

export interface SyncSummary {
  pendingOutbox: number;
  deadLetter: number;
  synced24h: number;
  openConflicts: number;
}
export interface DeadLetterRow {
  id: string;
  tenantId: string | null;
  entityType: string;
  operation: string;
  retryCount: number;
  failedAt: string | null;
  lastError: string | null;
}
export interface ConflictRow {
  id: string;
  tenantId: string | null;
  entityType: string;
  conflictType: string;
  occurredAt: string;
  createdAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PlatformSyncService {
  constructor(private readonly admin: AdminPrismaService) {}

  async summary(): Promise<SyncSummary> {
    const since = new Date(Date.now() - DAY_MS);
    const [pending, dead, synced, conflicts] = await Promise.all([
      this.admin.syncOutbox.count({ where: { syncedAt: null, failedAt: null } }),
      this.admin.syncOutbox.count({ where: { failedAt: { not: null }, syncedAt: null } }),
      this.admin.syncOutbox.count({ where: { syncedAt: { gte: since } } }),
      this.admin.syncConflict.count({ where: { resolvedAt: null } }),
    ]);
    return {
      pendingOutbox: pending,
      deadLetter: dead,
      synced24h: synced,
      openConflicts: conflicts,
    };
  }

  async deadLetter(tenantId?: string): Promise<DeadLetterRow[]> {
    const rows = await this.admin.syncOutbox.findMany({
      where: { failedAt: { not: null }, syncedAt: null, ...(tenantId ? { tenantId } : {}) },
      orderBy: { failedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        tenantId: true,
        entityType: true,
        operation: true,
        retryCount: true,
        failedAt: true,
        lastError: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      entityType: r.entityType,
      operation: r.operation,
      retryCount: r.retryCount,
      failedAt: r.failedAt ? r.failedAt.toISOString() : null,
      lastError: r.lastError ? scrubText(r.lastError).slice(0, 300) : null,
    }));
  }

  async conflicts(tenantId?: string): Promise<ConflictRow[]> {
    const rows = await this.admin.syncConflict.findMany({
      where: { resolvedAt: null, ...(tenantId ? { tenantId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        tenantId: true,
        entityType: true,
        conflictType: true,
        occurredAt: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      entityType: r.entityType,
      conflictType: r.conflictType,
      occurredAt: r.occurredAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Dead-letter satırını yeniden kuyruğa al: failedAt+lastError temizle,
   *  retryCount sıfırla → worker tekrar dener. */
  async requeue(id: string): Promise<{ ok: true }> {
    const row = await this.admin.syncOutbox.findUnique({ where: { id }, select: { id: true } });
    if (!row) throw new NotFoundException('Sync outbox row not found');
    await this.admin.syncOutbox.update({
      where: { id },
      data: { failedAt: null, lastError: null, retryCount: 0 },
    });
    return { ok: true };
  }
}
