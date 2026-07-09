import type { PlatformRole } from './types';

// #404 — Platform rol gating (CLAUDE.md "Roller (Platform)"):
//   platform_owner    — full access + admin yönetimi
//   platform_engineer — tüm erişim, admin yönetimi yok
//   platform_support  — Read + impersonate (audit'li), CRUD yok
//
// UI gate sadece UX kolaylığı; asıl yetki backend RolesGuard'ında. Yine de
// support'a yapamayacağı mutasyon butonlarını göstermek yanıltıcı (audit bulgusu).

/** Tenant/flag CRUD + askıya alma gibi mutasyonlara yetkili mi? Support hariç. */
export function canMutate(role: PlatformRole): boolean {
  return role === 'platform_owner' || role === 'platform_engineer';
}

/** Impersonation başlatma — owner/engineer/support hepsi yetkili (audit'li). */
export function canImpersonate(role: PlatformRole): boolean {
  return role === 'platform_owner' || role === 'platform_engineer' || role === 'platform_support';
}

/** Platform admin yönetimi (ekle/rol/deaktive/TOTP-reset) — #946, yalnız owner. */
export function canManageAdmins(role: PlatformRole): boolean {
  return role === 'platform_owner';
}

/** IP allowlist ekle/sil — #948, yalnız owner (kendini kilitleme riski). */
export function canManageIpAllowlist(role: PlatformRole): boolean {
  return role === 'platform_owner';
}
