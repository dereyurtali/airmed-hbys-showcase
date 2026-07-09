import { useAuth } from '../providers/AuthProvider';
import { hasPermission, type Permission } from '@airmed/contracts';

/**
 * Permission check hook. JWT'deki `effectivePerms` (varsa) öncelikli; yoksa
 * `roles[]` claim'i ile `permissions.ts` registry kontrolüne düşer (geriye
 * uyumlu). Tek doğru kaynak — hardcode `r === 'yonetici'` taraması yasak
 * (denetim raporu P1 #3.31).
 *
 * PermissionAssignment runtime entegrasyonu: backend login/refresh sırasında
 * tenant override'larını + registry'i birleştirip JWT'ye gömer. Override
 * değişikliği max ~15 dk içinde (token refresh) yansır.
 *
 * Kullanım:
 * ```tsx
 * const canDelete = usePermission('action:patient.softDelete');
 * {canDelete && <Button onClick={...}>Sil</Button>}
 * ```
 */
export function usePermission(perm: Permission): boolean {
  const { user } = useAuth();
  if (!user) return false;
  return hasPermission(user.roles, perm, user.effectivePerms);
}

/**
 * Çoklu permission check — bir component birden fazla butonu rol-bazlı gösteriyorsa
 * her biri için ayrı hook çağırmaktan kaçınmak isteyebilir. Hook kuralı gereği koşullu
 * çağrılamaz; bu helper tek render'da çok permission döner.
 */
export function usePermissions<K extends Permission>(perms: readonly K[]): Record<K, boolean> {
  const { user } = useAuth();
  const result = {} as Record<K, boolean>;
  for (const p of perms) {
    result[p] = user ? hasPermission(user.roles, p, user.effectivePerms) : false;
  }
  return result;
}
