import type { PrismaClient, RoleKey } from '@prisma/client';

/**
 * Klinik default rol seti. S17 sonrası 7 rol, hepsi default aktif —
 * CLAUDE.md "Roller (Klinik)" tablosu kanonik ("Toplam aktif klinik rol = 7").
 *
 * Yönetici, kullanmadığı rolü ileride pasifleştirebilir; ama dropdown'da
 * görünen her rolün backend tarafından kabul edilmesi UX tutarlılığı için
 * default'un aktif olması gerekir.
 *
 * Bu dizinin tek noktada tutulması: hem `packages/db/prisma/seed.ts` (dev seed),
 * hem `apps/api/scripts/admin-bootstrap.ts` (canlı klinik kurulumu),
 * hem `apps/api/src/platform/tenants/tenants.service.ts` (F4 onboarding) aynı
 * default'lardan yola çıksın. Yeni rol gelirse tek satır güncelleme yeter.
 */
export type SeedRoleConfig = {
  key: RoleKey;
  label: string;
  isActive: boolean;
};

export const DEFAULT_CLINIC_ROLES: readonly SeedRoleConfig[] = [
  { key: 'yonetici', label: 'Yönetici', isActive: true },
  { key: 'yonetici_asistani', label: 'Yönetici Asistanı', isActive: true },
  { key: 'doktor', label: 'Doktor', isActive: true },
  { key: 'resepsiyon', label: 'Resepsiyon', isActive: true },
  { key: 'hemsire', label: 'Hemşire', isActive: true },
  { key: 'ameliyat_satis', label: 'Ameliyat Satış', isActive: true },
  { key: 'olcum_hemsiresi', label: 'Ölçüm Hemşiresi', isActive: true },
  // v0.4 (#538) — 3 yeni klinik rol. Default aktif (S17 deseni: dropdown'da görünen
  // her rol backend'ce kabul edilmeli); yönetici kullanmadığını pasifleştirebilir.
  { key: 'finans', label: 'Finans Yetkilisi', isActive: true },
  { key: 'stok_satinalma', label: 'Stok & Satın Alma', isActive: true },
  { key: 'eczane', label: 'Eczane Personeli', isActive: true },
];

/**
 * Tenant için default rolleri idempotent upsert eder. Yeniden çalıştırılınca
 * `label`/`isActive` güncellenir, key sabit.
 */
export async function ensureClinicRoles(
  prisma: PrismaClient,
  tenantId: string,
  roles: readonly SeedRoleConfig[] = DEFAULT_CLINIC_ROLES,
): Promise<void> {
  for (const role of roles) {
    await prisma.role.upsert({
      where: { tenantId_key: { tenantId, key: role.key } },
      update: { label: role.label, isActive: role.isActive },
      create: {
        tenantId,
        key: role.key,
        label: role.label,
        isActive: role.isActive,
      },
    });
  }
}
