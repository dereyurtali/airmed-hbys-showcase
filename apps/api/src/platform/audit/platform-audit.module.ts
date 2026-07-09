import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PlatformAuditController } from './platform-audit.controller';
import { PlatformAuditService } from './platform-audit.service';

// #945 (F3) — controller eklendi (audit READ). Guard (PlatformJwtAuthGuard) DI'sız
// olduğu + strategy PlatformAuthModule tarafından global kaydedildiği için burada
// PlatformAuthModule import EDİLMEZ (auth→audit→auth çevrimini önler).
@Module({
  imports: [PrismaModule],
  controllers: [PlatformAuditController],
  providers: [PlatformAuditService],
  exports: [PlatformAuditService],
})
export class PlatformAuditModule {}
