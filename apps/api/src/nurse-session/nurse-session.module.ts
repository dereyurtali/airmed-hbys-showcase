import { Global, Module } from '@nestjs/common';
import { NurseSessionService } from './nurse-session.service';

/**
 * S15-PR10 — Hemşire "Acting on Behalf" oturum servisi. AuditInterceptor +
 * tRPC context factory bu servise ihtiyaç duyar; tek instance yeterli, global
 * module ile dolaşımdan tasarruf.
 */
@Global()
@Module({
  providers: [NurseSessionService],
  exports: [NurseSessionService],
})
export class NurseSessionModule {}
