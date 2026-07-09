import { createHash } from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AdminPrismaService } from '../prisma/admin-prisma.service';

// #1159 — Lobi bekleme ekranı (Raspberry Pi kiosk) PUBLIC read servisi.
//
// Kimliksiz erişim: istek yalnız yayın anahtarı (?key=wm_<64hex>) taşır. Anahtarın
// SHA-256 hash'i Tenant.publicMonitorKeyHash (@unique) ile eşleşen tenant çözülür
// (AdminPrismaService = BYPASSRLS, tenant belirlenmeden; api-key-auth.service ile
// aynı desen). Çıktı SERVER-SIDE anonimleştirilir: yalnız "Ad S." + oda türü +
// doktor adı. Tam soyad / MRN / tags / tıbbi bilgi payload'a ASLA girmez
// (veri minimizasyonu — data-privacy). Yazma yok; endpoint rate-limit'li.

const KEY_REGEX = /^wm_[0-9a-f]{64}$/;
// Bekleme hedefi yalnız iki tür: ölçüm odası + doktor. Kasa/ameliyat-satış
// (bekleme yeri değil) ve muayenede/ölçümde (hizmet alan) ekranda gösterilmez.
const WAITING_STAGES = ['in_measurement', 'waiting_doctor', 'measurement_ready'] as const;

export interface PublicWaitingRow {
  id: string;
  displayName: string; // "Ayşe K." — tam soyad değil
  kind: 'measurement' | 'doctor';
  doctorName: string | null;
}

@Injectable()
export class PublicMonitorService {
  constructor(private readonly admin: AdminPrismaService) {}

  async getWaitingByKey(key: string): Promise<{ rows: PublicWaitingRow[] }> {
    // Sabit-zaman gereği yok (hash lookup); format guard + jenerik hata yeter.
    if (!KEY_REGEX.test(key)) {
      throw new UnauthorizedException('Geçersiz yayın anahtarı');
    }
    const keyHash = createHash('sha256').update(key).digest('hex');

    const tenant = await this.admin.tenant.findUnique({
      where: { publicMonitorKeyHash: keyHash },
      select: { id: true, status: true, suspendedAt: true, deletedAt: true },
    });
    // Tenant yok / pasif / askıda / silinmiş → hepsi aynı jenerik hata (tenant
    // varlığını sızdırma).
    if (!tenant || tenant.deletedAt || tenant.status !== 'active' || tenant.suspendedAt) {
      throw new UnauthorizedException('Geçersiz yayın anahtarı');
    }

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const encounters = await this.admin.encounter.findMany({
      where: {
        tenantId: tenant.id,
        deletedAt: null,
        stage: { in: [...WAITING_STAGES] },
        openedAt: { gte: dayStart, lt: dayEnd },
      },
      select: {
        id: true,
        stage: true,
        isUrgent: true,
        stageUpdatedAt: true,
        patient: { select: { firstName: true, lastName: true, tags: true } },
        doctor: { select: { name: true } },
      },
      orderBy: { stageUpdatedAt: 'asc' },
    });

    // Öncelik: acil > VIP > (stageUpdatedAt asc). `tags`/`isUrgent` yalnız
    // SERVER'da sıralama için okunur; istemciye GÖNDERİLMEZ.
    const sorted = [...encounters].sort((a, b) => {
      const au = a.isUrgent ? 1 : 0;
      const bu = b.isUrgent ? 1 : 0;
      if (au !== bu) return bu - au;
      const av = (a.patient.tags ?? []).includes('vip') ? 1 : 0;
      const bv = (b.patient.tags ?? []).includes('vip') ? 1 : 0;
      return bv - av;
    });

    const rows: PublicWaitingRow[] = sorted.map((e) => {
      const kind: 'measurement' | 'doctor' =
        e.stage === 'in_measurement' ? 'measurement' : 'doctor';
      const initial = (e.patient.lastName.charAt(0) || '').toUpperCase();
      return {
        id: e.id,
        displayName: `${e.patient.firstName} ${initial}.`.trim(),
        kind,
        doctorName: kind === 'doctor' ? (e.doctor?.name ?? null) : null,
      };
    });

    return { rows };
  }
}
