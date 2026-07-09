import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../../prisma/prisma.module';
import { PlatformAuditModule } from '../audit/platform-audit.module';
import { PlatformIpAllowlistGuard } from './guards/platform-ip-allowlist.guard';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { RecoveryCodeService } from './recovery-code.service';
import { PlatformJwtStrategy } from './strategies/platform-jwt.strategy';
import { TotpService } from './totp.service';

@Module({
  imports: [PassportModule, JwtModule.register({}), PrismaModule, PlatformAuditModule],
  controllers: [PlatformAuthController],
  providers: [
    PlatformAuthService,
    PlatformJwtStrategy,
    TotpService,
    RecoveryCodeService,
    // Allowlist runs globally but short-circuits when the route isn't
    // @PlatformRoute() — so it's effectively a no-op for /api/* handlers.
    {
      provide: APP_GUARD,
      useClass: PlatformIpAllowlistGuard,
    },
  ],
  exports: [PlatformAuthService, JwtModule],
})
export class PlatformAuthModule {}
