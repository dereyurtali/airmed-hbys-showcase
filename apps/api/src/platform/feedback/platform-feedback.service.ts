import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PlatformRole } from '@airmed/db';
import { AdminPrismaService } from '../../prisma/admin-prisma.service';
import { PlatformAuditService } from '../audit/platform-audit.service';
import type { PlatformFeedbackListQueryDto, UpdateFeedbackDto } from './platform-feedback.dto';

interface Actor {
  id: string;
  email: string;
  role: PlatformRole;
}
interface Ctx {
  ip: string | null;
  userAgent: string | null;
}

const FEEDBACK_SELECT = {
  id: true,
  kind: true,
  status: true,
  title: true,
  description: true,
  routePath: true,
  appVersion: true,
  githubIssueNo: true,
  shippedVersion: true,
  createdAt: true,
  submittedBy: { select: { email: true } },
  tenant: { select: { id: true, name: true, slug: true } },
} as const;

// Geri-Bildirim platform gelen kutusu — "Geliştirme İste" istekleri yazılım
// sağlayıcıya (DNA) yapılır; aksiyon alacak yer klinik yöneticisi değil bizdir.
// Bu servis TÜM kliniklerin (cross-tenant) isteklerini tek listede sunar.
//
// #1057 — RLS notu: `feedback_requests` RLS-korumalı; eski desen tenant başına
// ayrı `runWithTenant` interaktif tx açıyordu (N tenant = N tx/istek; AdminShell
// 60sn poll'üyle çarpılınca havuzu yiyordu). Cross-tenant okuma/yazma artık
// paylaşımlı RLS-bypass AdminPrismaService ile TEK sorgu — maliyet tenant
// sayısından bağımsız. Bu client yalnız platform-admin auth'lu controller
// arkasında (PlatformFeedbackController) kullanılır.
@Injectable()
export class PlatformFeedbackService {
  constructor(
    private readonly adminPrisma: AdminPrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  // Support salt-okur (list + unreadCount); triyaj yazımı owner/engineer.
  private assertWriter(actor: Actor): void {
    if (actor.role !== 'platform_owner' && actor.role !== 'platform_engineer') {
      throw new ForbiddenException('feedback triage requires engineer or owner role');
    }
  }

  async list(query: PlatformFeedbackListQueryDto) {
    const limit = query.limit ?? 100;
    return this.adminPrisma.feedbackRequest.findMany({
      where: {
        ...(query.tenantId ? { tenantId: query.tenantId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.kind ? { kind: query.kind } : {}),
      },
      select: FEEDBACK_SELECT,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  // #882 — Gelen kutusu okunmamış sayacı (nav rozeti). FeedbackRequest'te ayrı
  // "okundu" alanı yok → triyaj edilmemiş = `status='submitted'` sayısı proxy'si.
  async unreadCount(): Promise<{ count: number }> {
    const count = await this.adminPrisma.feedbackRequest.count({
      where: { status: 'submitted' },
    });
    return { count };
  }

  // #951 — Triyaj: status + GitHub issue no + shipped version.
  async updateStatus(id: string, dto: UpdateFeedbackDto, actor: Actor, ctx: Ctx) {
    this.assertWriter(actor);

    const existing = await this.adminPrisma.feedbackRequest.findUnique({
      where: { id },
      select: { id: true, tenantId: true },
    });
    if (!existing) throw new NotFoundException('feedback request not found');

    const updated = await this.adminPrisma.feedbackRequest.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.githubIssueNo !== undefined ? { githubIssueNo: dto.githubIssueNo } : {}),
        ...(dto.shippedVersion !== undefined ? { shippedVersion: dto.shippedVersion } : {}),
      },
      select: FEEDBACK_SELECT,
    });

    await this.audit.record({
      action: 'feedback.triage',
      adminId: actor.id,
      email: actor.email,
      entityType: 'feedback_request',
      entityId: id,
      payload: {
        tenantId: existing.tenantId,
        status: dto.status,
        githubIssueNo: dto.githubIssueNo ?? null,
        shippedVersion: dto.shippedVersion ?? null,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return updated;
  }
}
