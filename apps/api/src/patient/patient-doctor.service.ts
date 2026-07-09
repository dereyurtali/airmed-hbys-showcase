import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * S4 — Doktor-hasta atama servisi.
 *
 * Karar tutanağı §7 hibrit atama:
 * - **auto** — randevu/muayene/cerrahi hook'ları çağırır (idempotent upsert)
 * - **manual** — resepsiyon yeni hasta eklerken primary doctor seçimi
 * - **transfer** — yönetici devretmesi (S8 UI)
 *
 * Tüm yazımlar tenant scoped tx içinde (caller'ın TenantInterceptor tx'i);
 * RLS policy yeni satırın tenant_id'sinin context ile eşleştiğini garanti
 * ediyor.
 */
@Injectable()
export class PatientDoctorService {
  private readonly logger = new Logger(PatientDoctorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Auto-assignment: randevu/muayene/cerrahi yaratıldığında çağrılır.
   * Idempotent — aynı (patient, doctor) tuple'ı zaten varsa no-op.
   * Hata best-effort log'lanır; parent operation rollback olmaz (sıkı
   * tx-bağı değil — hookspec'i: parent tx'in scoped client'ını kullanır,
   * dolayısıyla parent commit ederse upsert de commit, parent rollback
   * ederse upsert de rollback).
   *
   * `doctorId` opsiyonel (randevu cerrah olmadan oluşturulabilir mi? hayır
   * — appointment.doctorId NOT NULL). Yine de defensive guard.
   */
  async assignAuto(input: {
    tenantId: string;
    patientId: string;
    doctorId: string | null | undefined;
  }): Promise<void> {
    if (!input.doctorId) return;
    try {
      await this.prisma.scoped.patientDoctor.upsert({
        where: {
          tenantId_patientId_doctorId: {
            tenantId: input.tenantId,
            patientId: input.patientId,
            doctorId: input.doctorId,
          },
        },
        update: {}, // Mevcut atama varsa dokunma (manuel primary korunur)
        create: {
          tenantId: input.tenantId,
          patientId: input.patientId,
          doctorId: input.doctorId,
          source: 'auto',
          isPrimary: false,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `assignAuto failed (tenant ${input.tenantId}, patient ${input.patientId}, doctor ${input.doctorId}): ${msg}`,
      );
    }
  }

  /**
   * Manuel primary doctor atama — resepsiyon `/patients/new` formundan veya
   * yönetici `/patients/:id/edit`'ten çağırır. isPrimary=true; aynı hasta
   * için başka primary varsa onun isPrimary'sini false'a düşürür (tek
   * primary kuralı, uygulama katmanında zorlu).
   */
  async assignManual(input: {
    tenantId: string;
    patientId: string;
    doctorId: string;
    assignedBy: string | null;
  }): Promise<void> {
    // scoped client zaten request tx'inde; updateMany + upsert sıralı atomik
    await this.prisma.scoped.patientDoctor.updateMany({
      where: { tenantId: input.tenantId, patientId: input.patientId, isPrimary: true },
      data: { isPrimary: false },
    });
    await this.prisma.scoped.patientDoctor.upsert({
      where: {
        tenantId_patientId_doctorId: {
          tenantId: input.tenantId,
          patientId: input.patientId,
          doctorId: input.doctorId,
        },
      },
      update: { isPrimary: true, source: 'manual', assignedBy: input.assignedBy },
      create: {
        tenantId: input.tenantId,
        patientId: input.patientId,
        doctorId: input.doctorId,
        source: 'manual',
        isPrimary: true,
        assignedBy: input.assignedBy,
      },
    });
  }

  /**
   * Doktor user'a atanmış hasta ID'lerini döner. PatientService.list filter
   * için ana kaynak.
   *
   * `visitingOnly` (S5 — is_visiting_doctor flag): Visiting cerrah sadece
   * kendi cerrahisini yaptığı hastaları görür. PatientDoctor m2m'i bypass'leyip
   * doğrudan Surgery.doctorId üzerinden distinct patientId döner. Diğer
   * source'lar (randevu/muayene auto) misafir cerrah için gerçek klinik
   * sorumluluğa girmiyor.
   */
  async patientIdsForDoctorUser(input: {
    tenantId: string;
    userId: string;
    visitingOnly?: boolean;
  }): Promise<string[]> {
    const doctor = await this.prisma.scoped.doctor.findFirst({
      where: { userId: input.userId },
      select: { id: true },
    });
    if (!doctor) return [];

    if (input.visitingOnly) {
      const surgeryRows = await this.prisma.scoped.surgery.findMany({
        where: { tenantId: input.tenantId, doctorId: doctor.id, deletedAt: null },
        select: { patientId: true },
        distinct: ['patientId'],
      });
      return surgeryRows.map((r) => r.patientId);
    }

    const rows = await this.prisma.scoped.patientDoctor.findMany({
      where: { tenantId: input.tenantId, doctorId: doctor.id },
      select: { patientId: true },
    });
    return rows.map((r) => r.patientId);
  }

  /**
   * Karar 2 (v0.4.2) — misafir doktor "own-patient" scope kontrolü. Hasta bu
   * doktor user'a PatientDoctor m2m üzerinden (auto: randevu/muayene/cerrahi
   * veya manual: primary) atanmış mı? Misafir cerrah klinik-geneli hastaya
   * ameliyat öneremez; yalnız kendi tedavi ettiği hastaya. Doğrudan count
   * (tüm ID'leri çekmeden), hasta listesi gating'inden bağımsız.
   */
  async isPatientAssignedToDoctorUser(input: {
    tenantId: string;
    userId: string;
    patientId: string;
  }): Promise<boolean> {
    const doctor = await this.prisma.scoped.doctor.findFirst({
      where: { userId: input.userId },
      select: { id: true },
    });
    if (!doctor) return false;
    const count = await this.prisma.scoped.patientDoctor.count({
      where: { tenantId: input.tenantId, doctorId: doctor.id, patientId: input.patientId },
    });
    return count > 0;
  }
}
