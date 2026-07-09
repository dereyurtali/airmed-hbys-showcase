import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@airmed/contracts';

export const PERMISSION_KEY = 'requirePermission';

/**
 * Permission-based endpoint guard işareti — `permissions.ts` registry'sinden
 * tek bir permission key alır, `PermissionGuard` runtime'da çözer.
 *
 * Mevcut `@Roles(...)` decorator'ının evrimi — hardcode rol listesi yerine
 * tek doğru kaynaktan (apps/api/src/auth/permissions.ts) gelen anahtar.
 *
 * Örnek:
 * ```ts
 * @Delete(':id')
 * @RequirePermission('action:patient.softDelete')
 * async remove(@Param('id') id: string) { ... }
 * ```
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);
