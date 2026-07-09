import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

export const startSessionSchema = z.object({
  doctorUserId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});
export type StartSessionInput = z.infer<typeof startSessionSchema>;

export const revokeSessionSchema = z.object({
  sessionId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});
export type RevokeSessionInput = z.infer<typeof revokeSessionSchema>;

/**
 * S15-PR10 — Hemşire "Acting on Behalf" oturumu servisi.
 *
 * Flow:
 *  - Sabah hemşire login → `start()` ile "Bugün Dr. X'in asistanıyım" der.
 *    Eski aktif session'lar (varsa) `endedAt` set ile kapatılır (multi-doctor
 *    shift için yeni satır açılır). Concurrent overlapping session yok —
 *    hemşire bir anda tek doktor adına çalışır (basit + audit net).
 *  - `end()` hemşire kendi kapatır (mesai sonu).
 *  - `revoke()` yönetici/doktor anında durdurur (audit gerekçe).
 *  - `getActiveForNurse()` middleware/audit interceptor "şu an aktif session
 *    var mı?" sorgusu.
 */
@Injectable()
export class NurseSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Hemşirenin aktif session'ını alır. Aktif = endedAt null + revokedAt null.
   * UI worklist banner + AuditInterceptor "on behalf of" eşlemesi için.
   */
  async getActiveForNurse(
    nurseUserId: string,
  ): Promise<{ id: string; doctorUserId: string } | null> {
    const session = await this.prisma.scoped.nurseAssistanceSession.findFirst({
      where: { nurseId: nurseUserId, endedAt: null, revokedAt: null },
      orderBy: { startedAt: 'desc' },
      select: { id: true, doctorId: true },
    });
    if (!session) return null;
    return { id: session.id, doctorUserId: session.doctorId };
  }

  /**
   * Aktif session + asiste edilen doktorun profil bilgisi (UI sidebar/banner).
   * Doctor profili yoksa (visiting doctor user) name/specialty null döner.
   * `getActiveForNurse` imzasını AuditService kullandığından dokunmadan bırakırız.
   */
  async getActiveForNurseWithDoctor(nurseUserId: string): Promise<{
    id: string;
    doctorUserId: string;
    doctorName: string | null;
    doctorSpecialty: string | null;
  } | null> {
    const active = await this.getActiveForNurse(nurseUserId);
    if (!active) return null;
    const doctor = await this.prisma.scoped.doctor.findFirst({
      where: { userId: active.doctorUserId, deletedAt: null },
      select: { name: true, specialty: true },
    });
    return {
      id: active.id,
      doctorUserId: active.doctorUserId,
      doctorName: doctor?.name ?? null,
      doctorSpecialty: doctor?.specialty ?? null,
    };
  }

  /** Yeni session aç. Önceki aktif session(lar) endedAt set ile kapatılır. */
  async start(
    input: StartSessionInput,
    nurseUserId: string,
  ): Promise<{ id: string; doctorUserId: string; startedAt: Date }> {
    const tenantId = this.tenantContext.requireTenantId();
    if (input.doctorUserId === nurseUserId) {
      throw new BadRequestException('Hemşire kendi adına session başlatamaz');
    }
    // Doktor user gerçekten doktor rolünde olmalı (basit kontrol)
    const doctor = await this.prisma.scoped.user.findFirst({
      where: { id: input.doctorUserId, status: 'active' },
      include: {
        userRoles: { include: { role: { select: { key: true } } } },
      },
    });
    if (!doctor) throw new NotFoundException('Doktor bulunamadı');
    const isDoctor = doctor.userRoles.some((ur) => ur.role.key === 'doktor');
    if (!isDoctor) {
      throw new BadRequestException(
        `Seçili kullanıcı doktor rolüne sahip değil (id=${input.doctorUserId})`,
      );
    }

    // Önceki aktif session'ları kapat (multi-doctor shift switch).
    await this.prisma.scoped.nurseAssistanceSession.updateMany({
      where: { nurseId: nurseUserId, endedAt: null, revokedAt: null },
      data: { endedAt: new Date() },
    });

    const created = await this.prisma.scoped.nurseAssistanceSession.create({
      data: {
        tenantId,
        nurseId: nurseUserId,
        doctorId: input.doctorUserId,
        reason: input.reason ?? null,
      },
      select: { id: true, doctorId: true, startedAt: true },
    });
    return { id: created.id, doctorUserId: created.doctorId, startedAt: created.startedAt };
  }

  /** Hemşirenin kendi açtığı session'ı kapatır (mesai sonu). */
  async end(sessionId: string, nurseUserId: string) {
    // Delta audit C-10: RLS scoped client + explicit tenantId filter (defense in depth,
    // diğer servislerle paritesi). RLS'in tek başına devre dışı kalma riski yok ama
    // bug magnet alanı azaltır.
    const tenantId = this.tenantContext.requireTenantId();
    const session = await this.prisma.scoped.nurseAssistanceSession.findFirst({
      where: { id: sessionId, tenantId },
    });
    if (!session) throw new NotFoundException('Session bulunamadı');
    if (session.nurseId !== nurseUserId) {
      throw new ForbiddenException("Bu session'ı sadece kendisi kapatabilir");
    }
    if (session.endedAt || session.revokedAt) return session;
    return this.prisma.scoped.nurseAssistanceSession.update({
      where: { id: sessionId },
      data: { endedAt: new Date() },
    });
  }

  /** Yönetici/doktor anlık revoke (gerekçe zorunlu). */
  async revoke(input: RevokeSessionInput, actorUserId: string) {
    // Delta audit C-10: aynı tenantId guard (end() ile paralel).
    const tenantId = this.tenantContext.requireTenantId();
    const session = await this.prisma.scoped.nurseAssistanceSession.findFirst({
      where: { id: input.sessionId, tenantId },
    });
    if (!session) throw new NotFoundException('Session bulunamadı');
    if (session.revokedAt) return session;
    return this.prisma.scoped.nurseAssistanceSession.update({
      where: { id: input.sessionId },
      data: {
        revokedAt: new Date(),
        revokedBy: actorUserId,
        reason: session.reason
          ? `${session.reason} | REVOKE: ${input.reason}`
          : `REVOKE: ${input.reason}`,
      },
    });
  }

  /** Doktorun aktif asistan hemşireleri (worklist banner için). */
  listActiveAssistantsForDoctor(doctorUserId: string) {
    return this.prisma.scoped.nurseAssistanceSession.findMany({
      where: { doctorId: doctorUserId, endedAt: null, revokedAt: null },
      include: { nurse: { select: { id: true, name: true, email: true } } },
      orderBy: { startedAt: 'desc' },
    });
  }
}
