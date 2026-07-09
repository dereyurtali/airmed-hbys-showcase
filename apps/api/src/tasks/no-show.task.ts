import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookService } from '../webhook/webhook.service';

// S14 — v0.1 no-show cron port. Her 5 dakikada bir scheduled status'ünde,
// startsAt >= 30 dakika önce geçmiş ve halen scheduled kalmış appointment'ları
// 'no_show' a çevirir. Audit log + webhook event ('appointment.no_show').
//
// Cross-tenant: raw findMany ile tüm tenant'ları çek (tenant context yok),
// her kayıt için runWithTenant(tenantId) içinde update + audit + emit.
//
// Test ortamında (NODE_ENV='test') cron tetiklenmez — ScheduleModule.forRoot()
// app.close ile process'i sonlandırır.

const NO_SHOW_GRACE_MINUTES = 30;

@Injectable()
export class NoShowTask {
  private readonly logger = new Logger(NoShowTask.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly webhooks: WebhookService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'no-show-detector' })
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.scan();
      if (result.flagged > 0) {
        this.logger.log(`no-show: flagged=${result.flagged}`);
      }
    } catch (err) {
      this.logger.error(`no-show task failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Tetiklenmesi gereken appointment'ları bulur ve no_show'a çevirir. Test'ler
   * doğrudan bunu çağırır (cron'u beklemeden).
   */
  async scan(): Promise<{ flagged: number }> {
    const cutoff = new Date(Date.now() - NO_SHOW_GRACE_MINUTES * 60 * 1000);
    // RLS bypass: raw client (cross-tenant scan). select tenant_id alarak
    // her kayıt için runWithTenant yapar.
    const due = await this.prisma.appointment.findMany({
      where: {
        status: 'scheduled',
        startsAt: { lt: cutoff },
        deletedAt: null,
      },
      select: {
        id: true,
        tenantId: true,
        patientId: true,
        doctorId: true,
        startsAt: true,
      },
      take: 200, // batch cap — sonraki tick devamını alır
    });

    if (due.length === 0) return { flagged: 0 };

    let flagged = 0;
    for (const appt of due) {
      try {
        await this.prisma.runWithTenant(appt.tenantId, async (tx) => {
          // Race: scheduled'tan başka status'a geçtiyse no-op (RLS scoped + status guard)
          const updateResult = await tx.appointment.updateMany({
            where: { id: appt.id, status: 'scheduled' },
            data: { status: 'no_show' as Prisma.AppointmentUpdateInput['status'] },
          });
          if (updateResult.count === 0) return; // already changed

          // Audit (background — DB üzerinden tx context içinde)
          await this.audit.record({
            action: 'cron:appointment.no_show',
            entityType: 'appointment',
            entityId: appt.id,
            tenantId: appt.tenantId,
            userId: null,
            ip: null,
            userAgent: null,
            payload: {
              patientId: appt.patientId,
              doctorId: appt.doctorId,
              startsAt: appt.startsAt,
            },
          });

          // Webhook emit (tenant scope içinde)
          await this.webhooks.emit('appointment.no_show', {
            appointmentId: appt.id,
            patientId: appt.patientId,
            doctorId: appt.doctorId,
            startsAt: appt.startsAt.toISOString(),
            flaggedAt: new Date().toISOString(),
          });
          flagged += 1;
        });
      } catch (err) {
        this.logger.warn(`no-show flag failed for ${appt.id}: ${(err as Error).message}`);
      }
    }
    return { flagged };
  }
}
