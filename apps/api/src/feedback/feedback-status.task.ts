import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { GithubIssueService } from './github-issue.service';

// I2.5 (#823) — Durum geri-bildirim döngüsü. Prod'da inbound webhook portu yok →
// GitHub issue durumunu OUTBOUND poll ederiz, FeedbackRequest.status'ü günceller,
// değişince isteği AÇAN kullanıcıya bildirim üretir ("İsteğin yayında: vX").
//
// Cross-tenant: root client (owner → RLS bypass) ile terminal-olmayan kayıtları
// tarar; her güncelleme runWithTenant tx içinde (RLS + bildirim aynı tenant scope).
const NON_TERMINAL = ['submitted', 'in_progress'];

@Injectable()
export class FeedbackStatusTask {
  private readonly logger = new Logger(FeedbackStatusTask.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubIssueService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'feedback-status-poll' })
  async tick(): Promise<void> {
    if (this.running || !this.github.enabled) return;
    this.running = true;
    try {
      const { updated } = await this.scan();
      if (updated > 0) this.logger.log(`feedback-status: updated=${updated}`);
    } catch (err) {
      this.logger.error(`feedback-status task failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  // Test'ler doğrudan çağırır (cron'u beklemeden).
  async scan(): Promise<{ updated: number }> {
    const due = await this.prisma.feedbackRequest.findMany({
      where: { githubIssueNo: { not: null }, status: { in: NON_TERMINAL } },
      select: {
        id: true,
        tenantId: true,
        submittedById: true,
        githubIssueNo: true,
        status: true,
        title: true,
      },
      take: 100,
    });
    if (due.length === 0) return { updated: 0 };

    let updated = 0;
    for (const fb of due) {
      if (fb.githubIssueNo == null) continue;
      const remote = await this.github.getIssueStatus(fb.githubIssueNo);
      if (!remote || remote.status === fb.status) continue;
      try {
        await this.prisma.runWithTenant(fb.tenantId, async (tx) => {
          const res = await tx.feedbackRequest.updateMany({
            where: { id: fb.id, status: fb.status },
            data: {
              status: remote.status,
              ...(remote.shippedVersion ? { shippedVersion: remote.shippedVersion } : {}),
            },
          });
          if (res.count === 0) return; // race: başka tick zaten güncelledi
          await tx.notification.create({
            data: {
              tenantId: fb.tenantId,
              recipientUserId: fb.submittedById,
              type: 'feature_request_status',
              title: 'İstek durumu güncellendi',
              body:
                remote.status === 'shipped'
                  ? `İsteğin yayında${remote.shippedVersion ? `: v${remote.shippedVersion}` : ''}: ${fb.title}`
                  : `"${fb.title}" → ${remote.status}`,
              payload: {
                feedbackId: fb.id,
                status: remote.status,
                shippedVersion: remote.shippedVersion,
              },
            },
          });
          updated += 1;
        });
      } catch (err) {
        this.logger.warn(`feedback-status update failed for ${fb.id}: ${(err as Error).message}`);
      }
    }
    return { updated };
  }
}
