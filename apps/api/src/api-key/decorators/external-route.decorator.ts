import { SetMetadata } from '@nestjs/common';

// A10 dış API rotalarını işaretler. JwtAuthGuard + TenantInterceptor +
// AuditInterceptor bu işaretten yararlanarak tenant-JWT mekanizmasını atlar
// ve yerine ApiKey auth + apiKey.tenantId tenant-scope açar.
// Mevcut @Public() + @PlatformRoute() pattern'i ile aynı kategoride.

export const IS_EXTERNAL_ROUTE_KEY = 'isExternalRoute';
export const ExternalRoute = () => SetMetadata(IS_EXTERNAL_ROUTE_KEY, true);
