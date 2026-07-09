import { Injectable, Logger } from '@nestjs/common';
import { NurseSessionService } from '../nurse-session/nurse-session.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

export interface AuditEvent {
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  payload?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  userId?: string | null;
  tenantId?: string | null;
  // S15-PR10 — Acting on Behalf trail. AuditInterceptor otomatik tespit eder:
  // userId hemşire + aktif NurseAssistanceSession varsa, session.doctorId
  // onBehalfOfUserId'e atanır. Manuel set explicit override.
  onBehalfOfUserId?: string | null;
  nurseSessionId?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  // #1063 — request-scope nurse-session memoizasyonu: aynı istekte birden çok
  // audit kaydı (mutation + co-sign) aynı lookup'ı tekrarlamasın. Anahtar =
  // request tx instance'ı (WeakMap → istek bitince GC). Tx dışında (login gibi
  // kendi tx'ini yöneten yollar) memoize edilmez — stale risk yok.
  private readonly nurseSessionMemo = new WeakMap<
    object,
    Map<string, { id: string; doctorUserId: string } | null>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    // S15-PR10 — Acting on Behalf otomatik enrich: nurse session aktifse
    // onBehalfOfUserId + nurseSessionId set edilir.
    private readonly nurseSessions: NurseSessionService,
  ) {}

  private async getActiveNurseSessionMemo(
    userId: string,
  ): Promise<{ id: string; doctorUserId: string } | null> {
    const tx = this.tenantContext.getTransaction();
    if (!tx) return this.nurseSessions.getActiveForNurse(userId);
    let perRequest = this.nurseSessionMemo.get(tx);
    if (!perRequest) {
      perRequest = new Map();
      this.nurseSessionMemo.set(tx, perRequest);
    }
    if (!perRequest.has(userId)) {
      perRequest.set(userId, await this.nurseSessions.getActiveForNurse(userId));
    }
    return perRequest.get(userId) ?? null;
  }

  /**
   * Records an audit row in the request's tenant-scoped transaction.
   * Used by the AuditInterceptor for authenticated mutations and by
   * AuthService for actions that already manage their own transaction
   * (login, logout, change-password).
   *
   * S15-PR10 — `userId` set + onBehalfOfUserId set DEĞİL ise, hemşirenin
   * aktif NurseAssistanceSession'ı varsa otomatik doktor enrichment yapar.
   */
  async record(event: AuditEvent): Promise<void> {
    const tenantId = event.tenantId ?? this.tenantContext.getTenantId() ?? null;
    let onBehalfOfUserId = event.onBehalfOfUserId ?? null;
    let nurseSessionId = event.nurseSessionId ?? null;
    if (!onBehalfOfUserId && event.userId) {
      try {
        const active = await this.getActiveNurseSessionMemo(event.userId);
        if (active) {
          onBehalfOfUserId = active.doctorUserId;
          nurseSessionId = active.id;
        }
      } catch {
        // Best-effort enrichment; failure shouldn't block audit write.
      }
    }
    await this.prisma.scoped.auditLog.create({
      data: {
        tenantId,
        userId: event.userId ?? null,
        onBehalfOfUserId,
        nurseSessionId,
        action: event.action,
        entityType: event.entityType ?? null,
        entityId: event.entityId ?? null,
        payload: (event.payload ?? {}) as object,
        ip: event.ip ?? null,
        userAgent: event.userAgent ?? null,
      },
    });
  }

  /**
   * Best-effort audit outside the current request transaction. Used when a
   * failed login (or similar) needs to leave a trail even though its own
   * transaction rolled back. Errors are swallowed and logged.
   */
  async recordOutOfBand(tenantId: string, event: AuditEvent): Promise<void> {
    try {
      await this.prisma.runWithTenant(tenantId, async (tx) => {
        await tx.auditLog.create({
          data: {
            tenantId,
            userId: event.userId ?? null,
            action: event.action,
            entityType: event.entityType ?? null,
            entityId: event.entityId ?? null,
            payload: (event.payload ?? {}) as object,
            ip: event.ip ?? null,
            userAgent: event.userAgent ?? null,
          },
        });
      });
    } catch (err) {
      this.logger.warn(
        `failed to write out-of-band audit for tenant ${tenantId}: ${(err as Error).message}`,
      );
    }
  }
}
