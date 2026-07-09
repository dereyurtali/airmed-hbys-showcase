import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PlatformAuditModule } from '../audit/platform-audit.module';
import { PlatformAuthModule } from '../auth/platform-auth.module';
import { ImpersonationModule } from '../impersonation/impersonation.module';
import { PlatformTenantsController } from './tenants.controller';
import { PlatformTenantsService } from './tenants.service';

// F4 — Suspend olduğunda aktif impersonation token'larını revoke etmek için
// ImpersonationModule'u import ediyoruz.
@Module({
  imports: [PrismaModule, PlatformAuditModule, PlatformAuthModule, ImpersonationModule],
  controllers: [PlatformTenantsController],
  providers: [PlatformTenantsService],
})
export class PlatformTenantsModule {}
