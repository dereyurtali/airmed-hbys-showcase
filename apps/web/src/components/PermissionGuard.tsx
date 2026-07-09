import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { usePermission } from '../hooks/usePermission';
import type { Permission } from '@airmed/contracts';

interface PermissionGuardProps {
  required: Permission;
  children: ReactNode;
  /**
   * Yetkisiz kullanıcı yönlendirilecek route; default `/forbidden`.
   * Tipik kullanımda override gerekmez.
   */
  fallback?: string;
}

/**
 * Route-level yetki kontrolü. RolesGuard'ın evrimi — hardcode `allowedRoles`
 * yerine `permissions.ts` registry'sine başvuruyor.
 *
 * Kullanım:
 * ```tsx
 * <Route
 *   path="/admin/fraud"
 *   element={
 *     <PermissionGuard required="page:fraud">
 *       <FraudPage />
 *     </PermissionGuard>
 *   }
 * />
 * ```
 *
 * Yetkili olmayan kullanıcı `/forbidden` sayfasına yönlenir. Browser geri
 * tuşunda app history'de bu yönlendirme tek satır olur (replace).
 */
export function PermissionGuard({
  required,
  children,
  fallback = '/forbidden',
}: PermissionGuardProps) {
  const allowed = usePermission(required);
  if (!allowed) {
    return <Navigate to={fallback} replace />;
  }
  return <>{children}</>;
}
