import { SetMetadata } from '@nestjs/common';

/**
 * Marks a controller / handler as a /platform/* route. Used by global
 * interceptors (TenantInterceptor, AuditInterceptor) to skip tenant-scoped
 * machinery — platform admins are tenant-agnostic and audit through the
 * separate `platform_audit_logs` table.
 */
export const IS_PLATFORM_ROUTE_KEY = 'isPlatformRoute';
export const PlatformRoute = () => SetMetadata(IS_PLATFORM_ROUTE_KEY, true);
