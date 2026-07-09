import { SetMetadata } from '@nestjs/common';

export const BLOCK_IMPERSONATION_KEY = 'blockImpersonation';

/**
 * F4 — Impersonation token'larını handler/controller seviyesinde reddet.
 *
 * Hassas işlemler (örn. parola değiştirme, kullanıcı oluşturma, rol atama,
 * 2FA ayarları) platform admin'in başkası adına yapamaması gereken
 * aksiyonlar — bunlara `@BlockImpersonation()` koyduğumuzda ImpersonationGuard
 * JWT'deki `imp` claim'i kontrol eder ve 403 atar.
 *
 * Plan referansı: F4 → "Hassas işlemler impersonation sırasında engellenir".
 */
export const BlockImpersonation = () => SetMetadata(BLOCK_IMPERSONATION_KEY, true);
