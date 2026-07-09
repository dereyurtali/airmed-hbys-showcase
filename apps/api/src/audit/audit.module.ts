import { Global, Module } from '@nestjs/common';
import { AuditCleanupService } from './audit-cleanup.service';
import { AuditCosignService } from './audit-cosign.service';
import { AuditService } from './audit.service';

@Global()
@Module({
  providers: [AuditService, AuditCleanupService, AuditCosignService],
  exports: [AuditService, AuditCleanupService, AuditCosignService],
})
export class AuditModule {}
